import { app } from "@azure/functions";
import { createApi } from "../../../server/application.mjs";
import { createAzureStore } from "./store.mjs";
import { createFoundryGenerator } from "./agent.mjs";
import { createAzureHttpHandler } from "./http.mjs";

app.setup({ enableHttpStream: true });
app.http("folio", {
  route: "{*path}",
  methods: ["GET", "POST", "PATCH", "DELETE"],
  authLevel: "anonymous",
  handler: createAzureHttpHandler({
    api: createApi({
      store: createAzureStore(),
      generate: createFoundryGenerator(),
    }),
  }),
});
