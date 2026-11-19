import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { resultSchema, promptFor } from "./core.mjs";
// Keep model calls inside HTTP API's 29-second integration deadline. SDK
// retries could otherwise continue generating (and billing) after a disconnect.
const bedrock = new BedrockRuntimeClient({ maxAttempts: 1 });
// Bedrock's structured-output subset excludes length constraints. Keep the
// full size/content validation in resultSchema after decoding the response.
const documentFormat = {
  textFormat: {
    type: "json_schema",
    structure: {
      jsonSchema: {
        name: "tailored_documents",
        schema: JSON.stringify({
          type: "object",
          properties: {
            cv: {
              type: "string",
              description: "Full revised CV as plain text",
            },
            coverLetter: {
              type: "string",
              description:
                "Full cover letter as plain text, even if no original was supplied",
            },
            changes: { type: "array", items: { type: "string" } },
            missingKeywords: { type: "array", items: { type: "string" } },
          },
          required: ["cv", "coverLetter", "changes", "missingKeywords"],
          additionalProperties: false,
        }),
      },
    },
  },
};
const documentFields = new Set([
  "cv",
  "coverLetter",
  "changes",
  "missingKeywords",
]);
function decodeDocument(output) {
  let document;
  try {
    document = JSON.parse(
      output
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    // JSON parser messages can include CV text. Only return a fixed reason.
    return { reason: "invalid_json" };
  }
  const parsed = resultSchema.safeParse(document);
  if (parsed.success) return { data: parsed.data };
  return {
    reason: "invalid_fields",
    issues: parsed.error.issues.map((issue) => ({
      field: documentFields.has(issue.path[0]) ? issue.path[0] : "document",
      code: issue.code,
    })),
  };
}
export function createBedrockGenerator({
  client = bedrock,
  timeoutMs = 24000,
  modelId = process.env.BEDROCK_MODEL_ID,
  structuredOutput = process.env.BEDROCK_STRUCTURED_OUTPUT === "true" ||
    /anthropic\.claude-haiku-4-5/.test(modelId || ""),
  logger = console,
} = {}) {
  return async (job, source) => {
    if (!modelId)
      throw Object.assign(
        new Error(
          "AI tailoring is not configured. Set BEDROCK_MODEL_ID to an enabled Bedrock model.",
        ),
        { status: 503 },
      );
    const prompt = promptFor(job, source);
    const startedAt = performance.now();
    // A correction shares the original deadline; it must not restart the clock
    // or enable SDK retries after the caller has timed out.
    const abortSignal = AbortSignal.timeout(timeoutMs);
    let correction;
    for (let attempt = 1; attempt <= 2; attempt++) {
      abortSignal.throwIfAborted();
      const r = await client.send(
        new ConverseCommand({
          modelId,
          ...prompt,
          system: [...prompt.system, ...(correction ? [correction] : [])],
          ...(structuredOutput ? { outputConfig: documentFormat } : {}),
          inferenceConfig: {
            maxTokens: 7000,
            temperature: 0.35,
          },
        }),
        { abortSignal },
      );
      const output =
        r.output?.message?.content?.map((c) => c.text || "").join("") || "";
      if (r.stopReason && r.stopReason !== "end_turn") {
        logger.warn("AI document generation incomplete", {
          provider: "bedrock",
          attempt,
          stopReason: r.stopReason,
          requestId: r.$metadata?.requestId,
        });
        const message =
          r.stopReason === "max_tokens"
            ? "The AI response reached its output limit. Shorten the source documents and try again; no version was saved."
            : "The AI could not complete the documents. Review the source documents and try again; no version was saved.";
        throw Object.assign(new Error(message), { status: 502 });
      }
      const decoded = decodeDocument(output);
      if (decoded.data) return decoded.data;
      logger.warn("AI document validation failed", {
        provider: "bedrock",
        attempt,
        requestId: r.$metadata?.requestId,
        responseCharacters: output.length,
        ...decoded,
      });
      // Correct only invalid completed responses, with enough time to start a
      // useful attempt. Never retry refusals, truncation or provider failures.
      if (attempt === 2 || timeoutMs - (performance.now() - startedAt) < 5000)
        break;
      correction = {
        text: `The previous response failed document validation: ${JSON.stringify(decoded)}. Generate the complete result again. Follow every required field, type, character limit and array entry limit in the original instructions. Keep explanations and missing keywords brief. Return only the complete JSON object.`,
      };
    }
    throw Object.assign(
      new Error(
        "The AI returned an invalid document. Please try again; no version was saved.",
      ),
      { status: 502 },
    );
  };
}
