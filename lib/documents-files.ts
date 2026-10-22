/** File types the Documents vault and Sage can store without conversion. */

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  doc: "application/msword",
  docx: DOCX_MIME,
};

export const DOCUMENT_ACCEPT = "image/*,.pdf,application/pdf,.doc,.docx";
export const DOCUMENT_ACCEPT_LABEL = "PDF, JPG, PNG, and Word (.doc, .docx)";

export function documentExtension(fileName: string): string {
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function documentContentType(fileName: string, mime: string): string {
  const normalized = mime.toLowerCase().split(";")[0].trim();
  if (normalized && normalized !== "application/octet-stream") return normalized;
  return EXTENSION_MIME[documentExtension(fileName)] ?? normalized;
}

export function isWordDocument(fileName: string, mime: string): boolean {
  const type = documentContentType(fileName, mime);
  const ext = documentExtension(fileName);
  return type === DOCX_MIME || type === "application/msword" || ext === "doc" || ext === "docx";
}

/** Null when the file can be stored. Otherwise a message for the parent. */
export function documentFileProblem(
  fileName: string,
  mime: string,
  size: number
): string | null {
  if (!Number.isFinite(size) || size <= 0) {
    return "That file is empty. Attach a PDF, JPG, PNG, or Word document (.docx).";
  }
  if (size > DOCUMENT_MAX_BYTES) {
    return "That file is over 25MB. Attach a smaller PDF, JPG, PNG, or Word document (.docx).";
  }
  const ext = documentExtension(fileName);
  const type = documentContentType(fileName, mime);
  const extensionOk = Object.prototype.hasOwnProperty.call(EXTENSION_MIME, ext);
  const mimeOk =
    type.startsWith("image/") ||
    type === "application/pdf" ||
    type === "application/msword" ||
    type === DOCX_MIME;
  if (extensionOk || mimeOk) return null;
  return "That file type isn't supported. Attach a PDF, JPG, PNG, or Word document (.docx) up to 25MB. Your note is still here, so you can attach a replacement.";
}

/** Shown when the file is kept but cannot be drawn on the page. */
export function documentPreviewNote(fileName: string, mime: string | null | undefined): string | null {
  if (!isWordDocument(fileName, mime ?? "")) return null;
  return "This Word document isn't previewed inline. Download keeps the original file.";
}
