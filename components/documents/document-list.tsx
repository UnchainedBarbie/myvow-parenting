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
import { ColumnFilterPopover } from "@/components/documents/column-filter-popover";
import { DescriptionFilterPopover } from "@/components/documents/description-filter-popover";

const CHILD_NONE_VALUE = "__none__";

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

/** Truncate to roughly one line (~60 chars) with ellipsis. */
function truncateDescription(text: string | null, maxLen = 60) {
  const t = text?.trim() ?? "";
  if (t.length <= maxLen) return t || "—";
  return t.slice(0, maxLen - 1).trim() + "…";
}

const SORT_OPTIONS = [
  { value: "date_desc", label: "Date uploaded (newest)" },
  { value: "date_asc", label: "Date uploaded (oldest)" },
  { value: "desc_asc", label: "Description (A–Z)" },
  { value: "desc_desc", label: "Description (Z–A)" },
] as const;


function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function parseMultiParam(s: string | null): string[] {
  if (!s?.trim()) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export function DocumentList({ documents, children = [] }: DocumentListProps) {
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebounce(searchInput.trim(), 300);
  const [filterCategories, setFilterCategories] = useState<string[]>(() => parseMultiParam(searchParams.get("cat")));
  const [filterChildren, setFilterChildren] = useState<string[]>(() => parseMultiParam(searchParams.get("child")));
  const [filterVisibilities, setFilterVisibilities] = useState<string[]>(() => parseMultiParam(searchParams.get("vis")));
  const [filterDescription, setFilterDescription] = useState(() => searchParams.get("desc") ?? "");
  const [startDate, setStartDate] = useState(() => searchParams.get("startDate") ?? "");
  const [endDate, setEndDate] = useState(() => searchParams.get("endDate") ?? "");
  const [sort, setSort] = useState(() => searchParams.get("sort") ?? "date_desc");
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  const [childFilterOpen, setChildFilterOpen] = useState(false);
  const [visibilityFilterOpen, setVisibilityFilterOpen] = useState(false);
  const [descriptionFilterOpen, setDescriptionFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailDoc, setDetailDoc] = useState<DocumentRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ ids: string[]; doc?: DocumentRow } | null>(null);

  const setParams = useCallback(
    (updates: Record<string, string | string[]>) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([k, v]) => {
        if (v === undefined || v === null) {
          next.delete(k);
          return;
        }
        const str = Array.isArray(v) ? v.filter(Boolean).join(",") : String(v);
        const shouldDelete =
          str === "" ||
          (k !== "desc" && str === "date_desc") ||
          (k !== "desc" && str === "all");
        if (shouldDelete) next.delete(k);
        else next.set(k, str);
      });
      window.history.replaceState(null, "", next.toString() ? `?${next}` : window.location.pathname);
    },
    [searchParams]
  );

  useEffect(() => {
    setParams({
      q: debouncedSearch,
      cat: filterCategories,
      child: filterChildren,
      vis: filterVisibilities,
      desc: filterDescription,
      startDate,
      endDate,
      sort,
    });
  }, [debouncedSearch, filterCategories, filterChildren, filterVisibilities, filterDescription, startDate, endDate, sort, setParams]);

  const dateFilterActive = !!(startDate || endDate);
  const categoryFilterActive = filterCategories.length > 0;
  const childFilterActive = filterChildren.length > 0;
  const visibilityFilterActive = filterVisibilities.length > 0;
  const descriptionFilterActive = filterDescription.trim().length > 0;

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
    if (filterDescription.trim()) {
      const words = filterDescription.trim().toLowerCase().split(/\s+/).filter(Boolean);
      list = list.filter((d) => {
        const desc = (d.description ?? "").toLowerCase();
        return words.every((w) => desc.includes(w));
      });
    }
    if (filterCategories.length > 0) list = list.filter((d) => filterCategories.includes(d.category));
    if (filterVisibilities.length > 0) list = list.filter((d) => filterVisibilities.includes(d.visibility));
    if (filterChildren.length > 0) {
      list = list.filter((d) => {
        const key = d.child_id ?? CHILD_NONE_VALUE;
        return filterChildren.includes(key);
      });
    }
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
      case "desc_asc":
        list.sort((a, b) => (a.description ?? "").toLowerCase().localeCompare((b.description ?? "").toLowerCase()));
        break;
      case "desc_desc":
        list.sort((a, b) => (b.description ?? "").toLowerCase().localeCompare((a.description ?? "").toLowerCase()));
        break;
      default:
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [documents, debouncedSearch, filterDescription, filterCategories, filterVisibilities, filterChildren, startDate, endDate, sort]);

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
        <div className="flex items-center gap-2">
          <Input
            type="search"
            placeholder="Search description, filename, category, child…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-full max-w-[280px] rounded-card border-border text-sm"
            aria-label="Search documents"
          />
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
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-background-secondary/40">
            <table className="w-full text-sm table-fixed" style={{ tableLayout: "fixed", minWidth: 900 }}>
              <colgroup>
                <col style={{ width: 40 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 36 }} />
                <col />
                <col style={{ width: 140 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 140 }} />
              </colgroup>
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
                  <th className="px-3 py-2.5 text-left font-medium w-8" title="File type"><span className="sr-only">Type</span></th>
                  <th className="px-3 py-2.5 text-left font-medium min-w-[140px]">
                    <span className="inline-flex items-center gap-1">
                      <span>Description</span>
                      <DescriptionFilterPopover
                        open={descriptionFilterOpen}
                        onOpenChange={setDescriptionFilterOpen}
                        value={filterDescription}
                        onApply={setFilterDescription}
                        onClear={() => setFilterDescription("")}
                        active={descriptionFilterActive}
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Category</span>
                      <ColumnFilterPopover
                        title="Category"
                        options={categories.map((c) => ({ value: c, label: CATEGORY_LABELS[c] ?? c }))}
                        selected={filterCategories}
                        onApply={setFilterCategories}
                        onClear={() => setFilterCategories([])}
                        open={categoryFilterOpen}
                        onOpenChange={setCategoryFilterOpen}
                        active={categoryFilterActive}
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Child</span>
                      <ColumnFilterPopover
                        title="Child"
                        options={children.map((c) => ({ value: c.id, label: c.first_name }))}
                        selected={filterChildren}
                        onApply={setFilterChildren}
                        onClear={() => setFilterChildren([])}
                        open={childFilterOpen}
                        onOpenChange={setChildFilterOpen}
                        active={childFilterActive}
                        noneValue={CHILD_NONE_VALUE}
                        noneLabel="— No child"
                      />
                    </span>
                  </th>
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
                  <th className="px-3 py-2.5 text-left font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Visibility</span>
                      <ColumnFilterPopover
                        title="Visibility"
                        options={visibilities.map((v) => ({ value: v, label: VISIBILITY_LABELS[v] ?? v }))}
                        selected={filterVisibilities}
                        onApply={setFilterVisibilities}
                        onClear={() => setFilterVisibilities([])}
                        open={visibilityFilterOpen}
                        onOpenChange={setVisibilityFilterOpen}
                        active={visibilityFilterActive}
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2.5 w-[140px]">
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                      className="h-8 w-full rounded-card border border-border bg-background px-2 text-xs text-foreground-secondary"
                      aria-label="Sort by"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-sm text-foreground-secondary text-center">
                      No documents match your filters.
                    </td>
                  </tr>
                ) : (
                filteredAndSorted.map((doc, idx) => {
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
                          aria-label={`Select ${doc.description ?? doc.file_name}`}
                          className="rounded border-border"
                        />
                      </td>
                      <td className={cn("px-3 py-2.5 font-mono text-xs", isDeleted && "line-through text-foreground-secondary")}>
                        {docIdLabel}
                      </td>
                      <td className="px-3 py-2.5" title={doc.file_name}>
                        {isImage ? (
                          <Image className="h-4 w-4 text-foreground-secondary" aria-hidden />
                        ) : (
                          <FileText className="h-4 w-4 text-foreground-secondary" aria-hidden />
                        )}
                      </td>
                      <td className={cn("px-3 py-2.5 min-w-[140px]", isDeleted && "line-through")}>
                        <div className="flex flex-col gap-0.5">
                          <span
                            className="text-foreground line-clamp-1"
                            title={doc.description ?? undefined}
                          >
                            {truncateDescription(doc.description)}
                          </span>
                          <span className="text-[11px] text-foreground-secondary truncate">
                            {doc.file_name ?? "—"}
                            {doc.file_size_bytes != null && ` • ${formatSize(doc.file_size_bytes)}`}
                          </span>
                        </div>
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
                })
                )}
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
