import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export function createStore({
  table = process.env.TABLE_NAME,
  directory = process.env.DATA_DIR || ".local/data",
} = {}) {
  const key = (user, id) => ({ pk: `USER#${user}`, sk: `JOB#${id}` });
  const file = (user, id) =>
    path.join(directory, encodeURIComponent(user), `${id}.json`);
  const strip = (item) => {
    if (!item) return null;
    const { pk, sk, ...data } = item;
    return data;
  };
  return {
    async list(user) {
      if (table) {
        let items = [],
          cursor;
        do {
          const r = await client.send(
            new QueryCommand({
              TableName: table,
              KeyConditionExpression: "pk = :pk",
              ExpressionAttributeValues: { ":pk": `USER#${user}` },
              ExclusiveStartKey: cursor,
            }),
          );
          items.push(...r.Items.map(strip));
          cursor = r.LastEvaluatedKey;
        } while (cursor);
        return items;
      }
      const { readdir } = await import("node:fs/promises");
      try {
        return await Promise.all(
          (await readdir(path.join(directory, encodeURIComponent(user))))
            .filter((f) => f.endsWith(".json"))
            .map(async (f) =>
              JSON.parse(
                await readFile(
                  path.join(directory, encodeURIComponent(user), f),
                  "utf8",
                ),
              ),
            ),
        );
      } catch (e) {
        if (e.code === "ENOENT") return [];
        throw e;
      }
    },
    async get(user, id) {
      if (table)
        return strip(
          (
            await client.send(
              new GetCommand({
                TableName: table,
                Key: key(user, id),
                ConsistentRead: true,
              }),
            )
          ).Item,
        );
      try {
        return JSON.parse(await readFile(file(user, id), "utf8"));
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    async put(user, job, expected) {
      if (table) {
        await client.send(
          new PutCommand({
            TableName: table,
            Item: { ...key(user, job.id), ...job },
            ConditionExpression: expected
              ? "revision = :expected"
              : "attribute_not_exists(pk)",
            ...(expected
              ? { ExpressionAttributeValues: { ":expected": expected } }
              : {}),
          }),
        );
        return;
      }
      await mkdir(path.dirname(file(user, job.id)), {
        recursive: true,
        mode: 0o700,
      });
      const tmp = file(user, job.id) + ".tmp";
      await writeFile(tmp, JSON.stringify(job), { mode: 0o600 });
      await rename(tmp, file(user, job.id));
    },
    async remove(user, id) {
      if (table)
        await client.send(
          new DeleteCommand({ TableName: table, Key: key(user, id) }),
        );
      else {
        const { rm } = await import("node:fs/promises");
        await rm(file(user, id), { force: true });
      }
    },
  };
}
