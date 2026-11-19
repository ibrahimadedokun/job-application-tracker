import test from "node:test";
import assert from "node:assert/strict";
import { readConfiguration, parseConfiguration } from "../infra/config.mjs";
import { createStore } from "../server/store.mjs";
import { makeJob } from "../server/core.mjs";
import { createApi } from "../server/api.mjs";
import { createBedrockGenerator } from "../server/bedrock.mjs";

test("deployment rejects missing or unsafe account, model and budget configuration", async () => {
  const example = await readConfiguration(
    "infra/environments/aws.dev.example.json",
  );
  const valid = {
    ...example,
    aws: { ...example.aws, model_id: "test.model-v1", extra_model_arns: [] },
  };
  assert.equal(parseConfiguration(valid).region, "eu-west-2");
  for (const input of [
    {},
    { ...valid, region: "eastus2" },
    ...["", "*", "eu.test.model-v1"].map((model_id) => ({
      ...valid,
      aws: { ...valid.aws, model_id },
    })),
    { ...valid, aws: { ...valid.aws, account_id: "invalid" } },
    {
      ...valid,
      aws: { ...valid.aws, cognito_domain_prefix: "Invalid prefix" },
    },
    {
      ...valid,
      aws: {
        ...valid.aws,
        extra_model_arns: ["arn:aws:bedrock:*::foundation-model/*"],
      },
    },
    { ...valid, budget: { email: "user@example.com", amount: NaN } },
  ])
    assert.throws(() => parseConfiguration(input));
});

test("DynamoDB lists every page consistently without exposing owner keys", async () => {
  const calls = [];
  const cursor = { pk: "USER#alice", sk: "JOB#one" };
  const store = createStore({
    table: "test",
    database: {
      async send(command) {
        calls.push(command.input);
        return calls.length === 1
          ? { Items: [{ ...cursor, id: "one" }], LastEvaluatedKey: cursor }
          : {};
      },
    },
  });
  assert.deepEqual(await store.list("alice"), [{ id: "one" }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].ExclusiveStartKey, cursor);
  assert.ok(
    calls.every(
      (call) =>
        call.ConsistentRead &&
        call.ExpressionAttributeValues[":pk"] === "USER#alice",
    ),
  );
});

test("all writes enforce record limits before reaching DynamoDB", async () => {
  let writes = 0;
  const store = createStore({
    table: "test",
    database: {
      async send() {
        writes++;
      },
    },
  });
  await assert.rejects(
    store.put("alice", { id: "one", notes: "界".repeat(120000) }),
    { status: 400 },
  );
  assert.equal(writes, 0);
});

test("Bedrock deadline returns a retryable error without saving a version", async (t) => {
  const previous = process.env.BEDROCK_MODEL_ID;
  process.env.BEDROCK_MODEL_ID = "test.model";
  t.after(() => {
    if (previous === undefined) delete process.env.BEDROCK_MODEL_ID;
    else process.env.BEDROCK_MODEL_ID = previous;
  });
  const job = makeJob({
    company: "Test",
    role: "Engineer",
    description:
      "An engineering role building accessible applications and collaborating with a team.",
  });
  let writes = 0;
  const generate = createBedrockGenerator({
    timeoutMs: 10,
    client: {
      send(command, { abortSignal }) {
        return new Promise((resolve, reject) => {
          // Keep this fake request alive, like an HTTP socket, until cancellation.
          const timer = setTimeout(resolve, 1000);
          abortSignal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(
                Object.assign(new Error("cancelled"), { name: "AbortError" }),
              );
            },
            { once: true },
          );
        });
      },
    },
  });
  const api = createApi({
    generate,
    store: {
      async get() {
        return job;
      },
      async put() {
        writes++;
      },
    },
  });
  const result = await api({
    method: "POST",
    path: `/api/jobs/${job.id}/tailor`,
    user: "alice",
    body: {
      cv: "A fictional engineer with accessible software experience.",
      consent: true,
    },
  });
  assert.equal(result.status, 504);
  assert.match(result.body.error, /No version was saved/);
  assert.equal(writes, 0);
});
