import test from "node:test";
import assert from "node:assert/strict";
import {
  readConfiguration,
  parseConfiguration,
  terraformVariables,
} from "../infra/config.mjs";

test("one deployment interface maps configuration to the chosen Terraform target", async () => {
  const aws = await readConfiguration(
    "infra/environments/aws.dev.example.json",
  );
  const azure = await readConfiguration(
    "infra/environments/azure.dev.example.json",
  );
  const awsVariables = terraformVariables(aws, "C:\\workspace\\artifacts");
  const azureVariables = terraformVariables(azure, "/workspace/artifacts");
  assert.equal(awsVariables.account_id, aws.aws.account_id);
  assert.equal(
    awsVariables.lambda_bundle_path,
    "C:/workspace/artifacts/index.mjs",
  );
  assert.equal(awsVariables.subscription_id, undefined);
  assert.equal(azureVariables.subscription_id, azure.azure.subscription_id);
  assert.equal(azureVariables.tenant_id, azure.azure.tenant_id);
  assert.equal(azureVariables.account_id, undefined);
  assert.equal(azureVariables.lambda_bundle_path, undefined);
  assert.equal(azureVariables.model_id, "gpt-4.1-nano");
  assert.deepEqual(azure.backend, { type: "local", config: {} });
});

test("deployment configuration rejects unsafe state paths and incomplete or invalid targets", async () => {
  const aws = await readConfiguration(
    "infra/environments/aws.dev.example.json",
  );
  const azure = await readConfiguration(
    "infra/environments/azure.dev.example.json",
  );
  for (const input of [
    { ...aws, cloud: "other" },
    { ...aws, environment: "../../production" },
    { ...aws, name: "bad/path" },
    { ...aws, aws: undefined },
    { ...aws, aws: { ...aws.aws, model_id: "*" } },
    { ...aws, aws: { ...aws.aws, account_id: "invalid" } },
    { ...azure, azure: { ...azure.azure, subscription_id: "invalid" } },
    { ...azure, azure: { ...azure.azure, model_sku: "ProvisionedManaged" } },
    {
      ...azure,
      azure: { ...azure.azure, extra_origins: ["https://example.com/"] },
    },
  ])
    assert.throws(() => parseConfiguration(input));
});
