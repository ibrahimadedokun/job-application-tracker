import test from "node:test";
import assert from "node:assert/strict";
import {
  readConfiguration,
  parseConfiguration,
  terraformVariables,
} from "../infra/config.mjs";
import { createFederatedCredentials } from "../infra/combo/api/credentials.mjs";
import { createBedrockGenerator } from "../server/bedrock.mjs";
import { regionValidationTemplate } from "../infra/combo/regions.mjs";

test("combo accepts GPT-6 Sol profiles and rejects regional or mismatched profile configuration", async () => {
  const config = await readConfiguration(
    "infra/environments/combo.dev.example.json",
  );
  const model =
    "arn:aws:bedrock:eu-west-2:123456789012:inference-profile/global.openai.gpt-6-sol";
  const aws = {
    ...config.aws,
    account_id: "123456789012",
    model_id: model,
    extra_model_arns: [
      "arn:aws:bedrock:::foundation-model/openai.gpt-6-sol",
      "arn:aws:bedrock:eu-west-2::foundation-model/openai.gpt-6-sol",
    ],
  };
  assert.equal(
    parseConfiguration({
      ...config,
      aws: { ...config.aws, model_id: "openai.gpt-oss-120b-1:0" },
    }).aws.model_id,
    "openai.gpt-oss-120b-1:0",
  );
  assert.equal(
    terraformVariables(parseConfiguration({ ...config, aws }), "/tmp/artifacts")
      .model_id,
    model,
  );
  for (const model_id of [
    "openai.gpt-6-sol",
    "arn:aws:bedrock:eu-west-2::foundation-model/openai.gpt-6-sol",
    model.replace("eu-west-2", "us-east-1"),
    model.replace("123456789012", "999999999999"),
  ]) {
    assert.throws(
      () => parseConfiguration({ ...config, aws: { ...aws, model_id } }),
      /profile/i,
    );
  }
  assert.throws(
    () =>
      parseConfiguration({ ...config, aws: { ...aws, extra_model_arns: [] } }),
    /destination/,
  );
  for (const invalid of [
    "arn:aws:bedrock:::foundation-model/*",
    "arn:aws:bedrock:::inference-profile/global.openai.gpt-6-sol",
    "arn:aws:bedrock:::foundation-model/openai.gpt-6-sol/invalid",
  ]) {
    assert.throws(
      () =>
        parseConfiguration({
          ...config,
          aws: { ...aws, extra_model_arns: [invalid] },
        }),
      /foundation-model/,
    );
  }
});

test("Bedrock requests support GPT reasoning profiles and preserve Nova sampling", async () => {
  const output = {
    cv: "A factual revised CV with accessible JavaScript experience.",
    coverLetter: "A factual cover letter for this engineering opportunity.",
    changes: ["Clarified experience"],
    missingKeywords: [],
  };
  for (const options of [
    {
      modelId:
        "arn:aws:bedrock:eu-west-2:123456789012:inference-profile/global.openai.gpt-6-sol",
    },
    {
      modelId:
        "arn:aws:bedrock:eu-west-2:123456789012:application-inference-profile/custom-id",
      openaiGpt: true,
    },
    { modelId: "amazon.nova-micro-v1:0", openaiGpt: false },
    { modelId: "openai.gpt-oss-120b-1:0" },
  ]) {
    let captured;
    const generate = createBedrockGenerator({
      ...options,
      client: {
        async send(command, { abortSignal }) {
          captured = command.input;
          assert.ok(abortSignal);
          return {
            output: {
              message: {
                content: [
                  { reasoningContent: {} },
                  { text: JSON.stringify(output) },
                ],
              },
            },
          };
        },
      },
    });
    assert.deepEqual(
      await generate(
        {
          company: "Test",
          role: "Engineer",
          description: "Accessible applications",
        },
        { cv: "Fictional experience" },
      ),
      output,
    );
    assert.equal(captured.modelId, options.modelId);
    assert.equal(captured.inferenceConfig.maxTokens, 7000);
    if (options.openaiGpt !== false && !options.modelId.includes("gpt-oss")) {
      assert.equal("temperature" in captured.inferenceConfig, false);
      assert.deepEqual(captured.additionalModelRequestFields, {
        reasoning: { effort: "low" },
      });
    } else {
      assert.equal(captured.inferenceConfig.temperature, 0.35);
      assert.equal(captured.additionalModelRequestFields, undefined);
    }
  }
});

test("combo selects both accounts, separate regions and the Bedrock model", async () => {
  const config = await readConfiguration(
    "infra/environments/combo.dev.example.json",
  );
  const vars = terraformVariables(config, "/tmp/artifacts");
  assert.equal(vars.region, "eastus2");
  assert.equal(vars.static_web_region, "eastus2");
  assert.equal(vars.aws_region, "eu-west-2");
  assert.equal(vars.model_id, config.aws.model_id);
  assert.equal(vars.subscription_id, config.azure.subscription_id);
  assert.equal(vars.account_id, config.aws.account_id);
  assert.equal(vars.foundry_region, undefined);
  for (const input of [
    { ...config, aws: undefined },
    { ...config, azure: undefined },
    { ...config, aws: { ...config.aws, region: undefined } },
    { ...config, aws: { ...config.aws, model_id: "*" } },
  ])
    assert.throws(() => parseConfiguration(input));
});

test("combo validates each service region and can preserve existing group metadata", async () => {
  const config = await readConfiguration(
    "infra/environments/combo.dev.example.json",
  );
  config.azure.resource_group_region = "westeurope";
  const vars = terraformVariables(config, "/tmp/artifacts");
  assert.equal(vars.resource_group_region, "westeurope");
  const template = regionValidationTemplate(config);
  assert.equal(template.resources.length, 4);
  for (const resource of template.resources) {
    assert.equal(resource.location, "eastus2");
  }
  const azureOnly = terraformVariables(
    { ...config, cloud: "azure" },
    "/tmp/artifacts",
  );
  assert.equal(azureOnly.static_web_region, undefined);
  assert.equal(azureOnly.resource_group_region, undefined);
});

test("federation coalesces requests, caches temporary credentials and refreshes before expiry", async () => {
  let clock = Date.now();
  let tokens = 0;
  let exchanges = 0;
  const credentials = createFederatedCredentials({
    roleArn: "arn:aws:iam::123456789012:role/combo",
    scope: "api://federation/.default",
    now: () => clock,
    identity: {
      async getToken(scope) {
        assert.equal(scope, "api://federation/.default");
        tokens++;
        return { token: "private-token" };
      },
    },
    sts: {
      async send(command, { abortSignal }) {
        exchanges++;
        assert.equal(command.input.WebIdentityToken, "private-token");
        assert.equal(command.input.DurationSeconds, 3600);
        assert.ok(abortSignal);
        return {
          Credentials: {
            AccessKeyId: "temporary-id",
            SecretAccessKey: "temporary-secret",
            SessionToken: "temporary-session",
            Expiration: new Date(clock + 3600000),
          },
        };
      },
    },
  });
  const results = await Promise.all([
    credentials(),
    credentials(),
    credentials(),
  ]);
  assert.equal(tokens, 1);
  assert.equal(exchanges, 1);
  assert.ok(results.every((result) => result === results[0]));
  assert.equal((await credentials()).sessionToken, "temporary-session");
  clock += 3400000;
  await credentials();
  assert.equal(exchanges, 2);
});

test("failed token exchange can be retried and incomplete credentials are rejected", async () => {
  let calls = 0;
  const credentials = createFederatedCredentials({
    roleArn: "test-role",
    scope: "test-scope",
    identity: {
      async getToken() {
        return { token: "private-token" };
      },
    },
    sts: {
      async send() {
        calls++;
        return {};
      },
    },
  });
  await assert.rejects(credentials, /incomplete/);
  await assert.rejects(credentials, /incomplete/);
  assert.equal(calls, 2);
});
