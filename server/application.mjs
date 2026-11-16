import { randomUUID } from "node:crypto";
import { makeJob, updateJob, sourceSchema, resultSchema } from "./core.mjs";
export function createApi({ store, generate } = {}) {
  return async function api({ method, path, body, user }) {
    const response = (status, data) => ({ status, body: data });
    if (!user)
      return response(401, {
        error: "Sign in to access your private workspace.",
      });
    try {
      if (Buffer.byteLength(JSON.stringify(body || {})) > 90000)
        return response(413, { error: "Request too large." });
      if (path === "/api/jobs" && method === "GET")
        return response(200, await store.list(user));
      if (path === "/api/export" && method === "GET")
        return response(200, {
          exportedAt: new Date().toISOString(),
          applications: await store.list(user),
        });
      if (path === "/api/jobs" && method === "POST") {
        const job = makeJob(body);
        await store.put(user, job);
        return response(201, job);
      }
      const match = path.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/tailor)?$/);
      if (!match) return response(404, { error: "Not found." });
      const [, id, tailor] = match;
      const job = await store.get(user, id);
      if (!job) return response(404, { error: "Application not found." });
      if (tailor && method === "POST") {
        const source = sourceSchema.parse(body);
        if (job.description.length < 60)
          return response(400, {
            error: "Add a job description of at least 60 characters first.",
          });
        if (job.versions.length >= 8)
          return response(400, {
            error:
              "Eight versions are retained per application. Create a new application for further drafts.",
          });
        // Keep records below the shared storage cap, including DynamoDB's 400KB limit.
        if (
          Buffer.byteLength(JSON.stringify(job)) +
            Buffer.byteLength(JSON.stringify(source)) +
            50000 >
          340000
        )
          return response(400, {
            error:
              "Document storage limit reached for this application. Export your records before deleting it.",
          });
        const output = await generate(job, source);
        const parsed = resultSchema.safeParse(output);
        if (!parsed.success)
          return response(502, {
            error: "The AI returned an invalid document. No version was saved.",
          });
        const generated = parsed.data;
        const version = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          source: { cv: source.cv, coverLetter: source.coverLetter },
          ...generated,
        };
        const updated = {
          ...job,
          versions: [...job.versions, version],
          revision: randomUUID(),
          updatedAt: new Date().toISOString(),
        };
        if (Buffer.byteLength(JSON.stringify(updated)) > 350000)
          return response(400, {
            error:
              "Generated documents exceed the storage limit. Shorten your source documents and try again.",
          });
        await store.put(user, updated, job.revision);
        return response(201, updated);
      }
      if (!tailor && method === "PATCH") {
        const updated = updateJob(job, body);
        await store.put(user, updated, job.revision);
        return response(200, updated);
      }
      if (!tailor && method === "DELETE") {
        await store.remove(user, id);
        return response(204, null);
      }
      return response(405, { error: "Method not allowed." });
    } catch (e) {
      if (e.name === "ZodError")
        return response(400, {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
      if (e.name === "ConditionalCheckFailedException")
        return response(409, {
          error:
            "This application changed in another session. Refresh and retry.",
        });
      if (e.name === "AccessDeniedException")
        return response(503, {
          error:
            "Bedrock access is unavailable. Check the model access and region configuration.",
        });
      if (e.name === "ThrottlingException")
        return response(429, {
          error: "AI service is busy. Please wait and try again.",
        });
      if (
        e.name === "AbortError" ||
        e.name === "TimeoutError" ||
        e.name === "ModelTimeoutException"
      )
        return response(504, {
          error:
            "AI generation timed out. No version was saved. Try a shorter document or a faster model.",
        });
      return response(e.status || 500, {
        error: e.status
          ? e.message
          : "Unable to complete this request. Please try again.",
      });
    }
  };
}
