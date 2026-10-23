import { documentExtension, documentPreviewNote } from "@/lib/documents-files";
import { documentAuthorizedForViewer } from "@/lib/documents-tab";
import type { StoredIntakeDocument } from "@/lib/messages/intake-evidence";

export type SageAttachmentIcon = "spreadsheet" | "image" | "pdf" | "text" | "file";

export type SageAttachmentView = {
  id: string;
  fileName: string;
  mimeType: string | null;
  preview: boolean;
  icon: SageAttachmentIcon;
};

export function attachmentIconKind(fileName: string, mimeType: string | null | undefined): SageAttachmentIcon {
  const ext = documentExtension(fileName);
  const type = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (ext === "xls" || ext === "xlsx" || ext === "csv" || type.includes("spreadsheet") || type === "text/csv") {
    return "spreadsheet";
  }
  if (ext === "pdf" || type === "application/pdf") return "pdf";
  if (
    ext === "png" ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "gif" ||
    ext === "webp" ||
    (type.startsWith("image/") && !type.includes("svg"))
  ) {
    return "image";
  }
  if (ext === "doc" || ext === "docx" || ext === "txt" || type.startsWith("text/")) return "text";
  return "file";
}

/** Files already stored for these messages. Does not copy bytes or invent files from other messages. */
export function filesForMessages(
  messageIds: string[],
  evidence: Map<string, { files: StoredIntakeDocument[] }>
): StoredIntakeDocument[] {
  const files: StoredIntakeDocument[] = [];
  for (const id of messageIds) {
    for (const file of evidence.get(id)?.files ?? []) {
      if (!files.some((existing) => existing.id === file.id)) files.push(file);
    }
  }
  return files;
}

/**
 * Attachment row for a Sage message. Preview is offered only for types the browser can show.
 * Download stays on the existing document route.
 */
export function sageAttachmentViews(
  files: StoredIntakeDocument[],
  viewer: { userId: string; role: string | null | undefined }
): SageAttachmentView[] {
  return files
    .filter((file) =>
      documentAuthorizedForViewer(
        { visibility: file.visibility, uploadedBy: file.uploadedBy },
        viewer
      )
    )
    .map((file) => ({
      id: file.id,
      fileName: file.filename,
      mimeType: file.mimeType,
      preview: documentPreviewNote(file.filename, file.mimeType) == null,
      icon: attachmentIconKind(file.filename, file.mimeType),
    }));
}
