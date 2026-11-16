import { createHash } from "node:crypto";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

const conflict = () =>
  Object.assign(
    new Error(
      "This application changed in another session. Refresh and retry.",
    ),
    { status: 409 },
  );

export function createAzureStore({
  container,
  accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL,
} = {}) {
  if (!container) {
    if (!accountUrl) throw new Error("AZURE_STORAGE_ACCOUNT_URL is required.");
    container = new BlobServiceClient(
      accountUrl,
      new DefaultAzureCredential(),
    ).getContainerClient(process.env.AZURE_STORAGE_CONTAINER || "applications");
  }
  // Hash the verified tenant/object identity to avoid putting personal data in paths.
  const prefix = (user) =>
    `${createHash("sha256").update(user).digest("hex")}/`;
  const blob = (user, id) =>
    container.getBlockBlobClient(`${prefix(user)}${id}.json`);
  const read = async (client) => {
    try {
      const response = await client.download();
      const chunks = [];
      for await (const chunk of response.readableStreamBody)
        chunks.push(Buffer.from(chunk));
      return {
        job: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        etag: response.etag,
      };
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  };
  return {
    async list(user) {
      const jobs = [];
      // The SDK iterator follows continuation tokens across every page.
      for await (const item of container.listBlobsFlat({
        prefix: prefix(user),
      })) {
        const current = await read(container.getBlockBlobClient(item.name));
        if (current) jobs.push(current.job);
      }
      return jobs;
    },
    async get(user, id) {
      return (await read(blob(user, id)))?.job || null;
    },
    async put(user, job, expected) {
      const data = JSON.stringify(job);
      if (Buffer.byteLength(data) > 350000)
        throw Object.assign(
          new Error(
            "Application storage limit reached. Export your records before deleting old data.",
          ),
          { status: 400 },
        );
      const client = blob(user, job.id);
      let conditions = { ifNoneMatch: "*" };
      if (expected) {
        const current = await read(client);
        if (!current || current.job.revision !== expected) throw conflict();
        conditions = { ifMatch: current.etag };
      }
      try {
        await client.upload(data, Buffer.byteLength(data), {
          conditions,
          blobHTTPHeaders: {
            blobContentType: "application/json",
            blobCacheControl: "no-store",
          },
        });
      } catch (error) {
        if ([409, 412].includes(error.statusCode)) throw conflict();
        throw error;
      }
    },
    async remove(user, id) {
      await blob(user, id).deleteIfExists();
    },
  };
}
