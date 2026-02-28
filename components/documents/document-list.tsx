"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, FileText, Image, Download, Eye, Pencil, FolderInput, Lock, FileOutput, Trash2 } from "lucide-react";
import { DocumentPreviewDrawer } from "@/components/documents/document-preview-drawer";
import { CategoryPill } from "@/components/documents/category-pill";
import { getCategoryColor } from "@/lib/categoryColors";
import { DateFilterPopover, type DateFilterValue } from "@/components/documents/date-filter-popover";

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

function formatSize(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateName(name: string, maxLen = 28) {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 3) + "…";
}

const SORT_OPTIONS = [
  { value: "date_desc", label: "Date uploaded (newest)" },
  { value: "date_asc", label: "Date uploaded (oldest)" },
  { value: "name_asc", label: "File name (A–Z)" },
  { value: "name_desc", label: "File name (Z–A)" },
  { value: "category", label: "Category" },
  { value: "child", label: "Child" },
  { value: "visibility", label: "Visibility" },
] as const;


function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function DocumentList({ documents, children = [] }: DocumentListProps) {
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebounce(searchInput.trim(), 300);
  const [filterCategory, setFilterCategory] = useState(() => searchParams.get("cat") ?? "all");
  const [filterVisibility, setFilterVisibility] = useState(() => searchParams.get("vis") ?? "all");
  const [filterChild, setFilterChild] = useState(() => searchParams.get("child") ?? "all");
  const [startDate, setStartDate] = useState(() => searchParams.get("startDate") ?? "");
  const [endDate, setEndDate] = useState(() => searchParams.get("endDate") ?? "");
  const [sort, setSort] = useState(() => searchParams.get("sort") ?? "date_desc");
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailDoc, setDetailDoc] = useState<DocumentRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; doc?: DocumentRow } | null>(null);

  const setParams = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([k, v]) => {
        if (v === "all" || v === "" || v === "date_desc") next.delete(k);
        else next.set(k, v);
      });
      window.history.replaceState(null, "", next.toString() ? `?${next}` : window.location.pathname);
    },
    [searchParams]
  );

  useEffect(() => {
    setParams({
      q: debouncedSearch,
      cat: filterCategory,
      vis: filterVisibility,
      child: filterChild,
      startDate,
      endDate,
      sort,
    });
  }, [debouncedSearch, filterCategory, filterVisibility, filterChild, startDate, endDate, sort, setParams]);

  const dateFilterActive = !!(startDate || endDate);

  function applyDateFilter({ startDate: s, endDate: e }: DateFilterValue) {
    setStartDate(s);
    setEndDate(e);
  }

  function clearDateFilter() {
    setStartDate("");
    setEndDate("");
  }

  function cycleDateSort(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("[data-date-filter-trigger]")) return;
    setSort((prev) => (prev === "date_desc" ? "date_asc" : "date_desc"));
  }

  const filteredAndSorted = useMemo(() => {
    let list = [...documents];
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      list = list.filter(
        (d) =>
          (d.file_name ?? "").toLowerCase().includes(q) ||
          (d.category ?? "").toLowerCase().includes(q) ||
          (d.child_name ?? "").toLowerCase().includes(q) ||
          (d.description ?? "").toLowerCase().includes(q)
      );
    }
    if (filterCategory !== "all") list = list.filter((d) => d.category === filterCategory);
    if (filterVisibility !== "all") list = list.filter((d) => d.visibility === filterVisibility);
    if (filterChild !== "all") list = list.filter((d) => (d.child_id ?? "") === filterChild);
    if (startDate) {
      const start = new Date(startDate + "T00:00:00");
      list = list.filter((d) => new Date(d.created_at) >= start);
    }
    if (endDate) {
      const end = new Date(endDate + "T23:59:59.999");
      list = list.filter((d) => new Date(d.created_at) <= end);
    }
    switch (sort) {
      case "date_asc":
        list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case "name_asc":
        list.sort((a, b) => (a.file_name ?? "").localeCompare(b.file_name ?? ""));
        break;
      case "name_desc":
        list.sort((a, b) => (b.file_name ?? "").localeCompare(a.file_name ?? ""));
        break;
      case "category":
        list.sort((a, b) => (CATEGORY_LABELS[a.category] ?? a.category).localeCompare(CATEGORY_LABELS[b.category] ?? b.category));
        break;
      case "child":
        list.sort((a, b) => (a.child_name ?? "").localeCompare(b.child_name ?? ""));
        break;
      case "visibility":
        list.sort((a, b) => (VISIBILITY_LABELS[a.visibility] ?? a.visibility).localeCompare(VISIBILITY_LABELS[b.visibility] ?? b.visibility));
        break;
      default:
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [documents, debouncedSearch, filterCategory, filterVisibility, filterChild, startDate, endDate, sort]);

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

  function openDetail(doc: DocumentRow) {
    setDetailDoc(doc);
    setDrawerOpen(true);
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

  function handleBulkDelete() {
    setDeleteConfirm({ ids: [...selectedIds] });
  }

  function confirmDelete() {
    if (!deleteConfirm) return;
    // Stub: call API to delete; then clear selection and close modal
    setSelectedIds((prev) => {
      const next = new Set(prev);
      deleteConfirm.ids.forEach((id) => next.delete(id));
      return next;
    });
    setDeleteConfirm(null);
  }

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="font-heading text-lg text-foreground">All documents</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            placeholder="Search filename, category, child, description…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="max-w-[220px] h-9 rounded-card border-border text-sm"
            aria-label="Search documents"
          />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="h-9 rounded-card border border-border bg-background px-2 text-xs text-foreground-secondary min-w-[120px]"
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
            ))}
          </select>
          <select
            value={filterVisibility}
            onChange={(e) => setFilterVisibility(e.target.value)}
            className="h-9 rounded-card border border-border bg-background px-2 text-xs text-foreground-secondary min-w-[110px]"
            aria-label="Filter by visibility"
          >
            <option value="all">All visibility</option>
            {visibilities.map((v) => (
              <option key={v} value={v}>{VISIBILITY_LABELS[v] ?? v}</option>
            ))}
          </select>
          {children.length > 0 && (
            <select
              value={filterChild}
              onChange={(e) => setFilterChild(e.target.value)}
              className="h-9 rounded-card border border-border bg-background px-2 text-xs text-foreground-secondary min-w-[100px]"
              aria-label="Filter by child"
            >
              <option value="all">All children</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>{c.first_name}</option>
              ))}
            </select>
          )}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-9 rounded-card border border-border bg-background px-2 text-xs text-foreground-secondary min-w-[160px]"
            aria-label="Sort by"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 py-2 px-3 rounded-card border border-border bg-background-secondary/60">
            <span className="text-xs text-foreground-secondary">{selectedIds.size} selected</span>
            <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={handleDownloadSelected} disabled={downloadingZip}>
              {downloadingZip ? "Preparing…" : "Download"}
            </Button>
            <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={() => {}}>
              Export
            </Button>
            <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={() => {}}>
              Change visibility
            </Button>
            <Button size="sm" variant="outline" className="rounded-full h-8 text-xs" onClick={() => {}}>
              Change category
            </Button>
            <Button size="sm" variant="outline" className="rounded-full h-8 text-xs text-alert hover:text-alert" onClick={handleBulkDelete}>
              Delete
            </Button>
          </div>
        )}

        {documents.length === 0 ? (
          <div className="py-12 text-center rounded-card border border-dashed border-border bg-background-secondary/30">
            <p className="text-sm text-foreground-secondary mb-1">No documents yet.</p>
            <p className="text-xs text-foreground-secondary">Upload your first document using the form on the left.</p>
          </div>
        ) : filteredAndSorted.length === 0 ? (
          <p className="text-sm text-foreground-secondary py-6">No documents match your filters.</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-background-secondary/40">
            <table className="min-w-full text-sm">
              <thead className="bg-background-secondary/80 text-foreground-secondary sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all visible"
                      className="rounded border-border"
                    />
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium w-20">Doc ID</th>
                  <th className="px-3 py-2.5 text-left font-medium w-8" title="Type"><span className="sr-only">Type</span></th>
                  <th className="px-3 py-2.5 text-left font-medium">File name</th>
                  <th className="px-3 py-2.5 text-left font-medium w-16">Size</th>
                  <th className="px-3 py-2.5 text-left font-medium">Category</th>
                  <th className="px-3 py-2.5 text-left font-medium">Child</th>
                  <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={cycleDateSort}
                        className="hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        Date uploaded
                      </button>
                      <span data-date-filter-trigger className="shrink-0">
                        <DateFilterPopover
                          open={dateFilterOpen}
                          onOpenChange={setDateFilterOpen}
                          startDate={startDate}
                          endDate={endDate}
                          onApply={applyDateFilter}
                          onClear={clearDateFilter}
                          active={dateFilterActive}
                        />
                      </span>
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium">Visibility</th>
                  <th className="px-3 py-2.5 text-left font-medium w-16">Status</th>
                  <th className="px-3 py-2.5 w-10" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.map((doc, idx) => {
                  const docIdLabel = doc.document_number != null ? docIdFromNumber(doc.document_number) : docIdFromNumber(idx + 1);
                  const isDeleted = !!doc.deleted_at;
                  const isImage = doc.mime_type?.startsWith("image/");
                  const categoryColors = getCategoryColor(doc.category);
                  return (
                    <tr
                      key={doc.id}
                      className={cn(
                        "border-t border-border cursor-pointer border-l-4",
                        categoryColors.stripeClass,
                        idx % 2 === 0 ? "bg-background" : "bg-background-secondary/40",
                        isDeleted && "opacity-60",
                        "hover:bg-primary/5"
                      )}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('input[type="checkbox"]') || (e.target as HTMLElement).closest("[data-dropdown]")) return;
                        openDetail(doc);
                      }}
                    >
                      <td className="px-3 py-2.5 w-10" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(doc.id)}
                          onChange={() => toggleSelect(doc.id)}
                          aria-label={`Select ${doc.file_name}`}
                          className="rounded border-border"
                        />
                      </td>
                      <td className={cn("px-3 py-2.5 font-mono text-xs", isDeleted && "line-through text-foreground-secondary")}>
                        {docIdLabel}
                      </td>
                      <td className="px-3 py-2.5">
                        {isImage ? (
                          <Image className="h-4 w-4 text-foreground-secondary" aria-hidden />
                        ) : (
                          <FileText className="h-4 w-4 text-foreground-secondary" aria-hidden />
                        )}
                      </td>
                      <td className={cn("px-3 py-2.5 text-foreground", isDeleted && "line-through text-foreground-secondary")}>
                        <span title={doc.file_name}>{truncateName(doc.file_name ?? "")}</span>
                      </td>
                      <td className={cn("px-3 py-2.5 text-foreground-secondary text-xs", isDeleted && "line-through")}>
                        {formatSize(doc.file_size_bytes)}
                      </td>
                      <td className={cn("px-3 py-2.5", isDeleted && "line-through")}>
                        <CategoryPill
                          category={doc.category}
                          label={CATEGORY_LABELS[doc.category] ?? doc.category}
                        />
                      </td>
                      <td className={cn("px-3 py-2.5 text-foreground-secondary", isDeleted && "line-through")}>
                        {doc.child_name ?? "—"}
                      </td>
                      <td className={cn("px-3 py-2.5 text-foreground-secondary whitespace-nowrap", isDeleted && "line-through")}>
                        {formatDate(doc.created_at)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                            doc.visibility === "private" ? "bg-gray-200 text-gray-800" : "bg-primary/15 text-primary"
                          )}
                        >
                          {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-foreground-secondary">
                        Ready
                      </td>
                      <td className="px-3 py-2.5 w-10" onClick={(e) => e.stopPropagation()} data-dropdown>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="p-1.5 rounded hover:bg-muted text-foreground-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label="Row actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(doc)}>
                              <Eye className="h-3.5 w-3.5 mr-2" /> Preview
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={async () => {
                                const res = await fetch(`/api/documents/${doc.id}/download`);
                                const data = await res.json();
                                if (data?.url) window.open(data.url, "_blank");
                              }}
                            >
                              <Download className="h-3.5 w-3.5 mr-2" /> Download
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openDetail(doc)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" /> Edit metadata
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {}}>
                              <FolderInput className="h-3.5 w-3.5 mr-2" /> Move category
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {}}>
                              <Lock className="h-3.5 w-3.5 mr-2" /> Change visibility
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {}}>
                              <FileOutput className="h-3.5 w-3.5 mr-2" /> Export
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-alert focus:text-alert"
                              onClick={() => setDeleteConfirm({ ids: [doc.id], doc })}
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <DocumentPreviewDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDetailDoc(null); }}
        document={detailDoc}
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-background border border-border rounded-card shadow-card max-w-sm w-full mx-4 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 id="delete-title" className="font-heading text-base font-semibold text-foreground mb-2">Delete document{deleteConfirm.ids.length > 1 ? "s" : ""}?</h3>
            <p className="text-sm text-foreground-secondary mb-4">
              This action is permanent. {deleteConfirm.ids.length > 1 ? "Selected documents will be removed." : "This document will be removed."}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button size="sm" className="rounded-full bg-alert hover:bg-alert/90" onClick={confirmDelete}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
