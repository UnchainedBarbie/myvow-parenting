"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Pencil } from "lucide-react";

type DocumentHistoryEntry = {
  id: string;
  field_changed: string;
  new_value: string | null;
  changed_by_name: string | null;
  created_at: string;
};

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 250;

const CATEGORY_OPTIONS = [
  { value: "court_order", label: "Court Order" },
  { value: "school", label: "School" },
  { value: "medical", label: "Medical" },
  { value: "expenses", label: "Expenses" },
  { value: "therapy", label: "Therapy" },
  { value: "legal", label: "Legal" },
  { value: "custody", label: "Custody" },
  { value: "photos", label: "Photos" },
  { value: "communication", label: "Communication" },
  { value: "incident", label: "Incident" },
  { value: "other", label: "Other" },
] as const;

const VISIBILITY_OPTIONS = [
  { value: "family", label: "Family" },
  { value: "parents_only", label: "Parents only" },
  { value: "private", label: "Just me" },
] as const;

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label])
);

const VISIBILITY_LABELS: Record<string, string> = {
  private: "Just me",
  family: "Family",
  parents_only: "Parents only",
  family_read_only: "Family",
  shared_ai_review: "Parents only",
};

export type DocumentRow = {
  id: string;
  title: string | null;
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

type ChildOption = { id: string; first_name: string };

interface DocumentDetailModalProps {
  open: boolean;
  onClose: () => void;
  document: DocumentRow | null;
  /** When true, open directly in edit mode (e.g. from pencil icon). */
  initialEditMode?: boolean;
  /** Called after successful save so parent can refresh the list. */
  onSaved?: () => void;
  children?: ChildOption[];
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

function formatHistoryTimestamp(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function historyFieldLabel(field: string): string {
  switch (field) {
    case "title": return "Title";
    case "description": return "Description";
    case "category": return "Category";
    case "child_id": return "Child";
    case "visibility": return "Visibility";
    default: return field;
  }
}

export function DocumentDetailModal({
  open,
  onClose,
  document: doc,
  initialEditMode = false,
  onSaved,
  children: childOptions = [],
}: DocumentDetailModalProps) {
  const [isEditing, setIsEditing] = useState(initialEditMode);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [childId, setChildId] = useState("");
  const [visibility, setVisibility] = useState("family");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [history, setHistory] = useState<DocumentHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (open && doc) {
      setIsEditing(!!initialEditMode);
      setTitle((doc.title ?? "").trim());
      setDescription((doc.description ?? "").trim());
      setCategory(doc.category ?? "other");
      setChildId(doc.child_id ?? "");
      setVisibility(doc.visibility === "private" ? "private" : doc.visibility === "parents_only" ? "parents_only" : "family");
      setSaveError(null);
    }
  }, [open, doc, initialEditMode]);

  useEffect(() => {
    if (!open || !doc) return;
    let cancelled = false;
    async function loadHistory() {
      setLoadingHistory(true);
      try {
        const res = await fetch(`/api/documents/${doc.id}/history`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as DocumentHistoryEntry[];
        if (!cancelled) setHistory(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }
    loadHistory();
    return () => { cancelled = true; };
  }, [open, doc]);

  function handleCancel() {
    if (doc) {
      setTitle((doc.title ?? "").trim());
      setDescription((doc.description ?? "").trim());
      setCategory(doc.category ?? "other");
      setChildId(doc.child_id ?? "");
      setVisibility(doc.visibility === "private" ? "private" : doc.visibility === "parents_only" ? "parents_only" : "family");
    }
    setIsEditing(false);
    setSaveError(null);
  }

  async function handleSave() {
    if (!doc) return;
    const titleTrim = title.trim();
    if (!titleTrim) {
      setSaveError("Document title is required.");
      return;
    }
    if (titleTrim.length > TITLE_MAX) {
      setSaveError(`Title must be ${TITLE_MAX} characters or fewer.`);
      return;
    }
    const descTrim = description.trim();
    if (!descTrim) {
      setSaveError("Description is required.");
      return;
    }
    if (descTrim.length > DESCRIPTION_MAX) {
      setSaveError(`Description must be ${DESCRIPTION_MAX} characters or fewer.`);
      return;
    }
    const newChildId = (childId && childId !== "__none__") ? childId : null;
    const origTitle = (doc.title ?? "").trim();
    const origDesc = (doc.description ?? "").trim();
    const origCategory = doc.category ?? "other";
    const origChildId = doc.child_id ?? null;
    const origVisibility = doc.visibility === "private" ? "private" : doc.visibility === "parents_only" ? "parents_only" : "family";

    const historyEntries: { field_changed: string; old_value: string | null; new_value: string }[] = [];
    if (titleTrim !== origTitle) {
      historyEntries.push({ field_changed: "title", old_value: origTitle || null, new_value: titleTrim });
    }
    if (descTrim !== origDesc) {
      historyEntries.push({ field_changed: "description", old_value: origDesc || null, new_value: descTrim });
    }
    if (category !== origCategory) {
      historyEntries.push({
        field_changed: "category",
        old_value: origCategory,
        new_value: CATEGORY_LABELS[category] ?? category,
      });
    }
    if (newChildId !== origChildId) {
      const newChildLabel = !newChildId ? "All children" : childOptions.find((c) => c.id === newChildId)?.first_name ?? newChildId;
      const oldChildLabel = !origChildId ? "All children" : doc.child_name ?? origChildId;
      historyEntries.push({ field_changed: "child_id", old_value: oldChildLabel, new_value: newChildLabel });
    }
    if (visibility !== origVisibility) {
      historyEntries.push({
        field_changed: "visibility",
        old_value: VISIBILITY_LABELS[origVisibility] ?? origVisibility,
        new_value: VISIBILITY_LABELS[visibility] ?? visibility,
      });
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleTrim,
          description: descTrim,
          category,
          child_id: newChildId,
          visibility,
          ...(historyEntries.length > 0 ? { history: historyEntries } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Save failed");
      onSaved?.();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const docIdLabel = doc?.document_number != null ? docIdFromNumber(doc.document_number) : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-modal-title"
        className="bg-background border border-border rounded-card shadow-card max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <h2 id="document-modal-title" className="font-heading text-lg font-semibold text-foreground">
            Document
          </h2>
          <div className="flex items-center gap-1">
            {!isEditing && doc && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full h-8 text-xs gap-1.5"
                onClick={() => setIsEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full hover:bg-muted text-foreground-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {!doc ? (
            <p className="text-sm text-foreground-secondary">No document selected.</p>
          ) : isEditing ? (
            <>
              {saveError && (
                <p className="text-xs text-alert" role="alert">{saveError}</p>
              )}
              <div className="space-y-2">
                <Label htmlFor="doc-modal-title" className="text-xs font-medium">Document title</Label>
                <input
                  id="doc-modal-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
                  className={cn(
                    "flex h-9 w-full rounded-card border border-input bg-background px-3 py-1 text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                  maxLength={TITLE_MAX}
                />
                <p className="text-[11px] text-foreground-secondary">{title.length} / {TITLE_MAX}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-modal-desc" className="text-xs font-medium">Description</Label>
                <textarea
                  id="doc-modal-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
                  rows={3}
                  className={cn(
                    "flex w-full rounded-card border border-input bg-background px-3 py-2 text-sm resize-y",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                  maxLength={DESCRIPTION_MAX}
                />
                <p className="text-[11px] text-foreground-secondary">{description.length} / {DESCRIPTION_MAX}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-modal-category" className="text-xs font-medium">Category</Label>
                <select
                  id="doc-modal-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className={cn(
                    "flex h-9 w-full rounded-card border border-input bg-background px-2 text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-modal-child" className="text-xs font-medium">Child</Label>
                <select
                  id="doc-modal-child"
                  value={childId}
                  onChange={(e) => setChildId(e.target.value)}
                  className={cn(
                    "flex h-9 w-full rounded-card border border-input bg-background px-2 text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                >
                  <option value="">All children</option>
                  <option value="__none__">No child</option>
                  {childOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.first_name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="doc-modal-visibility" className="text-xs font-medium">Visibility</Label>
                <select
                  id="doc-modal-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                  className={cn(
                    "flex h-9 w-full rounded-card border border-input bg-background px-2 text-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                >
                  {VISIBILITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Doc ID</p>
                <p className="font-mono text-sm text-foreground">{docIdLabel}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Document title</p>
                <p className="text-sm text-foreground">{doc.title?.trim() || doc.file_name || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">File name</p>
                <p className="text-sm text-foreground break-all">{doc.file_name}</p>
                {doc.file_size_bytes != null && (
                  <p className="text-[11px] text-foreground-secondary mt-0.5">{formatSize(doc.file_size_bytes)}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Category</p>
                <p className="text-sm text-foreground">{CATEGORY_LABELS[doc.category] ?? doc.category}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Child</p>
                <p className="text-sm text-foreground">{doc.child_name ?? "All children"}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Date uploaded</p>
                <p className="text-sm text-foreground">{formatDate(doc.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-foreground-secondary mb-0.5">Visibility</p>
                <span className={cn(
                  "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                  doc.visibility === "private" ? "bg-gray-200 text-gray-800" : "bg-primary/15 text-primary"
                )}>
                  {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                </span>
              </div>
              {doc.description && (
                <div>
                  <p className="text-xs text-foreground-secondary mb-0.5">Description</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{doc.description}</p>
                </div>
              )}
              <div className="pt-2">
                <Button
                  size="sm"
                  variant="outline"
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

          {doc && (
            <section className="space-y-2 border-t border-border pt-4 mt-4">
              <button
                type="button"
                onClick={() => setHistoryOpen((prev) => !prev)}
                className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-foreground-secondary/80 hover:text-foreground"
              >
                <span>Edit history</span>
                <span className="text-[10px]">{historyOpen ? "▾" : "▸"}</span>
              </button>
              {historyOpen && (
                <div className="rounded-card border border-border/60 bg-background-secondary/40 px-3 py-2">
                  {loadingHistory ? (
                    <p className="text-xs text-foreground-secondary">Loading history…</p>
                  ) : history.length === 0 ? (
                    <p className="text-xs text-foreground-secondary">No changes recorded yet.</p>
                  ) : (
                    <ul className="space-y-1 text-xs text-foreground-secondary">
                      {history.map((h) => (
                        <li key={h.id}>
                          <span>{historyFieldLabel(h.field_changed)} changed to {h.new_value ?? "—"}</span>
                          <span className="ml-1">
                            by {h.changed_by_name ?? "Unknown"} — {formatHistoryTimestamp(h.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        {isEditing && doc && (
          <div className="p-4 border-t border-border flex gap-2 justify-end shrink-0">
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" size="sm" className="rounded-full" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
