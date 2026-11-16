import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { createStore } from "./store.mjs";
import { createApi as createApplication } from "./application.mjs";
import { resultSchema, promptFor } from "./core.mjs";
// Keep model calls inside HTTP API's 29-second integration deadline. SDK
// retries could otherwise continue generating (and billing) after a disconnect.
const bedrock = new BedrockRuntimeClient({ maxAttempts: 1 });
export function createBedrockGenerator({
  client = bedrock,
  timeoutMs = 24000,
} = {}) {
  return async (job, source) => {
    if (!process.env.BEDROCK_MODEL_ID)
      throw Object.assign(
        new Error(
          "AI tailoring is not configured. Set BEDROCK_MODEL_ID to an enabled Bedrock model.",
        ),
        { status: 503 },
      );
    const r = await client.send(
      new ConverseCommand({
        modelId: process.env.BEDROCK_MODEL_ID,
        ...promptFor(job, source),
        inferenceConfig: { maxTokens: 7000, temperature: 0.35 },
      }),
      { abortSignal: AbortSignal.timeout(timeoutMs) },
    );
    const output =
      r.output?.message?.content?.map((c) => c.text || "").join("") || "";
    try {
      return resultSchema.parse(
        JSON.parse(
          output.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
        ),
      );
    } catch {
      throw Object.assign(
        new Error(
          "The AI returned an invalid document. Please try again; no version was saved.",
        ),
        { status: 502 },
      );
    }
  };
}
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
