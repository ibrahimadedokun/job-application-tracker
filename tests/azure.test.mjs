import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { createAuthenticate } from "../infra/azure/api/auth.mjs";
import { createAzureStore } from "../infra/azure/api/store.mjs";
import { createFoundryGenerator } from "../infra/azure/api/agent.mjs";
import { createAzureHttpHandler } from "../infra/azure/api/http.mjs";
import { createApi } from "../server/api.mjs";
import { makeJob } from "../server/core.mjs";

const tenantId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const input = {
  company: "Azure test",
  role: "Engineer",
  description:
    "An engineering role building accessible JavaScript applications and collaborating with a team.",
};
const source = {
  cv: "A fictional engineer experienced in building accessible JavaScript applications.",
  consent: true,
};

test("Azure verifies token signatures, tenant, audience, client, expiry and delegated scope", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const authenticate = createAuthenticate({
    tenantId,
    clientId,
    keySet: publicKey,
  });
  const token = async (overrides = {}) =>
    new SignJWT({
      tid: tenantId,
      oid: "alice",
      azp: clientId,
      scp: "access_as_user",
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
      .setAudience(clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  assert.equal(
    await authenticate(`Bearer ${await token()}`),
    `${tenantId}:alice`,
  );
  for (const overrides of [
    { tid: "other" },
    { azp: "other" },
    { scp: "openid" },
    { oid: null },
  ])
    assert.equal(await authenticate(`Bearer ${await token(overrides)}`), null);
  const invalidAudience = await new SignJWT({
    tid: tenantId,
    oid: "alice",
    azp: clientId,
    scp: "access_as_user",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience("some-other-api")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  assert.equal(await authenticate(`Bearer ${invalidAudience}`), null);
  const expired = await new SignJWT({
    tid: tenantId,
    oid: "alice",
    azp: clientId,
    scp: "access_as_user",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(clientId)
    .setIssuedAt()
    .setExpirationTime(1)
    .sign(privateKey);
  assert.equal(await authenticate(`Bearer ${expired}`), null);
  const { privateKey: otherKey } = await generateKeyPair("RS256");
  const forged = await new SignJWT({
    tid: tenantId,
    oid: "alice",
    azp: clientId,
    scp: "access_as_user",
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(`https://login.microsoftonline.com/${tenantId}/v2.0`)
    .setAudience(clientId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(otherKey);
  assert.equal(await authenticate(`Bearer ${forged}`), null);
  assert.equal(await authenticate(null), null);
  assert.equal(await authenticate("Bearer forged-header"), null);
});

function blobFixture() {
  const records = new Map();
  let sequence = 0;
  let race = false;
  const failure = (statusCode) =>
    Object.assign(new Error("Storage failure"), { statusCode });
  const container = {
    async *listBlobsFlat({ prefix }) {
      // Yield records individually, as happens across continuation pages.
      for (const name of records.keys())
        if (name.startsWith(prefix)) yield { name };
    },
    getBlockBlobClient(name) {
      return {
        async download() {
          const record = records.get(name);
          if (!record) throw failure(404);
          return {
            etag: record.etag,
            readableStreamBody: (async function* () {
              yield Buffer.from(record.data);
            })(),
          };
        },
        async upload(data, length, { conditions }) {
          assert.equal(length, Buffer.byteLength(data));
          const current = records.get(name);
          if (
            (conditions.ifNoneMatch && current) ||
            (conditions.ifMatch &&
              (race || current?.etag !== conditions.ifMatch))
          )
            throw failure(412);
          records.set(name, { data, etag: String(++sequence) });
        },
        async deleteIfExists() {
          records.delete(name);
        },
      };
    },
  };
  return {
    store: createAzureStore({ container }),
    race: () => {
      race = true;
    },
  };
}

test("Azure Blob storage isolates users, lists records, guards creates and rejects stale updates", async () => {
  const { store, race } = blobFixture();
  const job = makeJob(input);
  await store.put("alice", job);
  await store.put("alice", makeJob(input));
  assert.equal((await store.list("alice")).length, 2);
  assert.deepEqual(await store.list("bob"), []);
  assert.equal(await store.get("bob", job.id), null);
  await assert.rejects(store.put("alice", job), { status: 409 });
  await assert.rejects(
    store.put("alice", { ...job, notes: "stale" }, "old-revision"),
    { status: 409 },
  );
  const updated = { ...job, revision: "new-revision", notes: "Updated" };
  await store.put("alice", updated, job.revision);
  assert.equal((await store.get("alice", job.id)).notes, "Updated");
  race();
  await assert.rejects(
    store.put("alice", { ...updated, notes: "Lost update" }, updated.revision),
    { status: 409 },
  );
  assert.equal((await store.get("alice", job.id)).notes, "Updated");
  await assert.rejects(
    store.put("alice", { ...job, notes: "界".repeat(120000) }),
    { status: 400 },
  );
  await store.remove("alice", job.id);
  assert.equal(await store.get("alice", job.id), null);
});

test("Azure HTTP adapter rejects spoofed identities, malformed JSON and oversized streams", async () => {
  const handler = createAzureHttpHandler({
    authenticate: async (header) =>
      header === "Bearer valid" ? "alice" : null,
    api: createApi({
      store: blobFixture().store,
      generate: async () => {
        throw new Error("unused");
      },
    }),
  });
  const request = (body, authorization = "Bearer valid") =>
    new Request("https://api.example/api/jobs", {
      method: "POST",
      headers: { authorization, "x-ms-client-principal": "spoofed" },
      body,
    });
  assert.equal((await handler(request("{}", ""))).status, 401);
  assert.equal((await handler(request("{"))).status, 400);
  assert.equal((await handler(request("x".repeat(90001)))).status, 413);
  const created = await handler(request(JSON.stringify(input)));
  assert.equal(created.status, 201);
  assert.equal(created.headers["cache-control"], "no-store");
  const list = await handler(
    new Request("https://api.example/api/jobs", {
      headers: { authorization: "Bearer valid" },
    }),
  );
  assert.equal(JSON.parse(list.body).length, 1);
});

test("Foundry invokes a pinned prompt agent without shared conversation state or automatic retries", async () => {
  let captured;
  const output = {
    cv: "A factual revised CV with accessible JavaScript experience.",
    coverLetter: "A factual cover letter for this engineering opportunity.",
    changes: ["Clarified experience"],
    missingKeywords: [],
  };
  const generate = createFoundryGenerator({
    agentName: "tailoring",
    agentVersion: "3",
    client: {
      responses: {
        async create(body, options) {
          captured = { body, options };
          return { status: "completed", output_text: JSON.stringify(output) };
        },
      },
    },
  });
  assert.deepEqual(await generate(makeJob(input), source), output);
  assert.deepEqual(captured.options.body.agent, {
    name: "tailoring",
    version: "3",
    type: "agent_reference",
  });
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.conversation, undefined);
  assert.equal(captured.options.maxRetries, 0);
  assert.ok(captured.options.signal instanceof AbortSignal);
  assert.equal(JSON.parse(captured.body.input).originalCV, source.cv);
});

test("Foundry errors, truncation and invalid output never persist a document version", async () => {
  for (const [response, expectedStatus] of [
    [{ status: "completed", output_text: "invalid" }, 502],
    [{ status: "incomplete", output_text: "{}" }, 502],
    [
      Object.assign(new Error("sensitive upstream detail"), { status: 429 }),
      429,
    ],
    [
      Object.assign(new Error("sensitive timeout"), {
        name: "APIConnectionTimeoutError",
      }),
      504,
    ],
    [Object.assign(new Error("sensitive permissions"), { status: 403 }), 503],
  ]) {
    const store = blobFixture().store;
    const job = makeJob(input);
    await store.put("alice", job);
    const generate = createFoundryGenerator({
      agentName: "tailoring",
      agentVersion: "1",
      client: {
        responses: {
          async create() {
            if (response instanceof Error) throw response;
            return response;
          },
        },
      },
    });
    const api = createApi({ store, generate });
    const result = await api({
      method: "POST",
      path: `/api/jobs/${job.id}/tailor`,
      body: source,
      user: "alice",
    });
    assert.equal(result.status, expectedStatus);
    assert.ok(!result.body.error.includes("sensitive"));
    assert.equal((await store.get("alice", job.id)).versions.length, 0);
  }
});
