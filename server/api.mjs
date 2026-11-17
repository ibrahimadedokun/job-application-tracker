import { createStore } from "./store.mjs";
import { createApi as createApplication } from "./application.mjs";
import { createBedrockGenerator } from "./bedrock.mjs";
export { createBedrockGenerator } from "./bedrock.mjs";
export function createApi({
  store = createStore(),
  generate = createBedrockGenerator(),
} = {}) {
  return createApplication({ store, generate });
}
export const api = createApi();
export async function handler(event) {
  let body;
  try {
    body = JSON.parse(
      event.isBase64Encoded
        ? Buffer.from(event.body || "", "base64").toString()
        : event.body || "null",
    );
  } catch {
    return {
      statusCode: 400,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify({ error: "Invalid JSON request." }),
    };
  }
  const result = await api({
    method: event.requestContext.http.method,
    path: event.rawPath,
    body,
    user: event.requestContext.authorizer?.jwt?.claims?.sub,
  });
  return {
    statusCode: result.status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    body: result.status === 204 ? "" : JSON.stringify(result.body),
  };
}
