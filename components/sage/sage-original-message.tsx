"use client";

import { useEffect, useRef, useState } from "react";
import { documentPreviewNote } from "@/lib/documents-files";

type OriginalPayload = {
  unavailable?: boolean;
  message?: string;
  error?: string;
  id?: string;
  sender?: string;
  to?: string | null;
  cc?: string | null;
  sentAt?: string | null;
  subject?: string | null;
  body?: string;
  attachments?: {
    id: string;
    fileName: string;
    mimeType: string | null;
    previewNote: string | null;
  }[];
};

function formatWhen(value: string | null | undefined): string {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SageOriginalMessage({
  messageId,
  label,
}: {
  messageId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<OriginalPayload | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const scrollTopRef = useRef<number | null>(null);

  function rememberScroll(button: HTMLButtonElement) {
    const scroller = button.closest("[data-radix-scroll-area-viewport]") as HTMLElement | null;
    scrollerRef.current = scroller;
    scrollTopRef.current = scroller?.scrollTop ?? null;
  }

  useEffect(() => {
    const scroller = scrollerRef.current;
    const top = scrollTopRef.current;
    if (!scroller || top == null) return;
    scroller.scrollTop = top;
  }, [open, loading, payload]);

  async function toggle(button: HTMLButtonElement) {
    rememberScroll(button);
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!payload) {
      setLoading(true);
      try {
        const res = await fetch(`/api/sage/original-messages/${encodeURIComponent(messageId)}`);
        const data = (await res.json().catch(() => ({}))) as OriginalPayload;
        if (!res.ok && !data.unavailable && !data.message) {
          setPayload({ unavailable: true, message: data.error || "The original message isn't available." });
        } else {
          setPayload(data);
        }
      } catch {
        setPayload({ unavailable: true, message: "The original message isn't available." });
      } finally {
        setLoading(false);
      }
    }
  }

  async function openAttachment(id: string) {
    const res = await fetch(`/api/documents/${id}/download`);
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (res.ok && data.url) window.open(data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="mt-2 max-w-full">
      <button
        type="button"
        className="inline-flex min-h-8 items-center gap-1 text-left text-[11px] text-[#5B7A52] hover:underline"
        aria-expanded={open}
        onClick={(event) => void toggle(event.currentTarget)}
      >
        <span aria-hidden>👁</span>
        <span>{open ? "Hide original" : label}</span>
      </button>
      {open ? (
        <div className="mt-2 w-full max-w-full overflow-hidden rounded-xl border border-[#E8E4DC] bg-[#FFF8F0] px-3 py-2 text-[12px] text-foreground [overflow-anchor:none]">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#8A7A62]">
            Co-parent’s original message
          </p>
          {loading ? (
            <p className="mt-1 text-foreground-secondary">Loading the original…</p>
          ) : payload?.unavailable || payload?.error ? (
            <p className="mt-1 text-foreground-secondary">
              {payload.message || payload.error || "The original message isn't available."}
            </p>
          ) : (
            <div className="mt-1 space-y-1">
              <p className="break-words">
                <span className="text-foreground-secondary">From: </span>
                {payload?.sender || "Co-parent"}
              </p>
              <p className="break-words">
                <span className="text-foreground-secondary">To: </span>
                {payload?.to || "Not recorded"}
              </p>
              {payload?.cc ? (
                <p className="break-words">
                  <span className="text-foreground-secondary">Cc: </span>
                  {payload.cc}
                </p>
              ) : null}
              <p className="break-words">
                <span className="text-foreground-secondary">Date: </span>
                {formatWhen(payload?.sentAt)}
              </p>
              <p className="break-words">
                <span className="text-foreground-secondary">Subject: </span>
                {payload?.subject || "No subject"}
              </p>
              <div className="whitespace-pre-wrap break-words pt-1">{payload?.body || ""}</div>
              {(payload?.attachments ?? []).length > 0 ? (
                <ul className="space-y-1 pt-1">
                  {payload?.attachments?.map((file) => (
                    <li key={file.id} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-all">{file.fileName}</span>
                      <button
                        type="button"
                        className="text-[11px] text-[#5B7A52] underline"
                        onClick={() => void openAttachment(file.id)}
                      >
                        {file.mimeType?.startsWith("image/") || file.mimeType === "application/pdf"
                          ? "Preview"
                          : "Download"}
                      </button>
                      <span className="text-[10px] text-foreground-secondary">
                        {file.previewNote ?? documentPreviewNote(file.fileName, file.mimeType) ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
