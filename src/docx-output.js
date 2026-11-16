import { Document, Packer, Paragraph, TextRun } from "docx";

export async function createDocxBlob(title, text) {
  const paragraphs = text.split(/\r?\n/).map(
    (line) =>
      new Paragraph({
        children: [new TextRun(line || " ")],
        spacing: { after: 160 },
      }),
  );
  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Aptos", size: 22, color: "26352E" },
          paragraph: { spacing: { line: 300 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: title,
                bold: true,
                color: "365E4A",
                size: 34,
              }),
            ],
            spacing: { after: 360 },
          }),
          ...paragraphs,
        ],
      },
    ],
  });
  return Packer.toBlob(document);
}
