"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  medical: "Medical",
  school: "School",
  legal: "Legal",
  therapy: "Therapy",
  financial: "Financial",
  custody: "Custody",
  communication: "Communication",
  incident: "Incident",
  other: "Other",
};

const VISIBILITY_LABELS: Record<string, string> = {
  private: "Private",
  shared: "Shared",
  family: "Family",
  parents_only: "Parents only",
  family_read_only: "Family (read only)",
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

interface DocumentDetailModalProps {
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

export function DocumentDetailModal({
  open,
  onClose,
  document: doc,
}: DocumentDetailModalProps) {
  if (!open) return null;
  const docIdLabel = doc?.document_number != null ? docIdFromNumber(doc.document_number) : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-card shadow-card max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-foreground">Document</h2>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-muted text-foreground-secondary" aria-label="Close">
            ×
          </button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4">
          {!doc ? (
            <p className="text-sm text-foreground-secondary">No document selected.</p>
          ) : (
            <>
              <div>
                <p className="text-xs text-foreground-secondary">Doc ID</p>
                <p className="font-mono text-sm text-foreground">{docIdLabel}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary">File name</p>
                <p className="text-sm text-foreground break-all">{doc.file_name}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary">Category</p>
                <p className="text-sm text-foreground">{CATEGORY_LABELS[doc.category] ?? doc.category}</p>
              </div>
              {doc.child_name && (
                <div>
                  <p className="text-xs text-foreground-secondary">Child</p>
                  <p className="text-sm text-foreground">{doc.child_name}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-foreground-secondary">Date uploaded</p>
                <p className="text-sm text-foreground">{formatDate(doc.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary">Visibility</p>
                <span className={cn("inline-block px-2 py-0.5 rounded-full text-xs", doc.visibility === "private" ? "bg-gray-100 text-gray-700" : "bg-primary/10 text-primary")}>
                  {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                </span>
              </div>
              {doc.description && (
                <div>
                  <p className="text-xs text-foreground-secondary">Description</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{doc.description}</p>
                </div>
              )}
              <div className="pt-2 flex gap-2">
                <Button
                  size="sm"
                  className="rounded-full"
                  onClick={async () => {
                    const res = await fetch(`/api/documents/${doc.id}/download`);
                    const data = await res.json();
                    if (data?.url) window.open(data.url, "_blank");
                  }}
                >
                  Download
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
