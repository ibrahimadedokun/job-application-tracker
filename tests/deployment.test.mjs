import test from "node:test";
import assert from "node:assert/strict";
import { deploymentConfig } from "../infra/aws/config.mjs";
import { createStore } from "../server/store.mjs";
import { makeJob } from "../server/core.mjs";
import { createApi, createBedrockGenerator } from "../server/api.mjs";

test("deployment rejects missing or unsafe account, model and budget configuration", () => {
  const valid = {
    AWS_ACCOUNT_ID: "123456789012",
    BEDROCK_MODEL_ID: "test.model-v1",
  };
  assert.equal(
    deploymentConfig(valid, { deployment: true }).region,
    "eu-west-2",
  );
  for (const env of [
    {},
    { ...valid, AWS_ACCOUNT_ID: "invalid" },
    { ...valid, BEDROCK_MODEL_ID: "" },
    { ...valid, BEDROCK_MODEL_ID: "*" },
    { ...valid, BEDROCK_MODEL_ID: "eu.test.model-v1" },
    {
      ...valid,
      BEDROCK_EXTRA_MODEL_ARNS: "arn:aws:bedrock:*::foundation-model/*",
    },
    { ...valid, BUDGET_EMAIL: "user@example.com", MONTHLY_BUDGET_USD: "NaN" },
  ])
    assert.throws(() => deploymentConfig(env, { deployment: true }));
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
