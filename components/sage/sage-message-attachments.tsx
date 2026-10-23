"use client";

import { useState } from "react";
import { Download, Eye, File, FileImage, FileSpreadsheet, FileText } from "lucide-react";
import { documentPreviewNote } from "@/lib/documents-files";
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

export function SageMessageAttachments({ files }: { files: SageMessageAttachment[] }) {
  const [error, setError] = useState<string | null>(null);
  if (files.length === 0) return null;

  async function openAttachment(id: string, preview: boolean) {
    setError(null);
    const res = await fetch(`/api/documents/${id}/download${preview ? "?preview=1" : ""}`);
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      setError(data.error || "That file isn't available.");
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="max-w-full">
      <ul className="space-y-1">
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
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-[#5B7A52] underline"
                  onClick={() => void openAttachment(file.id, true)}
                >
                  <Eye className="h-3 w-3" aria-hidden />
                  Preview
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-[#5B7A52] underline"
                onClick={() => void openAttachment(file.id, false)}
              >
                <Download className="h-3 w-3" aria-hidden />
                Download
              </button>
              {note ? <span className="w-full text-[10px] text-foreground-secondary">{note}</span> : null}
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-1 text-[11px] text-foreground-secondary">{error}</p> : null}
    </div>
  );
}
