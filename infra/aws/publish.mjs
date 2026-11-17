import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

const outputs = JSON.parse(await readFile(process.argv[2], "utf8"));
if (outputs.cloud !== "aws") throw new Error("Expected AWS Terraform outputs.");
const { bucket, distribution_id, region } = outputs.release;
const s3 = new S3Client({ region });
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
async function upload(key, body) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: types[extname(key)] || "application/octet-stream",
      CacheControl: key.startsWith("assets/")
        ? "public, max-age=31536000, immutable"
        : "no-store",
    }),
  );
}
async function walk(directory, prefix = "") {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const key = prefix + item.name;
    if (item.isDirectory()) await walk(join(directory, item.name), key + "/");
    else if (key !== "index.html" && key !== "config.json")
      await upload(key, await readFile(join(directory, item.name)));
  }
}
await walk("dist");
await upload("config.json", JSON.stringify(outputs.runtime_config));
await upload("index.html", await readFile("dist/index.html"));
await new CloudFrontClient({ region }).send(
  new CreateInvalidationCommand({
    DistributionId: distribution_id,
    InvalidationBatch: {
      CallerReference: `folio-${Date.now()}`,
      Paths: { Quantity: 1, Items: ["/*"] },
    },
  }),
);
console.log(
  "AWS static assets and runtime configuration published; CloudFront invalidation requested.",
);
