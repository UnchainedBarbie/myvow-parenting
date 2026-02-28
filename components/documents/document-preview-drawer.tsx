"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X, Download, Copy, FileText, Image } from "lucide-react";

import { CategoryPill } from "@/components/documents/category-pill";

const CATEGORY_LABELS: Record<string, string> = {
  court_order: "Court Order",
  medical: "Medical",
  school: "School",
  legal: "Legal",
  therapy: "Therapy",
  financial: "Financial",
  expenses: "Expenses",
  messages: "Messages",
  photos: "Photos",
  custody: "Custody",
  communication: "Communication",
  incident: "Incident",
  other: "Other",
};

const VISIBILITY_LABELS: Record<string, string> = {
  private: "Private",
  shared: "Shared",
  family: "Shared",
  parents_only: "Parents only",
  family_read_only: "Shared + AI",
  shared_ai_review: "Shared + AI review",
};

export type DocumentRow = {
  id: string;
  file_name: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  category: string;
  child_id: string | null;
  child_name: string | null;
  description: string | null;
  created_at: string;
  visibility: string;
  related_comm_id: string | null;
  deleted_at?: string | null;
  document_number?: number;
};

interface DocumentPreviewDrawerProps {
  open: boolean;
  onClose: () => void;
  document: DocumentRow | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatSize(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function docIdFromNumber(n: number) {
  return `DOC-${String(n).padStart(3, "0")}`;
}

export function DocumentPreviewDrawer({
  open,
  onClose,
  document: doc,
}: DocumentPreviewDrawerProps) {
  useEffect(() => {
    if (open) {
      const onEscape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
      document.addEventListener("keydown", onEscape);
      return () => document.removeEventListener("keydown", onEscape);
    }
  }, [open, onClose]);

  if (!open) return null;

  const docIdLabel = doc?.document_number != null
    ? docIdFromNumber(doc.document_number)
    : doc?.id?.slice(0, 8) ?? "—";

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 transition-opacity"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-full max-w-md bg-background border-l border-border shadow-card",
          "flex flex-col transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 id="drawer-title" className="font-heading text-base font-semibold text-foreground">
            Document
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-muted text-foreground-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {!doc ? (
            <p className="text-sm text-foreground-secondary">No document selected.</p>
          ) : (
            <>
              {/* Preview area */}
              <div className="rounded-card border border-border bg-background-secondary/50 flex items-center justify-center min-h-[180px]">
                {doc.mime_type?.startsWith("image/") ? (
                  <Image className="h-16 w-16 text-foreground-secondary" aria-hidden />
                ) : (
                  <FileText className="h-16 w-16 text-foreground-secondary" aria-hidden />
                )}
                <span className="sr-only">Preview (load from API for full preview)</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full h-8"
                  onClick={async () => {
                    const res = await fetch(`/api/documents/${doc.id}/download`);
                    const data = await res.json();
                    if (data?.url) window.open(data.url, "_blank");
                  }}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                  Download
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full h-8"
                  onClick={() => {
                    navigator.clipboard.writeText(docIdLabel);
                  }}
                >
                  <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                  Copy Doc ID
                </Button>
              </div>

              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Doc ID</p>
                <p className="font-mono text-sm text-foreground">{docIdLabel}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">File name</p>
                <p className="text-sm text-foreground break-all" title={doc.file_name}>{doc.file_name}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Category</p>
                <CategoryPill category={doc.category} label={CATEGORY_LABELS[doc.category] ?? doc.category} />
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Child</p>
                <p className="text-sm text-foreground">{doc.child_name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Date uploaded</p>
                <p className="text-sm text-foreground">{formatDate(doc.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Visibility</p>
                <span
                  className={cn(
                    "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                    doc.visibility === "private"
                      ? "bg-gray-200 text-gray-800"
                      : "bg-primary/15 text-primary"
                  )}
                >
                  {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                </span>
              </div>
              {doc.description && (
                <div>
                  <p className="text-xs text-foreground-secondary mb-0.5">Description (export context)</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{doc.description}</p>
                </div>
              )}

              <div className="pt-2 border-t border-border">
                <p className="text-xs font-medium text-foreground-secondary mb-1">Audit trail</p>
                <ul className="text-xs text-foreground-secondary space-y-0.5">
                  <li>Uploaded {formatDate(doc.created_at)}</li>
                  <li>Last modified — (stub)</li>
                  <li>Access history logged</li>
                </ul>
              </div>

              <div className="pt-2 border-t border-border">
                <p className="text-xs font-medium text-foreground-secondary mb-1">Court export note</p>
                <p className="text-xs text-foreground">
                  {doc.description ?? "No description."} This text is included as export context in court bundles.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
