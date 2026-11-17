import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const flag = process.argv.indexOf("--output");
const folder = resolve(
  flag < 0 ? ".local/check/combo" : process.argv[flag + 1],
);
const bundle = await readFile(resolve(folder, "api/index.mjs"), "utf8");
for (const required of [
  "BedrockRuntimeClient",
  "AssumeRoleWithWebIdentityCommand",
  "access_as_user",
])
  assert.ok(bundle.includes(required), `Missing ${required}`);
for (const excluded of ["DynamoDBClient", "agent_reference", "AIProjectClient"])
  assert.ok(!bundle.includes(excluded), `Unexpected ${excluded}`);
const web = JSON.parse(
  await readFile(resolve(folder, "web/staticwebapp.config.json"), "utf8"),
);
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
assert.equal(
  JSON.parse(await readFile(resolve(folder, "web/config.json"), "utf8")).local,
  false,
);
assert.equal(
  JSON.parse(await readFile(resolve(folder, "api/package.json"), "utf8")).main,
  "index.mjs",
);
console.log(
  "Combo package verified: Entra authentication, Bedrock federation, Azure storage and security headers.",
);
