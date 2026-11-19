import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const flag = process.argv.indexOf("--output");
const combo = process.argv.includes("--combo");
const folder = resolve(
  flag < 0
    ? combo
      ? ".local/check/combo"
      : ".local/azure"
    : process.argv[flag + 1],
);
const json = async (file) =>
  JSON.parse(await readFile(resolve(folder, file), "utf8"));
const web = await json("web/staticwebapp.config.json");
assert.ok(
  web.globalHeaders["Content-Security-Policy"].includes(
    "frame-ancestors 'none'",
  ),
);
assert.equal(
  web.routes.find((route) => route.route === "/config.json").headers[
    "Cache-Control"
  ],
  "no-store",
);
assert.equal((await json("web/config.json")).local, false);
assert.equal((await json("api/package.json")).main, "index.mjs");
const apiLock = await json("api/package-lock.json");
assert.ok(
  Object.entries(apiLock.packages).every(
    ([name, value]) =>
      !name.startsWith("..") &&
      !value.link &&
      !value.resolved?.startsWith("file:"),
  ),
  "The deployable API must not contain local package links.",
);
const bundle = await readFile(resolve(folder, "api/index.mjs"), "utf8");
const required = combo
  ? [
      "BedrockRuntimeClient",
      "AssumeRoleWithWebIdentityCommand",
      "access_as_user",
    ]
  : ["agent_reference", "access_as_user"];
const excluded = combo
  ? ["DynamoDBClient", "agent_reference", "AIProjectClient"]
  : ["BedrockRuntimeClient", "DynamoDBClient"];
for (const name of required)
  assert.ok(bundle.includes(name), `Missing ${name}`);
for (const name of excluded)
  assert.ok(!bundle.includes(name), `Unexpected ${name}`);
console.log(
  `${combo ? "Combo" : "Azure"} package checks passed: security headers, Entra scope, model adapter and isolated dependencies.`,
);
