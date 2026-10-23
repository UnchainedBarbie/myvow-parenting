"use client";

import { Download, Eye, File, FileImage, FileSpreadsheet, FileText } from "lucide-react";
import { documentDownloadPath, documentPreviewNote } from "@/lib/documents-files";
import { attachmentIconKind, type SageAttachmentIcon } from "@/lib/sage/message-attachments";

export type SageMessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string | null;
  preview?: boolean;
  icon?: SageAttachmentIcon;
};

function Icon({ kind }: { kind: SageAttachmentIcon }) {
  const className = "h-4 w-4 shrink-0 text-[#5B7A52]";
  if (kind === "spreadsheet") return <FileSpreadsheet className={className} aria-hidden />;
  if (kind === "image") return <FileImage className={className} aria-hidden />;
  if (kind === "pdf" || kind === "text") return <FileText className={className} aria-hidden />;
  return <File className={className} aria-hidden />;
}

const actionClass =
  "inline-flex items-center gap-1 rounded-full border border-[#5B7A52] bg-[#F2F5EF] px-2.5 py-1 text-[12px] font-medium text-[#5B7A52] hover:bg-[#E7EEE4]";

export function SageMessageAttachments({ files }: { files: SageMessageAttachment[] }) {
  if (files.length === 0) return null;

  return (
    <ul className="max-w-full space-y-1">
      {files.map((file) => {
        const preview = file.preview ?? documentPreviewNote(file.fileName, file.mimeType) == null;
        const icon = file.icon ?? attachmentIconKind(file.fileName, file.mimeType);
        const note = preview ? null : documentPreviewNote(file.fileName, file.mimeType);
        return (
          <li
            key={file.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E8E4DC] bg-white px-2.5 py-1.5"
          >
            <Icon kind={icon} />
            <span className="min-w-0 flex-1 break-all text-[13px] text-foreground">{file.fileName}</span>
            {preview ? (
              <a
                href={documentDownloadPath(file.id, true)}
                target="_blank"
                rel="noopener noreferrer"
                className={actionClass}
              >
                <Eye className="h-3.5 w-3.5" aria-hidden />
                Preview
              </a>
            ) : null}
            <a
              href={documentDownloadPath(file.id, false)}
              target="_blank"
              rel="noopener noreferrer"
              className={actionClass}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Download
            </a>
            {note ? <span className="w-full text-[10px] text-foreground-secondary">{note}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
