import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { promptFor, resultSchema } from "../../../server/core.mjs";

export function createFoundryGenerator({
  client,
  endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT,
  agentName = process.env.FOUNDRY_AGENT_NAME,
  agentVersion = process.env.FOUNDRY_AGENT_VERSION,
  timeoutMs = 55000,
} = {}) {
  if (!client) {
    if (!endpoint) throw new Error("FOUNDRY_PROJECT_ENDPOINT is required.");
    client = new AIProjectClient(
      endpoint,
      new DefaultAzureCredential(),
    ).getOpenAIClient({ maxRetries: 0, timeout: timeoutMs });
  }
  return async (job, source) => {
    if (!agentName || !agentVersion)
      throw Object.assign(
        new Error(
          "The Foundry tailoring agent has not been provisioned. Run the Azure deployment script.",
        ),
        { status: 503 },
      );
    let response;
    try {
      response = await client.responses.create(
        {
          input: promptFor(job, source).messages[0].content[0].text,
          store: false,
          max_output_tokens: 7000,
        },
        {
          body: {
            agent: {
              name: agentName,
              version: agentVersion,
              type: "agent_reference",
            },
          },
          signal: AbortSignal.timeout(timeoutMs),
          maxRetries: 0,
        },
      );
    } catch (error) {
      if (
        [
          "AbortError",
          "TimeoutError",
          "APIConnectionTimeoutError",
          "APIUserAbortError",
        ].includes(error.name)
      )
        throw Object.assign(
          new Error(
            "AI generation timed out. No version was saved. Try a shorter document.",
          ),
          { status: 504 },
        );
      if (error.status === 429)
        throw Object.assign(
          new Error(
            "The AI service is busy or its quota is exhausted. Wait and try again.",
          ),
          { status: 429 },
        );
      throw Object.assign(
        new Error(
          "Foundry tailoring is unavailable. Check the agent deployment, permissions and model quota.",
        ),
        { status: 503 },
      );
    }
    try {
      if (response.status !== "completed")
        throw new Error("Incomplete response");
      return resultSchema.parse(JSON.parse(response.output_text));
    } catch {
      throw Object.assign(
        new Error(
          "The AI returned an invalid document. No version was saved. Please try again.",
        ),
        { status: 502 },
      );
    }
  };
}
