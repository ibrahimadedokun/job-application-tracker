import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  access,
  unlink,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readConfiguration, terraformVariables } from "./config.mjs";
import { buildAws } from "./build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
let terraform = process.env.TERRAFORM_BIN || "terraform";
if (!process.env.TERRAFORM_BIN) {
  const local = resolve(
    root,
    ".local/tools/terraform",
    process.platform === "win32" ? "terraform.exe" : "terraform",
  );
  try {
    await access(local);
    terraform = local;
  } catch {
    /* Use PATH. */
  }
}
function run(command, args, { cwd = root, capture = false, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed with exit code ${result.status}.`);
  return result.stdout;
}
const node = (args) => run(process.execPath, args);
const action = process.argv[2] || "check";
if (!["check", "init", "plan", "apply", "publish", "output"].includes(action))
  throw new Error("Use check, init, plan, apply, publish or output.");
const version = JSON.parse(
  run(terraform, ["version", "-json"], { capture: true }),
)
  .terraform_version.split(".")
  .map(Number);
if (version[0] !== 1 || version[1] < 11)
  throw new Error(
    "Install Terraform >=1.11 and <2.0, or set TERRAFORM_BIN to that executable.",
  );
if (action === "check") {
  run(terraform, ["fmt", "-check", "-recursive", "infra"]);
  for (const cloud of ["aws", "azure", "combo"]) {
    const cwd = join(root, "infra", cloud);
    run(
      terraform,
      ["init", "-backend=false", "-input=false", "-lockfile=readonly"],
      { cwd },
    );
    run(terraform, ["validate", "-no-color"], { cwd });
    run(terraform, ["test", "-no-color"], { cwd });
  }
  node(["infra/azure/build.mjs"]);
  node(["infra/azure/verify.mjs"]);
  node(["infra/azure/build.mjs", "--combo", "--output", ".local/check/combo"]);
  node(["infra/combo/verify.mjs", "--output", ".local/check/combo"]);
  await buildAws(resolve(root, ".local/check/aws"));
  console.log(
    "All three Terraform targets validated with mocked providers; no cloud resources created.",
  );
  process.exit(0);
}
const flag = process.argv.indexOf("--config");
const configFile = resolve(
  flag < 0
    ? process.env.DEPLOYMENT_CONFIG || "deployment.json"
    : process.argv[flag + 1],
);
const config = await readConfiguration(configFile);
const base = resolve(
  root,
  ".local/terraform",
  config.name,
  config.environment,
  config.cloud,
);
const cwd = join(base, "root");
const artifacts = join(base, "artifacts");
await mkdir(cwd, { recursive: true });
await mkdir(artifacts, { recursive: true });
// Each cloud/environment has its own root, backend metadata and artifacts.
const sourceFiles = await readdir(join(root, "infra", config.cloud));
for (const oldFile of await readdir(cwd)) {
  if (oldFile.endsWith(".tf") && !sourceFiles.includes(oldFile))
    await unlink(join(cwd, oldFile));
}
for (const file of sourceFiles) {
  if (file.endsWith(".tf") || file === ".terraform.lock.hcl")
    await cp(join(root, "infra", config.cloud, file), join(cwd, file));
}
const json = async (file, value) =>
  writeFile(file, JSON.stringify(value, null, 2));
await json(join(cwd, "backend.tf.json"), {
  terraform: { backend: { [config.backend.type]: {} } },
});
const backendConfig =
  config.backend.type === "local"
    ? {
        path: join(base, "terraform.tfstate").replaceAll("\\", "/"),
        ...config.backend.config,
      }
    : config.backend.config;
await json(join(base, "backend.json"), backendConfig);
const variablesFile = join(base, "variables.tfvars.json");
await json(variablesFile, terraformVariables(config, artifacts));
// Refuse to silently reuse another account, region or backend for an existing target.
const manifest = {
  cloud: config.cloud,
  name: config.name,
  environment: config.environment,
  region: config.region,
  account:
    config.cloud === "aws"
      ? config.aws.account_id
      : config.azure.subscription_id,
  tenant: config.cloud !== "aws" ? config.azure.tenant_id : undefined,
  ...(config.cloud === "combo"
    ? { aws_account: config.aws.account_id, aws_region: config.aws.region }
    : {}),
  backend: config.backend,
};
const manifestFile = join(base, "target.json");
let previous;
try {
  previous = JSON.parse(await readFile(manifestFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (
  previous &&
  !isDeepStrictEqual(previous, JSON.parse(JSON.stringify(manifest)))
)
  throw new Error(
    "Target identity/backend changed. Use a new environment name, or perform an explicit Terraform state migration. See infra/README.md.",
  );
run(
  terraform,
  [
    "init",
    "-input=false",
    "-lockfile=readonly",
    `-backend-config=${join(base, "backend.json")}`,
  ],
  { cwd },
);
if (action === "init") {
  run(terraform, ["validate", "-no-color"], { cwd });
  console.log(`Initialized ${config.cloud}/${config.environment} at ${cwd}`);
  process.exit(0);
}
if (["plan", "apply"].includes(action)) {
  if (action === "apply" && config.cloud !== "aws")
    run("pwsh", [
      "-NoProfile",
      "-File",
      `infra/${config.cloud}/preflight.ps1`,
      "-SubscriptionId",
      config.azure.subscription_id,
      "-TenantId",
      config.azure.tenant_id,
    ]);
  if (config.cloud === "aws") await buildAws(artifacts);
  if (action === "apply") await json(manifestFile, manifest);
  run(terraform, [action, `-var-file=${variablesFile}`], { cwd });
  if (action === "plan") process.exit(0);
}
const deployment = JSON.parse(
  run(terraform, ["output", "-json", "deployment"], { cwd, capture: true }),
);
const outputsFile = join(base, "outputs.json");
await json(outputsFile, deployment);
if (action === "output") {
  console.log(JSON.stringify(deployment, null, 2));
  process.exit(0);
}
await json(join(artifacts, "runtime-config.json"), deployment.runtime_config);
if (config.cloud === "aws") {
  node(["infra/aws/publish.mjs", outputsFile]);
} else {
  run("pwsh", [
    "-NoProfile",
    "-File",
    `infra/${config.cloud}/publish.ps1`,
    "-OutputsFile",
    outputsFile,
    "-Artifacts",
    artifacts,
  ]);
}
console.log(
  `Published ${config.cloud}/${config.environment}: ${deployment.web_url}`,
);
