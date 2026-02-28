"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function formatSize(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentList({ documents, children = [] }: DocumentListProps) {
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterChild, setFilterChild] = useState<string>("all");
  const [filterVisibility, setFilterVisibility] = useState<string>("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
    if (filterChild !== "all") list = list.filter((d) => d.child_id === filterChild);
    if (filterVisibility !== "all") list = list.filter((d) => d.visibility === filterVisibility);
    list.sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortDir === "desc" ? tb - ta : ta - tb;
    });
    return list;
  }, [documents, search, filterCategory, filterChild, filterVisibility, sortDir]);

  const categories = useMemo(() => [...new Set(documents.map((d) => d.category))], [documents]);
  const visibilities = useMemo(() => [...new Set(documents.map((d) => d.visibility))], [documents]);

  async function handleDownload(docId: string) {
    try {
      const res = await fetch(`/api/documents/${docId}/download`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      if (data.url) window.open(data.url, "_blank");
    } catch {
      // no-op
    }
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
          {children.length > 0 && (
            <select
              value={filterChild}
              onChange={(e) => setFilterChild(e.target.value)}
              className="h-9 rounded-card border border-border bg-background px-2 text-xs text-foreground-secondary"
            >
              <option value="all">All children</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>{c.first_name}</option>
              ))}
            </select>
          )}
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
                  <th className="px-3 py-2 text-left font-medium">File name</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-left font-medium">Child</th>
                  <th className="px-3 py-2 text-left font-medium">Description</th>
                  <th className="px-3 py-2 text-left font-medium">Visibility</th>
                  <th className="px-3 py-2 text-left font-medium">Linked log</th>
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Date</th>
                  <th className="px-3 py-2 text-right font-medium">Size</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map((doc, idx) => (
                  <tr
                    key={doc.id}
                    className={cn(
                      "border-t border-border",
                      idx % 2 === 0 ? "bg-background" : "bg-background-secondary/40"
                    )}
                  >
                    <td className="px-3 py-2 text-foreground">{doc.file_name}</td>
                    <td className="px-3 py-2 text-foreground-secondary">
                      {CATEGORY_LABELS[doc.category] ?? doc.category}
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary">{doc.child_name ?? "—"}</td>
                    <td className="px-3 py-2 text-foreground-secondary max-w-[180px] truncate">
                      {doc.description ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary">
                      {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary font-mono text-xs max-w-[120px] truncate" title={doc.related_comm_id ?? undefined}>
                      {doc.related_comm_id ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-foreground-secondary whitespace-nowrap">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="px-3 py-2 text-right text-foreground-secondary whitespace-nowrap">
                      {formatSize(doc.file_size_bytes)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleDownload(doc.id)}
                        >
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => handleDownload(doc.id)}
                        >
                          Download
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-foreground-secondary" disabled title="PDF bundle — coming soon">
                          Export
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
