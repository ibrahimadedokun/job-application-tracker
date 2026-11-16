import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const folder = new URL("../../.local/azure/", import.meta.url);
const json = async (file) =>
  JSON.parse(await readFile(new URL(file, folder), "utf8"));
const template = await json("main.json");
const resources = template.resources;
const of = (type) => resources.find((resource) => resource.type === type);
const storage = of("Microsoft.Storage/storageAccounts");
assert.equal(storage.sku.name, "Standard_LRS");
assert.equal(storage.properties.allowBlobPublicAccess, false);
assert.equal(storage.properties.allowSharedKeyAccess, false);
assert.equal(storage.properties.supportsHttpsTrafficOnly, true);
assert.equal(of("Microsoft.Web/staticSites").sku.name, "Free");
assert.equal(of("Microsoft.Web/serverfarms").sku.name, "FC1");
const api = of("Microsoft.Web/sites");
assert.equal(api.properties.httpsOnly, true);
assert.equal(
  api.properties.functionAppConfig.scaleAndConcurrency.instanceMemoryMB,
  512,
);
assert.equal(
  api.properties.functionAppConfig.scaleAndConcurrency.alwaysReady,
  undefined,
);
assert.equal(
  api.properties.functionAppConfig.deployment.storage.authentication.type,
  "UserAssignedIdentity",
);
assert.equal(
  of("Microsoft.CognitiveServices/accounts").properties.disableLocalAuth,
  true,
);
assert.ok(of("Microsoft.CognitiveServices/accounts/projects"));
assert.ok(of("Microsoft.Authorization/locks"));
const settings = api.properties.siteConfig.appSettings;
assert.ok(
  !settings.some(({ name }) => /KEY$|SECRET$|CONNECTION_STRING$/.test(name)),
);
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
const bundle = await readFile(new URL("api/index.mjs", folder), "utf8");
assert.ok(bundle.includes("agent_reference"));
assert.ok(bundle.includes("access_as_user"));
assert.ok(!bundle.includes("BedrockRuntimeClient"));
assert.ok(!bundle.includes("DynamoDBClient"));
console.log(
  "Azure infrastructure checks passed: Free frontend, scale-to-zero API, private LRS storage, Entra validation, managed identities, Foundry agent, data retention and security headers.",
);
