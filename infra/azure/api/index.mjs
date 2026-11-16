import { app } from "@azure/functions";
import { createAzureHandler } from "./handler.mjs";

app.setup({ enableHttpStream: true });
app.http("folio", {
  route: "{*path}",
  methods: ["GET", "POST", "PATCH", "DELETE"],
  authLevel: "anonymous",
  handler: createAzureHandler(),
});
