import { AIProjectClient } from "@azure/ai-projects";
import { AzureCliCredential } from "@azure/identity";
import { promptFor } from "../../server/core.mjs";
import { writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

const [endpoint, name, model, output] = process.argv.slice(2);
if (!endpoint || !name || !model || !output)
  throw new Error(
    "Usage: node provision-agent.mjs ENDPOINT AGENT_NAME MODEL_DEPLOYMENT OUTPUT_FILE",
  );
const project = new AIProjectClient(endpoint, new AzureCliCredential());
for (let attempt = 0; ; attempt++) {
  try {
    const agent = await project.agents.createVersion(name, {
      kind: "prompt",
      model,
      instructions: promptFor({}, {}).system[0].text,
      tools: [],
      text: { format: { type: "json_object" } },
    });
    await writeFile(
      output,
      JSON.stringify({ name: agent.name, version: agent.version }, null, 2),
    );
    console.log(
      `Provisioned Foundry prompt agent ${agent.name}, version ${agent.version}.`,
    );
    break;
  } catch (error) {
    if (
      ![401, 403, 429].includes(error.statusCode || error.status) ||
      attempt >= 19
    )
      throw error;
    console.log("Waiting for Foundry permissions/quota to become available...");
    await setTimeout(15000);
  }
}
