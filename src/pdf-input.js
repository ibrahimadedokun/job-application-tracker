import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_PDF_PAGES = 3;

export async function extractPdfText(arrayBuffer) {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    isEvalSupported: false,
  });

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES)
      throw new Error(`PDFs must contain ${MAX_PDF_PAGES} pages or fewer.`);

    const pages = await Promise.all(
      Array.from({ length: pdf.numPages }, (_, index) => index + 1).map(
        async (pageNumber) => {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          return content.items
            .map((item) => {
              if (typeof item.str !== "string") return "";

              const separator = item.hasEOL ? "\n" : " ";
              return `${item.str}${separator}`;
            })
            .join("");
        },
      ),
    );
    return pages.join("\n");
  } finally {
    await loadingTask.destroy();
  }
}
