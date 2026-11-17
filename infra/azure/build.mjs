import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, relative, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const argument = (flag) =>
  process.argv.includes(flag)
    ? process.argv[process.argv.indexOf(flag) + 1]
    : undefined;
const output = resolve(root, argument("--output") || ".local/azure");
const outputRelative = relative(resolve(root, ".local"), output);
if (
  outputRelative.startsWith("..") ||
  isAbsolute(outputRelative) ||
  !outputRelative
)
  throw new Error(
    "Azure artifacts must be inside the workspace's .local directory.",
  );
function run(command, args, cwd = root) {
  // Only these fixed build commands are accepted; no user input enters a shell.
  if (![command, ...args].every((value) => /^[a-z0-9=-]+$/.test(value)))
    throw new Error("Unexpected build command.");
  const windows = process.platform === "win32";
  const result = spawnSync(
    windows ? process.env.ComSpec || "cmd.exe" : command,
    windows ? ["/d", "/s", "/c", [command, ...args].join(" ")] : args,
    {
      cwd,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}).`);
}
run("npm", ["run", "build"]);
// Clear only the two generated package directories inside this workspace.
for (const name of ["api", "web"]) {
  const target = resolve(output, name);
  if (
    relative(root, target).startsWith("..") ||
    target !== resolve(output, name)
  )
    throw new Error("Generated directory is outside the workspace.");
  await rm(target, { recursive: true, force: true });
}
await mkdir(`${output}/api`, { recursive: true });
await cp(`${root}/dist`, `${output}/web`, { recursive: true });
const configIndex = process.argv.indexOf("--config");
let apiOrigin = "https://example.azurewebsites.net";
if (configIndex >= 0) {
  const config = JSON.parse(
    await readFile(resolve(process.argv[configIndex + 1]), "utf8"),
  );
  if (
    config.provider !== "azure" ||
    config.local !== false ||
    !config.scope ||
    !config.clientId
  )
    throw new Error("Invalid Azure runtime configuration.");
  apiOrigin = new URL(config.apiUrl).origin;
  if (new URL(config.apiUrl).protocol !== "https:")
    throw new Error("Azure API must use HTTPS.");
  await writeFile(`${output}/web/config.json`, JSON.stringify(config, null, 2));
} else {
  // A validation build must never accidentally deploy stale configuration.
  await writeFile(
    `${output}/web/config.json`,
    JSON.stringify({ local: false, provider: "azure" }),
  );
}
await writeFile(
  `${output}/web/staticwebapp.config.json`,
  JSON.stringify(
    {
      navigationFallback: {
        rewrite: "/index.html",
        exclude: ["/assets/*", "/config.json"],
      },
      routes: [
        { route: "/config.json", headers: { "Cache-Control": "no-store" } },
        { route: "/index.html", headers: { "Cache-Control": "no-cache" } },
        {
          route: "/assets/*",
          headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        },
      ],
      globalHeaders: {
        "Content-Security-Policy": `default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${apiOrigin} https://login.microsoftonline.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://login.microsoftonline.com`,
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
      },
    },
    null,
    2,
  ),
);
const agentConfig = argument("--agent-config")
  ? JSON.parse(await readFile(argument("--agent-config"), "utf8"))
  : null;
await build({
  absWorkingDir: root,
  entryPoints: [
    process.argv.includes("--combo")
      ? "infra/combo/api/index.mjs"
      : "infra/azure/api/index.mjs",
  ],
  outfile: `${output}/api/index.mjs`,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["@azure/functions"],
  // Publishing pins the agent in code, without mutating Terraform app settings.
  define: agentConfig
    ? {
        "process.env.FOUNDRY_AGENT_VERSION": JSON.stringify(
          agentConfig.version,
        ),
      }
    : {},
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
for (const file of ["host.json", "package.json", "package-lock.json"])
  await cp(`${root}/infra/azure/api/${file}`, `${output}/api/${file}`);
run(
  "npm",
  ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  `${output}/api`,
);
console.log(`Azure frontend and Function package prepared in ${output}.`);
