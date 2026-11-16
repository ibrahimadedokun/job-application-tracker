import mammoth from "mammoth/mammoth.browser.js";

export async function extractDocxText(arrayBuffer) {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}
