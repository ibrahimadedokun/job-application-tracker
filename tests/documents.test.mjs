import test from "node:test";
import assert from "node:assert/strict";
import { Document, Packer, Paragraph } from "docx";
import { extractDocxText } from "../src/docx-input.js";
import { createDocxBlob } from "../src/docx-output.js";

test("extracts DOCX text and generates a downloadable DOCX", async () => {
  const source = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: "Alex Smith" }),
            new Paragraph({ text: "Accessible software engineer" }),
          ],
        },
      ],
    }),
  );
  const sourceArrayBuffer = source.buffer.slice(
    source.byteOffset,
    source.byteOffset + source.byteLength,
  );

  const extracted = await extractDocxText(sourceArrayBuffer);
  assert.match(extracted, /Alex Smith/);
  assert.match(extracted, /Accessible software engineer/);

  const output = await createDocxBlob("Tailored CV", extracted);
  assert.equal(
    output.type,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  const outputBytes = Buffer.from(await output.arrayBuffer());
  assert.equal(outputBytes.subarray(0, 2).toString(), "PK");
  const outputArrayBuffer = outputBytes.buffer.slice(
    outputBytes.byteOffset,
    outputBytes.byteOffset + outputBytes.byteLength,
  );
  const outputText = await extractDocxText(outputArrayBuffer);
  assert.match(outputText, /Tailored CV/);
  assert.match(outputText, /Accessible software engineer/);
});
