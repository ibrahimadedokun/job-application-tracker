import test from "node:test";
import assert from "node:assert/strict";
import { createBedrockGenerator } from "../server/bedrock.mjs";
import { createApi } from "../server/application.mjs";
import { makeJob } from "../server/core.mjs";

const output = {
  cv: "Alex Smith builds accessible JavaScript applications.",
  coverLetter:
    "I would welcome the opportunity to build accessible applications with your team.",
  changes: ["Highlighted relevant experience"],
  missingKeywords: [],
};
const job = makeJob({
  company: "Example",
  role: "Engineer",
  description:
    "Build accessible JavaScript applications and collaborate with the engineering team.",
});
const source = {
  cv: "Alex Smith builds accessible JavaScript applications.",
  consent: true,
};
function generator(response, logs = []) {
  return createBedrockGenerator({
    modelId: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    logger: { warn: (...entry) => logs.push(entry) },
    client: {
      async send() {
        return response;
      },
    },
  });
}
function response(text, stopReason = "end_turn") {
  return { stopReason, output: { message: { content: [{ text }] } } };
}

test("Bedrock accepts complete JSON and whitespace-wrapped legacy code fences", async () => {
  for (const text of [
    JSON.stringify(output),
    `\n  \`\`\`json\n${JSON.stringify(output)}\n\`\`\`  \n`,
  ]) {
    assert.deepEqual(await generator(response(text))(job, source), output);
  }
});

test("Bedrock rejects truncated, refused, malformed and schema-invalid results without saving", async () => {
  for (const [reply, message] of [
    [response(JSON.stringify(output), "max_tokens"), /output limit/],
    [
      response(JSON.stringify(output), "guardrail_intervened"),
      /could not complete/,
    ],
    [
      response("I cannot complete this request.", "content_filtered"),
      /could not complete/,
    ],
    [response('{"cv": "unfinished'), /invalid document/],
    [
      response(JSON.stringify({ ...output, cv: { summary: output.cv } })),
      /invalid document/,
    ],
    [
      response(JSON.stringify({ ...output, coverLetter: "" })),
      /invalid document/,
    ],
    [
      response(JSON.stringify({ ...output, changes: "Made changes" })),
      /invalid document/,
    ],
    [
      response(
        JSON.stringify({ ...output, missingKeywords: ["x".repeat(101)] }),
      ),
      /invalid document/,
    ],
    [response(""), /invalid document/],
  ]) {
    let writes = 0;
    const logs = [];
    const api = createApi({
      generate: generator(reply, logs),
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
      user: "test",
      body: source,
    });
    assert.equal(result.status, 502);
    assert.match(result.body.error, message);
    assert.equal(writes, 0);
    assert.equal(logs.length, reply.stopReason === "end_turn" ? 2 : 1);
  }
});

test("CV-only tailoring corrects invalid output once and saves only the validated result", async () => {
  for (const invalid of [
    '{"cv":"private candidate text with broken JSON',
    JSON.stringify({ ...output, coverLetter: "" }),
    JSON.stringify({ ...output, cv: { summary: "private candidate text" } }),
    JSON.stringify({
      ...output,
      changes: ["private candidate text".repeat(30)],
    }),
    JSON.stringify({
      ...output,
      missingKeywords: Array(31).fill("Kubernetes"),
    }),
  ]) {
    const calls = [];
    const logs = [];
    const generate = createBedrockGenerator({
      modelId: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      logger: { warn: (...entry) => logs.push(entry) },
      client: {
        async send(command, { abortSignal }) {
          calls.push({ input: command.input, abortSignal });
          return response(
            calls.length === 1 ? invalid : JSON.stringify(output),
          );
        },
      },
    });
    const writes = [];
    const api = createApi({
      generate,
      store: {
        async get() {
          return job;
        },
        async put(...arguments_) {
          writes.push(arguments_);
        },
      },
    });
    const result = await api({
      method: "POST",
      path: `/api/jobs/${job.id}/tailor`,
      user: "test",
      body: source,
    });
    assert.equal(result.status, 201);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].abortSignal, calls[1].abortSignal);
    assert.deepEqual(calls[0].input.messages, calls[1].input.messages);
    assert.deepEqual(calls[0].input.outputConfig, calls[1].input.outputConfig);
    assert.equal(
      calls[1].input.system.length,
      calls[0].input.system.length + 1,
    );
    assert.match(
      calls[1].input.system.at(-1).text,
      /failed document validation/,
    );
    assert.ok(
      !calls[1].input.system.at(-1).text.includes("private candidate text"),
    );
    assert.ok(!JSON.stringify(logs).includes("private candidate text"));
    assert.equal(writes.length, 1);
    assert.equal(result.body.versions.length, 1);
    const [version] = result.body.versions;
    assert.equal(version.source.coverLetter, "");
    assert.equal(version.cv, output.cv);
    assert.equal(version.coverLetter, output.coverLetter);
  }
});

test("Bedrock validation diagnostics identify fields without including document content", async () => {
  const logs = [];
  const reply = response(
    JSON.stringify({
      ...output,
      missingKeywords: ["private candidate text".repeat(6)],
    }),
  );
  reply.$metadata = { requestId: "test-request-id" };
  await assert.rejects(generator(reply, logs)(job, source), { status: 502 });
  assert.equal(logs.length, 2);
  assert.deepEqual(logs[0][1], {
    provider: "bedrock",
    attempt: 1,
    requestId: "test-request-id",
    responseCharacters: reply.output.message.content[0].text.length,
    reason: "invalid_fields",
    issues: [{ field: "missingKeywords", code: "too_big" }],
  });
  assert.ok(!JSON.stringify(logs).includes("private candidate text"));
});

test("Bedrock skips correction near its deadline and never retries provider failures", async () => {
  for (const providerFailure of [false, true]) {
    let calls = 0;
    const generate = createBedrockGenerator({
      modelId: "test.model",
      timeoutMs: providerFailure ? 24000 : 100,
      logger: { warn() {} },
      client: {
        async send() {
          calls++;
          if (providerFailure)
            throw Object.assign(new Error("busy"), {
              name: "ThrottlingException",
            });
          return response("invalid JSON");
        },
      },
    });
    await assert.rejects(
      generate(job, source),
      providerFailure ? { name: "ThrottlingException" } : { status: 502 },
    );
    assert.equal(calls, 1);
  }
});
