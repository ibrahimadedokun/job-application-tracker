import assert from "node:assert/strict";

const site = process.argv.find((argument) => argument.startsWith("https://"));
if (!site)
  throw new Error(
    "Usage: node infra/azure/smoke.mjs https://YOUR-SITE.azurestaticapps.net [--tailor]",
  );
const configResponse = await fetch(new URL("/config.json", site), {
  cache: "no-store",
});
assert.equal(configResponse.status, 200);
const config = await configResponse.json();
assert.equal(config.provider, "azure");
assert.equal(config.local, false);
assert.ok(config.clientId && config.scope && config.apiUrl);
const anonymous = await fetch(`${config.apiUrl}/api/jobs`);
assert.equal(anonymous.status, 401);
console.log(
  "Frontend configuration and unauthenticated API protection passed.",
);
const token = process.env.AZURE_SMOKE_ACCESS_TOKEN;
if (!token) {
  console.log(
    "Set AZURE_SMOKE_ACCESS_TOKEN to an API access token from your signed-in browser session for CRUD checks. Add --tailor for billable AI generation.",
  );
  process.exit(0);
}
async function request(method, path, body, expected = 200) {
  const response = await fetch(config.apiUrl + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${path} failed (${response.status}).`,
  );
  return expected === 204 ? null : response.json();
}
const created = await request(
  "POST",
  "/api/jobs",
  {
    company: "Folio deployment smoke test",
    role: "Fictional engineer",
    description:
      "A fictional engineering opportunity building accessible JavaScript applications, reviewing code and collaborating with a team.",
  },
  201,
);
try {
  assert.ok(
    (await request("GET", "/api/jobs")).some((job) => job.id === created.id),
  );
  assert.equal(
    (await request("PATCH", `/api/jobs/${created.id}`, { status: "Interview" }))
      .status,
    "Interview",
  );
  assert.ok(
    (await request("GET", "/api/export")).applications.some(
      (job) => job.id === created.id,
    ),
  );
  if (process.argv.includes("--tailor")) {
    const tailored = await request(
      "POST",
      `/api/jobs/${created.id}/tailor`,
      {
        cv: "Alex Example is a fictional engineer. Built accessible JavaScript applications at Fictional Company and collaborated on code reviews.",
        coverLetter: "",
        consent: true,
      },
      201,
    );
    assert.equal(tailored.versions.length, 1);
    console.log("Live AI tailoring passed.");
  }
  console.log("Authenticated create, list, update and export checks passed.");
} finally {
  await request("DELETE", `/api/jobs/${created.id}`, null, 204);
  console.log("Smoke-test record deleted.");
}
