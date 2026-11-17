import { createApi } from "../../../server/application.mjs";
import { createAzureStore } from "./store.mjs";
import { createFoundryGenerator } from "./agent.mjs";
import { createAzureHttpHandler } from "./http.mjs";

export function createAzureHandler({
  authenticate,
  api = createApi({
    store: createAzureStore(),
    generate: createFoundryGenerator(),
  }),
} = {}) {
  return createAzureHttpHandler({ authenticate, api });
}
