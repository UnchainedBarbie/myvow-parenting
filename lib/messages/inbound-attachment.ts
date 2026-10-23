import {
  documentBytesProblem,
  documentExtension,
  documentStoredContentType,
  originalDocumentName,
} from "@/lib/documents-files";

export type InboundAttachmentDecision =
  | { ok: true; filename: string; mimeType: string; bytes: Buffer }
  | { ok: false; filename: string; reason: string };

export type AttachmentNotice = { filename: string; reason: string };

/** Excel and the other Documents types are stored. Spreadsheet bytes are not sent to a model. */
export function sageReadsAttachment(filename: string, mimeType: string | null | undefined): boolean {
  const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  return documentExtension(filename) === "pdf" || mime === "application/pdf";
}

export function decideInboundAttachment(input: {
  name?: string | null;
  contentType?: string | null;
  contentBase64?: string | null;
}): InboundAttachmentDecision {
  const filename = originalDocumentName(input.name ?? "") || "attachment";
  const raw = input.contentBase64;
  if (!raw || typeof raw !== "string") {
    return {
      ok: false,
      filename,
      reason: "The email did not include this file's contents.",
    };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    return {
      ok: false,
      filename,
      reason: "The file contents could not be read from the email.",
    };
  }
  const problem = documentBytesProblem(filename, input.contentType ?? "", bytes.byteLength, bytes);
  if (problem) return { ok: false, filename, reason: problem };
  const mimeType = documentStoredContentType(filename, bytes);
  if (!mimeType) {
    return { ok: false, filename, reason: "That file type isn't supported." };
  }
  return { ok: true, filename, mimeType, bytes };
}

/**
 * Parent-facing facts. A saved file is named even when its contents were not read.
 * A failed save says why. It does not say the file never arrived.
 */
export function sageAttachmentSentences(input: {
  saved: { filename: string; read: boolean }[];
  failed: AttachmentNotice[];
}): string {
  const lines: string[] = [];
  for (const file of input.saved) {
    const name = file.filename.trim();
    if (!name) continue;
    lines.push(
      file.read
        ? `${name} is attached.`
        : `${name} is attached. I haven't read its contents.`
    );
  }
  for (const file of input.failed) {
    const name = file.filename.trim() || "attachment";
    const reason = file.reason.trim() || "The file could not be saved.";
    lines.push(`${name} did not save. ${reason}`);
  }
  return lines.join(" ");
}

/** A repeated Postmark delivery stops before another message or attachment is created. */
export function inboundDeliveryAction(
  recorded: { id: string } | { duplicate: true } | { error: string }
): "process" | "stop" {
  return "id" in recorded ? "process" : "stop";
}

export function documentsForMessage<T extends { id: string }>(
  messageId: string,
  links: { messageId: string; documentId: string }[],
  documents: T[]
): T[] {
  const ids = new Set(
    links.filter((link) => link.messageId === messageId).map((link) => link.documentId)
  );
  return documents.filter((document) => ids.has(document.id));
}
