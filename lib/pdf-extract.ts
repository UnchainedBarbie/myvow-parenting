import pdfParse from "pdf-parse";

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text ?? "";
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[pdf-extract] failed to extract text:", e);
    return "";
  }
}

