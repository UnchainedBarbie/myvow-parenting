"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DocumentDetailModal } from "@/components/documents/document-detail-modal";

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

type Child = { id: string; first_name: string };

interface DocumentListProps {
  documents: DocumentRow[];
  children?: Child[];
}

function formatDate(createdAt: string) {
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function docIdFromNumber(n: number) {
  return `DOC-${String(n).padStart(3, "0")}`;
}

export function DocumentList({ documents, children = [] }: DocumentListProps) {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterVisibility, setFilterVisibility] = useState<string>("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailDoc, setDetailDoc] = useState<DocumentRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const filteredAndSorted = useMemo(() => {
    let list = [...documents];
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (d) =>
          (d.file_name ?? "").toLowerCase().includes(q) ||
          (d.category ?? "").toLowerCase().includes(q) ||
          (d.description ?? "").toLowerCase().includes(q)
      );
    }
    if (filterCategory !== "all") list = list.filter((d) => d.category === filterCategory);
    if (filterVisibility !== "all") list = list.filter((d) => d.visibility === filterVisibility);
    list.sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortDir === "desc" ? tb - ta : ta - tb;
    });
    return list;
  }, [documents, search, filterCategory, filterVisibility, sortDir]);

  const categories = useMemo(() => [...new Set(documents.map((d) => d.category))], [documents]);
  const visibilities = useMemo(() => [...new Set(documents.map((d) => d.visibility))], [documents]);

  const visibleIds = useMemo(() => new Set(filteredAndSorted.map((d) => d.id)), [filteredAndSorted]);
  const allVisibleSelected = visibleIds.size > 0 && filteredAndSorted.every((d) => selectedIds.has(d.id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDownloadSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setDownloadingZip(true);
    try {
      const res = await fetch("/api/documents/download-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "documents.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // no-op
    } finally {
      setDownloadingZip(false);
    }
  }

  function openDetail(doc: DocumentRow) {
    setDetailDoc(doc);
    setDetailOpen(true);
  }

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-4">
        <CardTitle className="font-heading text-lg text-foreground">All documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            placeholder="Search by filename, category, description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs h-9 rounded-card border-border text-sm"
          />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-9 rounded-card border border-border bg-background px-2 text-xs text-foreground-secondary"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
            ))}
          </select>
          <select
            value={filterVisibility}
            onChange={(e) => setFilterVisibility(e.target.value)}
            className="h-9 rounded-card border border-border bg-background px-2 text-xs text-foreground-secondary"
          >
            <option value="all">All visibility</option>
            {visibilities.map((v) => (
              <option key={v} value={v}>{VISIBILITY_LABELS[v] ?? v}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            className="text-xs text-foreground-secondary hover:text-foreground"
          >
            Date {sortDir === "desc" ? "↓ Newest" : "↑ Oldest"}
          </button>
        </div>

        {selectedIds.size > 0 && (
          <Button
            size="sm"
            className="rounded-full"
            onClick={handleDownloadSelected}
            disabled={downloadingZip}
          >
            {downloadingZip ? "Preparing…" : "Download selected"}
          </Button>
        )}

        {documents.length === 0 ? (
          <p className="text-sm text-foreground-secondary py-6">
            No documents yet. Add one above.
          </p>
        ) : filteredAndSorted.length === 0 ? (
          <p className="text-sm text-foreground-secondary py-6">
            No documents match your filters.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-background-secondary/40">
            <table className="min-w-full text-sm">
              <thead className="bg-background-secondary/80 text-foreground-secondary">
                <tr>
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all"
                      className="rounded border-border"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Doc ID</th>
                  <th className="px-3 py-2 text-left font-medium">File name</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-left font-medium">Child</th>
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Date uploaded</th>
                  <th className="px-3 py-2 text-left font-medium">Visibility</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map((doc, idx) => {
                  const docIdLabel = doc.document_number != null ? docIdFromNumber(doc.document_number) : docIdFromNumber(idx + 1);
                  const isDeleted = !!doc.deleted_at;
                  return (
                    <tr
                      key={doc.id}
                      className={cn(
                        "border-t border-border cursor-pointer",
                        idx % 2 === 0 ? "bg-background" : "bg-background-secondary/40",
                        isDeleted && "opacity-60",
                        "hover:bg-primary/5"
                      )}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('input[type="checkbox"]')) return;
                        openDetail(doc);
                      }}
                    >
                      <td className="px-3 py-2 w-10" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(doc.id)}
                          onChange={() => toggleSelect(doc.id)}
                          aria-label={`Select ${doc.file_name}`}
                          className="rounded border-border"
                        />
                      </td>
                      <td className={cn("px-3 py-2 font-mono text-xs", isDeleted && "line-through text-foreground-secondary")}>
                        {docIdLabel}
                      </td>
                      <td className={cn("px-3 py-2 text-foreground", isDeleted && "line-through text-foreground-secondary")}>
                        {doc.file_name}
                      </td>
                      <td className={cn("px-3 py-2 text-foreground-secondary", isDeleted && "line-through")}>
                        {CATEGORY_LABELS[doc.category] ?? doc.category}
                      </td>
                      <td className={cn("px-3 py-2 text-foreground-secondary", isDeleted && "line-through")}>
                        {doc.child_name ?? "—"}
                      </td>
                      <td className={cn("px-3 py-2 text-foreground-secondary whitespace-nowrap", isDeleted && "line-through")}>
                        {formatDate(doc.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-block px-2 py-0.5 rounded-full text-xs",
                            doc.visibility === "private" ? "bg-gray-100 text-gray-600" : "bg-primary/10 text-primary"
                          )}
                        >
                          {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <DocumentDetailModal
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetailDoc(null); }}
        document={detailDoc}
      />
    </Card>
  );
}
