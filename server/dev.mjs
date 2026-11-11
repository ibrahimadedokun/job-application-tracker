import http from "node:http";
import { createApi } from "./api.mjs";
import { demoGenerate } from "./demo.mjs";
const demo = process.env.DEMO_AI !== "false";
const api = createApi(demo ? { generate: demoGenerate } : {});
const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.url === "/config.json") {
    res.end(JSON.stringify({ local: true, demo }));
    return;
  }
  let raw = "";
  try {
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 90000) {
        res.writeHead(413);
        res.end(JSON.stringify({ error: "Request too large." }));
        return;
      }
    }
    const result = await api({
      method: req.method,
      path: req.url.split("?")[0],
      body: raw ? JSON.parse(raw) : null,
      user: "local-developer",
    });
    res.writeHead(result.status);
    res.end(result.status === 204 ? "" : JSON.stringify(result.body));
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Invalid JSON request." }));
  }
});
server.listen(3001, "127.0.0.1", () =>
  console.log(
    "Local API on port 3001. Development identity only; do not expose publicly. AI requires AWS credentials and BEDROCK_MODEL_ID.",
  ),
);
