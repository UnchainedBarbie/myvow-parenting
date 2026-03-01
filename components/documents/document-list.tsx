"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DocumentDetailModal } from "@/components/documents/document-detail-modal";
import { CategoryPill } from "@/components/documents/category-pill";
import { getCategoryColor } from "@/lib/categoryColors";
import { DateFilterPopover, type DateFilterValue } from "@/components/documents/date-filter-popover";
import { ColumnFilterPopover } from "@/components/documents/column-filter-popover";
import { TitleFilterPopover } from "@/components/documents/title-filter-popover";
import { Filter, Pencil, Download, Trash2 } from "lucide-react";

const CHILD_NONE_VALUE = "__none__";
/** Value for "All children" filter (documents where child_id is null). */
const CHILD_ALL_VALUE = "__all__";

const CATEGORY_LABELS: Record<string, string> = {
  court_order: "Court Order",
  school: "School",
  medical: "Medical",
  expenses: "Expenses",
  therapy: "Therapy",
  legal: "Legal",
  custody: "Custody",
  photos: "Photos",
  communication: "Communication",
  incident: "Incident",
  other: "Other",
  financial: "Expenses",
};

/** Full list of category options for the filter (show all, not just those in current documents). */
const ALL_CATEGORY_OPTIONS = [
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

/** Category color dots — every category has a visible dot. Same map for table rows and Category filter popup. */
const DOCUMENT_CATEGORY_DOT: Record<string, string> = {
  court_order: "bg-slate-500",
  school: "bg-emerald-500",
  medical: "bg-blue-500",
  expenses: "bg-amber-400",
  therapy: "bg-purple-500",
  legal: "bg-slate-400",
  custody: "bg-orange-400",
  photos: "bg-teal-500",
  communication: "bg-indigo-400",
  incident: "bg-rose-400",
  other: "bg-gray-400",
};
function getDocumentCategoryDot(category: string | null | undefined): string {
  const key = category != null && String(category).trim() !== "" ? String(category) : "other";
  return DOCUMENT_CATEGORY_DOT[key] ?? "bg-gray-400";
}

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
  /** From document_children join; empty = "All children". */
  child_ids?: string[];
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

/** Escape a value for CSV (quote if needed, escape " as ""). */
function csvEscape(value: string): string {
  const s = String(value ?? "").replace(/"/g, '""');
  return /[",\r\n]/.test(s) ? `"${s}"` : s;
}

function formatSize(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Truncate to roughly one line (~60 chars) with ellipsis. */
function truncateTitle(text: string | null, maxLen = 60) {
  const t = text?.trim() ?? "";
  if (t.length <= maxLen) return t || "—";
  return t.slice(0, maxLen - 1).trim() + "…";
}

const SORT_OPTIONS = [
  { value: "date_desc", label: "Date (newest)" },
  { value: "date_asc", label: "Date (oldest)" },
  { value: "title_asc", label: "Title (A–Z)" },
  { value: "title_desc", label: "Title (Z–A)" },
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(() => searchParams.get("q") ?? "");
  const debouncedSearch = useDebounce(searchInput.trim(), 300);
  const [filterCategories, setFilterCategories] = useState<string[]>(() => parseMultiParam(searchParams.get("cat")));
  const [filterChildren, setFilterChildren] = useState<string[]>(() => parseMultiParam(searchParams.get("child")));
  const [filterVisibilities, setFilterVisibilities] = useState<string[]>(() => parseMultiParam(searchParams.get("vis")));
  const [startDate, setStartDate] = useState(() => searchParams.get("startDate") ?? "");
  const [endDate, setEndDate] = useState(() => searchParams.get("endDate") ?? "");
  const [sort, setSort] = useState(() => searchParams.get("sort") ?? "date_desc");
  const [filterTitle, setFilterTitle] = useState(() => searchParams.get("tit") ?? "");
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  const [childFilterOpen, setChildFilterOpen] = useState(false);
  const [visibilityFilterOpen, setVisibilityFilterOpen] = useState(false);
  const [titleFilterOpen, setTitleFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailDoc, setDetailDoc] = useState<DocumentRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailEditMode, setDetailEditMode] = useState(false);
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
      tit: filterTitle,
      startDate,
      endDate,
      sort,
    });
  }, [debouncedSearch, filterCategories, filterChildren, filterVisibilities, filterTitle, startDate, endDate, sort, setParams]);

  const dateFilterActive = !!(startDate || endDate);
  const categoryFilterActive = filterCategories.length > 0;
  const childFilterActive = filterChildren.length > 0;
  const visibilityFilterActive = filterVisibilities.length > 0;
  const titleFilterActive =
    filterTitle.trim().length > 0 ||
    sort === "title_asc" ||
    sort === "title_desc";
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
          (d.title ?? "").toLowerCase().includes(q) ||
          (d.file_name ?? "").toLowerCase().includes(q) ||
          (d.category ?? "").toLowerCase().includes(q) ||
          (d.child_name ?? "").toLowerCase().includes(q) ||
          (d.description ?? "").toLowerCase().includes(q)
      );
    }
    if (filterTitle.trim()) {
      const q = filterTitle.trim().toLowerCase();
      list = list.filter((d) => (d.title ?? "").toLowerCase().includes(q));
    }
    if (filterCategories.length > 0) list = list.filter((d) => filterCategories.includes(d.category));
    if (filterVisibilities.length > 0) list = list.filter((d) => filterVisibilities.includes(d.visibility));
    if (filterChildren.length > 0) {
      list = list.filter((d) => {
        const ids = d.child_ids ?? (d.child_id ? [d.child_id] : []);
        if (ids.length === 0) {
          return filterChildren.includes(CHILD_ALL_VALUE) || filterChildren.includes(CHILD_NONE_VALUE);
        }
        return ids.some((id) => filterChildren.includes(id));
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
      case "title_asc":
        list.sort((a, b) => (a.title ?? "").toLowerCase().localeCompare((b.title ?? "").toLowerCase()));
        break;
      case "title_desc":
        list.sort((a, b) => (b.title ?? "").toLowerCase().localeCompare((a.title ?? "").toLowerCase()));
        break;
      default:
        list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return list;
  }, [documents, debouncedSearch, filterTitle, filterCategories, filterVisibilities, filterChildren, startDate, endDate, sort]);

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

  function openDetail(doc: DocumentRow, editMode = false) {
    setDetailDoc(doc);
    setDetailEditMode(editMode);
    setDetailOpen(true);
  }

  async function handleDownloadSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setDownloadingZip(true);
    const timeoutMs = 30_000;
    const timeoutId = setTimeout(() => {
      setDownloadingZip(false);
    }, timeoutMs);
    try {
      const res = await fetch("/api/documents/download-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const text = await res.text();
        let message = "Download failed.";
        try {
          const json = JSON.parse(text);
          if (json?.error) message = json.error;
        } catch {
          if (text) message = text;
        }
        console.error("[bulk-download] Server error:", res.status, message);
        console.error("[bulk-download] Full server response:", text);
        alert(message);
        return;
      }
      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        console.error("[bulk-download] Empty ZIP received");
        alert("Download failed: no files could be included in the ZIP.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "documents.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[bulk-download] Download error:", e);
      alert("Download failed. Check the console for details.");
    } finally {
      clearTimeout(timeoutId);
      setDownloadingZip(false);
    }
  }

  function handleBulkDelete() {
    setDeleteConfirm({ ids: [...selectedIds] });
  }

  async function confirmDelete() {
    console.log("[bulk-delete] confirmDelete called, deleteConfirm:", deleteConfirm);
    if (!deleteConfirm) return;
    console.log("[bulk-delete] Calling /api/documents/delete with ids:", deleteConfirm.ids);
    try {
      const res = await fetch("/api/documents/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: deleteConfirm.ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("[bulk-delete] Server error:", res.status, data);
        alert(data?.error ?? "Failed to delete documents.");
        return;
      }
      setSelectedIds(new Set());
      setDeleteConfirm(null);
      router.refresh();
    } catch (e) {
      console.error("[bulk-delete] Error:", e);
      alert("Failed to delete documents.");
    }
  }

  function handleExportCSV() {
    const headers = ["Doc ID", "Title", "File name", "Category", "Child", "Date uploaded", "Visibility", "Description"];
    const rows = filteredAndSorted.map((doc, idx) => {
      const docId = doc.document_number != null ? docIdFromNumber(doc.document_number) : docIdFromNumber(idx + 1);
      return [
        docId,
        doc.title?.trim() ?? doc.file_name ?? "",
        doc.file_name ?? "",
        CATEGORY_LABELS[doc.category] ?? doc.category,
        doc.child_name ?? "All children",
        formatDate(doc.created_at),
        VISIBILITY_LABELS[doc.visibility] ?? doc.visibility,
        doc.description ?? "",
      ].map(csvEscape).join(",");
    });
    const csv = [headers.map(csvEscape).join(","), ...rows].join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MyVow_Documents_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const anyFilterActive =
    searchInput.trim().length > 0 ||
    filterTitle.trim().length > 0 ||
    filterCategories.length > 0 ||
    filterChildren.length > 0 ||
    filterVisibilities.length > 0;

  function clearAllFilters() {
    setSearchInput("");
    setFilterTitle("");
    setFilterCategories([]);
    setFilterChildren([]);
    setFilterVisibilities([]);
    setSort("date_desc");
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
            placeholder="Search title, description, filename…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-full max-w-[280px] rounded-card border-border text-sm"
            aria-label="Search documents"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-full text-xs shrink-0"
            onClick={handleExportCSV}
            disabled={filteredAndSorted.length === 0}
          >
            Export
          </Button>
          {anyFilterActive && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-xs text-foreground-secondary hover:text-foreground hover:underline shrink-0"
            >
              Clear filters
            </button>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 py-2 px-3 rounded-card border border-border bg-background-secondary/60">
            <span className="text-xs text-foreground-secondary">{selectedIds.size} selected</span>
            <Button
              size="sm"
              className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
              onClick={handleDownloadSelected}
              disabled={downloadingZip}
            >
              {downloadingZip ? "Preparing…" : "Download"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full h-8 text-xs text-red-600/90 hover:text-red-700 hover:bg-red-50"
              onClick={handleBulkDelete}
            >
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
          <>
          <p className="text-[11px] text-foreground-secondary mb-1.5">Select documents to download multiple files</p>
          <div className="overflow-x-auto rounded-card border border-border bg-background">
            <table className="min-w-full table-fixed text-left text-xs md:text-sm">
              <colgroup>
                <col style={{ width: 40 }} />
                <col style={{ width: 76 }} />
                <col style={{ width: "40%" }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 72 }} />
              </colgroup>
              <thead>
                <tr className="bg-[#E7EFE8]/80 text-foreground-secondary">
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all visible"
                      className="rounded border-border"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Doc ID</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSort((prev) => (prev === "title_asc" ? "title_desc" : "title_asc"))}
                        className="hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded text-left"
                        aria-label={sort === "title_asc" ? "Title (A–Z), click for Z–A" : sort === "title_desc" ? "Title (Z–A), click for A–Z" : "Sort by title"}
                      >
                        Title
                      </button>
                      <TitleFilterPopover
                        open={titleFilterOpen}
                        onOpenChange={setTitleFilterOpen}
                        value={filterTitle}
                        currentSort={sort}
                        onApply={(value, titleSort) => {
                          setFilterTitle(value);
                          setSort(titleSort);
                        }}
                        onClear={() => {
                          setFilterTitle("");
                          setSort("date_desc");
                        }}
                        active={titleFilterActive}
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Category</span>
                      <ColumnFilterPopover
                        title="Category"
                        options={[...ALL_CATEGORY_OPTIONS]}
                        selected={filterCategories}
                        onApply={setFilterCategories}
                        onClear={() => setFilterCategories([])}
                        open={categoryFilterOpen}
                        onOpenChange={setCategoryFilterOpen}
                        active={categoryFilterActive}
                        getOptionDotClass={getDocumentCategoryDot}
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Child</span>
                      <ColumnFilterPopover
                        title="Child"
                        options={[
                          { value: CHILD_ALL_VALUE, label: "All children" },
                          { value: CHILD_NONE_VALUE, label: "No child" },
                          ...(children ?? []).map((c) => ({ value: c.id, label: c.first_name })),
                        ]}
                        selected={filterChildren}
                        onApply={setFilterChildren}
                        onClear={() => setFilterChildren([])}
                        open={childFilterOpen}
                        onOpenChange={setChildFilterOpen}
                        active={childFilterActive}
                        allLabel="All"
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">
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
                  <th className="px-3 py-2 font-medium">
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
                  <th className="w-[72px] px-2 py-2 font-medium" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredAndSorted.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-sm text-foreground-secondary text-center">
                      No documents match your filters.
                    </td>
                  </tr>
                ) : (
                filteredAndSorted.map((doc, idx) => {
                  const docIdLabel = doc.document_number != null ? docIdFromNumber(doc.document_number) : docIdFromNumber(idx + 1);
                  const isDeleted = !!doc.deleted_at;
                  const categoryColors = getCategoryColor(doc.category);
                  const rowBg = isDeleted
                    ? "bg-gray-50"
                    : idx % 2 === 0
                      ? "bg-background"
                      : "bg-[#FAF8F5]";
                  return (
                    <tr
                      key={doc.id}
                      className={cn(
                        "border-t border-border cursor-pointer border-l-4",
                        categoryColors.stripeClass,
                        rowBg,
                        isDeleted && "opacity-60",
                        "hover:bg-background-secondary/50"
                      )}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('input[type="checkbox"]')) return;
                        openDetail(doc, false);
                      }}
                    >
                      <td className="px-3 py-1.5 w-10 align-middle" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(doc.id)}
                          onChange={() => toggleSelect(doc.id)}
                          aria-label={`Select ${doc.title ?? doc.file_name}`}
                          className="rounded border-border"
                        />
                      </td>
                      <td className={cn("px-3 py-1.5 text-xs align-middle", isDeleted && "line-through text-foreground-secondary")}>
                        {docIdLabel}
                      </td>
                      <td className={cn("px-3 py-1.5 align-middle min-w-0", isDeleted && "line-through")}>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span
                            className="font-semibold text-foreground overflow-hidden text-ellipsis whitespace-nowrap block"
                            title={doc.title?.trim() || doc.file_name || undefined}
                          >
                            {doc.title?.trim() || doc.file_name || "—"}
                          </span>
                          <span className="text-[11px] text-foreground-secondary overflow-hidden text-ellipsis whitespace-nowrap block">
                            {doc.file_name ?? "—"}
                            {doc.file_size_bytes != null && ` • ${formatSize(doc.file_size_bytes)}`}
                          </span>
                        </div>
                      </td>
                      <td className={cn("px-3 py-1.5 align-middle", isDeleted && "line-through")}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", getDocumentCategoryDot(doc.category))}
                            aria-hidden
                          />
                          <CategoryPill
                            category={doc.category}
                            label={CATEGORY_LABELS[doc.category] ?? doc.category}
                          />
                        </span>
                      </td>
                      <td className={cn("px-3 py-1.5 text-foreground-secondary align-middle", isDeleted && "line-through")}>
                        {doc.child_name ?? "All children"}
                      </td>
                      <td className={cn("px-3 py-1.5 text-foreground-secondary whitespace-nowrap align-middle", isDeleted && "line-through")}>
                        {formatDate(doc.created_at)}
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <span
                          className={cn(
                            "inline-block px-2 py-0.5 rounded-full text-xs font-medium",
                            doc.visibility === "private"
                              ? "bg-gray-200 text-gray-800"
                              : "bg-[#7B9E87]/15 text-[#5A7A63]"
                          )}
                        >
                          {VISIBILITY_LABELS[doc.visibility] ?? doc.visibility}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 align-middle" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const res = await fetch(`/api/documents/${doc.id}/download`);
                              const data = await res.json();
                              if (data?.url) window.open(data.url, "_blank");
                            }}
                            className="p-1.5 rounded text-foreground-secondary hover:text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Download document"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openDetail(doc, true); }}
                            className="p-1.5 rounded text-foreground-secondary hover:text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Edit document"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ ids: [doc.id] }); }}
                            className="p-1.5 rounded text-gray-400 hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Delete document"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })
                )}
              </tbody>
            </table>
          </div>
          </>
        )}
      </CardContent>

      <DocumentDetailModal
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetailDoc(null); }}
        document={detailDoc}
        initialEditMode={detailEditMode}
        onSaved={() => router.refresh()}
        children={children}
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <div className="bg-background border border-border rounded-card shadow-card max-w-sm w-full mx-4 p-4">
            <h3 id="delete-title" className="font-heading text-base font-semibold text-foreground mb-2">Delete document{deleteConfirm.ids.length > 1 ? "s" : ""}?</h3>
            <p className="text-sm text-foreground-secondary mb-4">
              Documents will be moved to trash. {deleteConfirm.ids.length > 1 ? "Selected documents will be removed from the list." : "This document will be removed from the list."}
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button size="sm" className="rounded-full bg-alert hover:bg-alert/90" onClick={() => confirmDelete()}>Delete</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
