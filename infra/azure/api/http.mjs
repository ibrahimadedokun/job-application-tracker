import { createAuthenticate } from "./auth.mjs";
export function createAzureHttpHandler({
  authenticate = createAuthenticate(),
  api,
}) {
  return async (request) => {
    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    const respond = (status, body) => ({
      status,
      headers,
      body: status === 204 ? "" : JSON.stringify(body),
    });
    // Never trust x-ms-client-principal: this Function App is directly reachable.
    const user = await authenticate(request.headers.get("authorization"));
    if (!user)
      return respond(401, {
        error: "Sign in to access your private workspace.",
      });
    let body = null;
    try {
      const chunks = [];
      let size = 0;
      if (request.body) {
        for await (const chunk of request.body) {
          size += chunk.byteLength;
          if (size > 90000)
            return respond(413, { error: "Request too large." });
          chunks.push(Buffer.from(chunk));
        }
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : null;
    } catch {
      return respond(400, { error: "Invalid JSON request." });
    }
    const result = await api({
      method: request.method,
      path: new URL(request.url).pathname,
      body,
      user,
    });
    return respond(result.status, result.body);
  };
}
