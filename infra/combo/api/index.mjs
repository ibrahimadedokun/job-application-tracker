import { app } from "@azure/functions";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { createApi } from "../../../server/application.mjs";
import { createBedrockGenerator } from "../../../server/bedrock.mjs";
import { createAzureHttpHandler } from "../../azure/api/http.mjs";
import { createAzureStore } from "../../azure/api/store.mjs";
import { createFederatedCredentials } from "./credentials.mjs";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
  credentials: createFederatedCredentials(),
  maxAttempts: 1,
});
app.setup({ enableHttpStream: true });
app.http("folio", {
  route: "{*path}",
  methods: ["GET", "POST", "PATCH", "DELETE"],
  authLevel: "anonymous",
  handler: createAzureHttpHandler({
    api: createApi({
      store: createAzureStore(),
      generate: createBedrockGenerator({ client, timeoutMs: 55000 }),
    }),
  }),
});
