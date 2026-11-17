import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { resultSchema, promptFor } from "./core.mjs";
// Keep model calls inside HTTP API's 29-second integration deadline. SDK
// retries could otherwise continue generating (and billing) after a disconnect.
const bedrock = new BedrockRuntimeClient({ maxAttempts: 1 });
export function createBedrockGenerator({
  client = bedrock,
  timeoutMs = 24000,
  modelId = process.env.BEDROCK_MODEL_ID,
  openaiGpt = process.env.BEDROCK_OPENAI_GPT === "true" ||
    /(?:^|[/.])openai\.gpt-[0-9]/.test(modelId || ""),
} = {}) {
  return async (job, source) => {
    if (!modelId)
      throw Object.assign(
        new Error(
          "AI tailoring is not configured. Set BEDROCK_MODEL_ID to an enabled Bedrock model.",
        ),
        { status: 503 },
      );
    const r = await client.send(
      new ConverseCommand({
        modelId,
        ...promptFor(job, source),
        // Reasoning GPT models reject sampling controls with reasoning enabled.
        // The combo flag also covers application profiles with opaque names.
        inferenceConfig: {
          maxTokens: 7000,
          ...(openaiGpt ? {} : { temperature: 0.35 }),
        },
        ...(openaiGpt
          ? { additionalModelRequestFields: { reasoning: { effort: "low" } } }
          : {}),
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
