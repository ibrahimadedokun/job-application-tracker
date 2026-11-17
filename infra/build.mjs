import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function buildAws(artifacts) {
  await mkdir(artifacts, { recursive: true });
  await build({
    entryPoints: ["server/api.mjs"],
    outfile: resolve(artifacts, "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  });
}
