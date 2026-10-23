/** File types Documents and Sage can store. Reading a file is a separate step. */

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  doc: "application/msword",
  docx: DOCX_MIME,
  xls: "application/vnd.ms-excel",
  xlsx: XLSX_MIME,
  csv: "text/csv",
  txt: "text/plain",
};

const COMPATIBLE_MIME: Record<string, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/jpg"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  doc: ["application/msword"],
  docx: [DOCX_MIME, "application/msword", "application/zip", "application/octet-stream"],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  xlsx: [XLSX_MIME, "application/vnd.ms-excel", "application/zip", "application/octet-stream"],
  csv: ["text/csv", "application/csv", "text/plain", "text/comma-separated-values", "application/vnd.ms-excel"],
  txt: ["text/plain"],
};

const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "bat", "cmd", "com", "scr", "msi", "js", "mjs", "cjs",
  "html", "htm", "svg", "php", "sh", "ps1", "jar", "docm", "xlsm", "pptm", "ppt", "apk",
]);

const SUPPORTED_LABEL =
  "PDF, PNG, JPG, WEBP, Word (.doc, .docx), Excel (.xls, .xlsx), CSV, or plain text (.txt)";

export const DOCUMENT_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt,application/pdf,image/png,image/jpeg,image/webp,image/gif";
export const DOCUMENT_ACCEPT_LABEL =
  "PDF, PNG, JPG, WEBP, Word, Excel, CSV, or TXT up to 25MB";

export function documentExtension(fileName: string): string {
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function originalDocumentName(fileName: string): string {
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  return base.slice(0, 180);
}

export function documentContentType(fileName: string, mime: string): string {
  const normalized = mime.toLowerCase().split(";")[0].trim();
  const fromName = EXTENSION_MIME[documentExtension(fileName)];
  if (fromName) return fromName;
  if (normalized && normalized !== "application/octet-stream") return normalized;
  return normalized;
}

/** PDFs and images can be read. Office, CSV, and text files are stored only. */
export function documentCanBeRead(fileName: string, mime: string): boolean {
  const ext = documentExtension(fileName);
  const type = documentContentType(fileName, mime);
  if (ext === "pdf" || type === "application/pdf") return true;
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "gif") return true;
  return type === "image/png" || type === "image/jpeg" || type === "image/webp" || type === "image/gif";
}

export function isWordDocument(fileName: string, mime: string): boolean {
  const ext = documentExtension(fileName);
  const type = documentContentType(fileName, mime);
  return ext === "doc" || ext === "docx" || type === DOCX_MIME || type === "application/msword";
}

export function documentPreviewNote(fileName: string, mime: string | null | undefined): string | null {
  const ext = documentExtension(fileName);
  const type = (mime ?? "").toLowerCase().split(";")[0].trim();
  const previewable =
    ext === "pdf" ||
    ext === "png" ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "webp" ||
    ext === "gif" ||
    type === "application/pdf" ||
    (type.startsWith("image/") && !type.includes("svg"));
  if (previewable) return null;
  return "This file isn't previewed in the browser. Download keeps the original file.";
}

/** Preview opens the file in the browser. Other types keep the download disposition. */
export function documentOpensInline(
  fileName: string,
  mime: string | null | undefined,
  previewRequested: boolean
): boolean {
  return previewRequested && documentPreviewNote(fileName, mime) == null;
}

/** Client check before upload. The server still inspects the bytes. */
export function documentFileProblem(
  fileName: string,
  mime: string,
  size: number
): string | null {
  const tooBig = fileSizeProblem(size);
  if (tooBig) return tooBig;
  const ext = documentExtension(fileName);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return `That file type isn't supported. Attach a ${SUPPORTED_LABEL} up to 25MB.`;
  }
  if (!Object.prototype.hasOwnProperty.call(EXTENSION_MIME, ext)) {
    return `That file type isn't supported. Attach a ${SUPPORTED_LABEL} up to 25MB. Your note is still here, so you can attach a replacement.`;
  }
  const declared = mime.toLowerCase().split(";")[0].trim();
  if (declared && declared !== "application/octet-stream") {
    const allowed = COMPATIBLE_MIME[ext] ?? [];
    if (!allowed.includes(declared)) {
      return "That file's type does not match its name. Attach the original file again.";
    }
  }
  return null;
}

/** Server check. Extension, declared type, and file bytes must agree. */
export function documentBytesProblem(
  fileName: string,
  mime: string,
  size: number,
  bytes: Uint8Array
): string | null {
  const named = documentFileProblem(fileName, mime, size);
  if (named) return named;
  const ext = documentExtension(fileName);
  const kind = sniff(bytes);
  if (kind === "executable") {
    return "That file can't be stored. It looks like a program or a web page.";
  }
  if (hasMacro(bytes)) {
    return "Macro-enabled Office files can't be stored. Save a copy without macros and attach that.";
  }
  if (!bytesMatchExtension(ext, kind, bytes)) {
    return "That file's contents don't match its name. Attach the original file again.";
  }
  return null;
}

export function documentStoredContentType(fileName: string, bytes: Uint8Array): string | null {
  if (documentBytesProblem(fileName, "", bytes.byteLength, bytes)) return null;
  return EXTENSION_MIME[documentExtension(fileName)] ?? null;
}

function fileSizeProblem(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) {
    return `That file is empty. Attach a ${SUPPORTED_LABEL}.`;
  }
  if (size > DOCUMENT_MAX_BYTES) {
    return `That file is over 25MB. Attach a smaller ${SUPPORTED_LABEL}.`;
  }
  return null;
}

type Sniff = "pdf" | "png" | "jpeg" | "webp" | "gif" | "zip" | "ole" | "text" | "executable";

function sniff(bytes: Uint8Array): Sniff {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return "executable";
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return "executable";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return "webp";
  const gif = asciiAt(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "gif";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    return "zip";
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return "ole";
  const head = asciiAt(bytes, 0, Math.min(bytes.length, 80)).trim().toLowerCase();
  if (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<script") ||
    head.startsWith("<?php") ||
    head.startsWith("<svg")
  ) {
    return "executable";
  }
  if (hasNul(bytes.subarray(0, Math.min(bytes.length, 8000)))) return "executable";
  return "text";
}

function bytesMatchExtension(ext: string, kind: Sniff, bytes: Uint8Array): boolean {
  if (ext === "pdf") return kind === "pdf";
  if (ext === "png") return kind === "png";
  if (ext === "jpg" || ext === "jpeg") return kind === "jpeg";
  if (ext === "webp") return kind === "webp";
  if (ext === "gif") return kind === "gif";
  if (ext === "docx") return kind === "zip" && includesAscii(bytes, "word/", bytes.length);
  if (ext === "xlsx") return kind === "zip" && includesAscii(bytes, "xl/", bytes.length);
  if (ext === "doc" || ext === "xls") return kind === "ole";
  if (ext === "csv" || ext === "txt") return kind === "text";
  return false;
}

function hasMacro(bytes: Uint8Array): boolean {
  return (
    includesAscii(bytes, "vbaProject.bin", bytes.length) ||
    includesAscii(bytes, "_VBA_PROJECT_CUR", bytes.length) ||
    includesUtf16(bytes, "_VBA_PROJECT_CUR")
  );
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  if (start < 0 || start >= bytes.length) return "";
  const end = Math.min(bytes.length, start + length);
  let text = "";
  for (let index = start; index < end; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

function includesAscii(bytes: Uint8Array, needle: string, limit = Math.min(bytes.length, 256 * 1024)): boolean {
  if (needle.length === 0 || bytes.length < needle.length) return false;
  limit = Math.min(bytes.length, limit);
  const first = needle.charCodeAt(0);
  for (let index = 0; index <= limit - needle.length; index += 1) {
    if (bytes[index] !== first) continue;
    let matched = true;
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle.charCodeAt(offset)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function includesUtf16(bytes: Uint8Array, needle: string): boolean {
  if (needle.length === 0 || bytes.length < needle.length * 2) return false;
  const first = needle.charCodeAt(0);
  for (let index = 0; index <= bytes.length - needle.length * 2; index += 1) {
    if (bytes[index] !== first || bytes[index + 1] !== 0) continue;
    let matched = true;
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (bytes[index + offset * 2] !== needle.charCodeAt(offset) || bytes[index + offset * 2 + 1] !== 0) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function hasNul(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}
