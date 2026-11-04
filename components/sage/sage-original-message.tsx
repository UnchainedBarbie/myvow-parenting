"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SageMessageAttachments } from "@/components/sage/sage-message-attachments";

type OriginalPayload = {
  unavailable?: boolean;
  ownMessage?: boolean;
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
  own = false,
}: {
  messageId: string;
  label: string;
  own?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<OriginalPayload | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const requestedRef = useRef(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = triggerRef.current;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open]);

  async function openOriginal() {
    setOpen(true);
    if (payload || requestedRef.current) return;
    requestedRef.current = true;
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

  const unavailable = Boolean(payload?.unavailable || payload?.error);
  const title = own || payload?.ownMessage ? "Your original message" : "Original message";
  const files = (payload?.attachments ?? []).map((file) => ({
    id: file.id,
    fileName: file.fileName,
    mimeType: file.mimeType,
  }));

  return (
    <div className="mt-2 max-w-full">
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex min-h-8 items-center gap-1 text-left text-[11px] text-[#5B7A52] hover:underline"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => void openOriginal()}
      >
        <span>{label}</span>
        <span aria-hidden>↗</span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-stretch sm:justify-end sm:bg-black/25"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="flex h-[min(92dvh,100%)] w-full flex-col rounded-t-2xl border border-[#E8E4DC] bg-[#FDFBF7] shadow-card sm:h-full sm:max-w-[440px] sm:rounded-none sm:border-y-0 sm:border-r-0"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#E8E4DC] px-4 py-3">
              <div>
                <h2 id={titleId} className="font-heading text-base font-semibold text-foreground">
                  {title}
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="text-xs text-foreground-secondary underline hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px] text-foreground">
              {loading ? (
                <p className="text-foreground-secondary">Loading the original…</p>
              ) : unavailable ? (
                <p className="text-foreground-secondary">
                  {payload?.message || payload?.error || "The original message isn't available."}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="break-words">
                    <span className="text-foreground-secondary">From: </span>
                    {payload?.sender || "Co-parent"}
                  </p>
                  {payload?.to ? (
                    <p className="break-words">
                      <span className="text-foreground-secondary">To: </span>
                      {payload.to}
                    </p>
                  ) : null}
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
                  {payload?.subject ? (
                    <p className="break-words">
                      <span className="text-foreground-secondary">Subject: </span>
                      {payload.subject}
                    </p>
                  ) : null}
                  <div className="whitespace-pre-wrap break-words border-t border-[#E8E4DC] pt-3">
                    {payload?.body?.trim() ? payload.body : "This message has no text."}
                  </div>
                  {files.length > 0 ? (
                    <div className="border-t border-[#E8E4DC] pt-3">
                      <SageMessageAttachments files={files} />
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )
        : null}
    </div>
  );
}
