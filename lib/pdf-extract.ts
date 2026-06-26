import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfJsPromise: Promise<PdfJsModule> | null = null;

function resolvePdfWorkerSrc(): string {
  const require = createRequire(import.meta.url);
  const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return pathToFileURL(workerPath).href;
}

function installCanvasPolyfills(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const canvas = require("@napi-rs/canvas") as {
      DOMMatrix?: typeof globalThis.DOMMatrix;
      ImageData?: typeof globalThis.ImageData;
      Path2D?: typeof globalThis.Path2D;
    };

    if (typeof globalThis.DOMMatrix === "undefined" && canvas.DOMMatrix) {
      globalThis.DOMMatrix = canvas.DOMMatrix as typeof globalThis.DOMMatrix;
    }
    if (typeof globalThis.ImageData === "undefined" && canvas.ImageData) {
      globalThis.ImageData = canvas.ImageData as typeof globalThis.ImageData;
    }
    if (typeof globalThis.Path2D === "undefined" && canvas.Path2D) {
      globalThis.Path2D = canvas.Path2D as typeof globalThis.Path2D;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[pdf-extract] @napi-rs/canvas polyfill unavailable:", e);
  }
}

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsPromise) {
    pdfJsPromise = (async () => {
      installCanvasPolyfills();
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      // Node runs the worker inline (no Worker thread); workerSrc must still
      // point at the legacy worker module for dynamic import.
      pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc();
      return pdfjs;
    })();
  }
  return pdfJsPromise;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;

    const parts: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .trim();
      if (pageText) parts.push(pageText);
    }

    return parts.join("\n").trim();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[pdf-extract] failed to extract text:", e);
    return "";
  }
}
