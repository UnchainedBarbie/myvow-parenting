"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ColumnFilterPopover } from "@/components/documents/column-filter-popover";
import { DateFilterPopover, type DateFilterValue } from "@/components/documents/date-filter-popover";
import { getCategoryColor } from "@/lib/categoryColors";
import { Download, Trash2, Check, XCircle, Receipt, Filter } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  medical: "Medical",
  dental: "Dental",
  therapy: "Therapy",
  school: "School",
  extracurricular: "Extracurricular",
  clothing: "Clothing",
  childcare: "Childcare",
  transportation: "Transportation",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  submitted: "Pending",
  approved: "Approved",
  disputed: "Disputed",
  resolved: "Paid",
};

const STATUS_FILTER_OPTIONS = [
  { value: "submitted", label: "Pending" },
  { value: "disputed", label: "Disputed" },
  { value: "approved", label: "Approved" },
  { value: "resolved", label: "Paid" },
] as const;

export type ExpenseRow = {
  id: string;
  description: string;
  amount: string;
  category: string;
  child_id: string | null;
  child_name: string | null;
  amount_owed: string | null;
  status: string;
  created_at: string;
  submitted_by: string;
  receipt_file_id: string | null;
  receipt_file_name: string | null;
};

interface ExpenseListProps {
  expenses: ExpenseRow[];
  currentUserId: string;
  custodySplitPercent: number;
  children: { id: string; first_name: string; profile_image?: string | null }[];
}

function formatDate(createdAt: string) {
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function expenseIdFromIndex(idx: number) {
  return `EXP-${String(idx + 1).padStart(3, "0")}`;
}

function csvEscape(value: string): string {
  const s = String(value ?? "").replace(/"/g, '""');
  return /[",\\r\\n]/.test(s) ? `"${s}"` : s;
}

export function ExpenseList({
  expenses,
  currentUserId,
  custodySplitPercent,
  children,
}: ExpenseListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState("");
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterChildren, setFilterChildren] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>(() => {
    const status = searchParams.get("status")?.toLowerCase();
    if (status === "pending") return ["submitted"];
    if (status === "disputed") return ["disputed"];
    return [];
  });
  useEffect(() => {
    if (!searchParams.get("status")) return;
    const u = new URL(window.location.href);
    u.searchParams.delete("status");
    router.replace(u.pathname + (u.search || ""), { scroll: false });
  }, [searchParams, router]);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  const [childFilterOpen, setChildFilterOpen] = useState(false);
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const debouncedSearch = searchInput.trim().toLowerCase();

  const dateFilterActive = !!startDate || !!endDate;
  const categoryFilterActive = filterCategories.length > 0;
  const childFilterActive = filterChildren.length > 0;
  const statusFilterActive = filterStatuses.length > 0;

  const anyFilterActive =
    debouncedSearch.length > 0 ||
    categoryFilterActive ||
    childFilterActive ||
    statusFilterActive ||
    dateFilterActive;

  const { filtered, totals } = useMemo(() => {
    const parts = debouncedSearch.split(/\s+/).filter(Boolean);

    let totalOwedToYou = 0;
    let totalYouOwe = 0;

    const result = expenses.filter((exp) => {
      const text = [
        exp.description ?? "",
        exp.category ?? "",
        exp.child_name ?? "",
        exp.receipt_file_name ?? "",
      ]
        .join(" ")
        .toLowerCase();

      if (parts.length && !parts.every((p) => text.includes(p))) return false;

      if (filterCategories.length && !filterCategories.includes(exp.category)) return false;
      if (filterChildren.length) {
        if (!exp.child_id || !filterChildren.includes(exp.child_id)) return false;
      }
      if (filterStatuses.length && !filterStatuses.includes(exp.status)) return false;

      if (startDate || endDate) {
        const d = new Date(exp.created_at);
        if (startDate) {
          const s = new Date(startDate);
          if (d < s) return false;
        }
        if (endDate) {
          const e = new Date(endDate);
          e.setHours(23, 59, 59, 999);
          if (d > e) return false;
        }
      }

      const amountNum = Number(exp.amount);
      const owedNum = exp.amount_owed != null ? Number(exp.amount_owed) : null;
      if (!Number.isNaN(amountNum) && owedNum != null && !Number.isNaN(owedNum)) {
        if (exp.submitted_by === currentUserId) {
          totalOwedToYou += owedNum;
        } else {
          totalYouOwe += owedNum;
        }
      }

      return true;
    });

    const net = totalOwedToYou - totalYouOwe;

    return {
      filtered: result,
      totals: {
        totalOwedToYou,
        totalYouOwe,
        net,
      },
    };
  }, [debouncedSearch, expenses, filterCategories, filterChildren, filterStatuses, startDate, endDate, currentUserId]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const allSelected = filtered.length > 0 && filtered.every((e) => prev.has(e.id));
      if (allSelected) return new Set();
      const next = new Set<string>();
      filtered.forEach((e) => next.add(e.id));
      return next;
    });
  }

  async function handleExportCSV() {
    if (filtered.length === 0) return;
    const headers = [
      "Expense ID",
      "Description",
      "Category",
      "Child",
      "Date",
      "Total",
      "Split",
      "Their share",
      "Status",
    ];
    const rows = filtered.map((exp, idx) => {
      const id = expenseIdFromIndex(idx);
      const amountNum = Number(exp.amount);
      const splitOther = custodySplitPercent;
      const splitYou = 100 - splitOther;
      const splitLabel = `${splitYou}/${splitOther}`;
      const owedNum = exp.amount_owed != null ? Number(exp.amount_owed) : null;
      const isMine = exp.submitted_by === currentUserId;
      const theirShare =
        owedNum != null
          ? isMine
            ? owedNum
            : amountNum - owedNum
          : null;
      const statusLabel = STATUS_LABELS[exp.status] ?? exp.status;
      return [
        id,
        exp.description ?? "",
        CATEGORY_LABELS[exp.category] ?? exp.category,
        exp.child_name ?? "—",
        formatDate(exp.created_at),
        Number.isNaN(amountNum) ? "" : amountNum.toFixed(2),
        splitLabel,
        theirShare != null ? theirShare.toFixed(2) : "",
        statusLabel,
      ]
        .map(csvEscape)
        .join(",");
    });
    const csv = [headers.map(csvEscape).join(","), ...rows].join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MyVow_Expenses_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearAllFilters() {
    setSearchInput("");
    setFilterCategories([]);
    setFilterChildren([]);
    setFilterStatuses([]);
    setStartDate("");
    setEndDate("");
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    if (!window.confirm("Delete selected expenses?")) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/expenses/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert((data as { error?: string }).error ?? "Failed to delete expenses");
        return;
      }
      setSelectedIds(new Set());
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  async function handleRespond(expenseId: string, action: "approve" | "dispute") {
    setRespondingId(expenseId);
    try {
      let dispute_reason: string | undefined;
      if (action === "dispute") {
        const input = window.prompt("Optional reason for dispute (leave blank to skip)") ?? "";
        dispute_reason = input.trim() || undefined;
      }
      const body: { expense_id: string; action: string; dispute_reason?: string } = {
        expense_id: expenseId,
        action,
      };
      if (dispute_reason) body.dispute_reason = dispute_reason;
      const res = await fetch("/api/expenses/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert((data as { message?: string }).message ?? "Request failed");
        return;
      }
      router.refresh();
    } finally {
      setRespondingId(null);
    }
  }

  const canRespond = (exp: ExpenseRow) =>
    exp.submitted_by !== currentUserId && exp.status === "submitted";

  const netLabel =
    totals.net > 0.01
      ? `You are owed $${totals.net.toFixed(2)}`
      : totals.net < -0.01
        ? `You owe $${Math.abs(totals.net).toFixed(2)}`
        : "You are all settled";

  function applyDateFilter(value: DateFilterValue) {
    setStartDate(value.startDate ?? "");
    setEndDate(value.endDate ?? "");
  }

  function clearDateFilter() {
    setStartDate("");
    setEndDate("");
  }

  const dateFilterValue: DateFilterValue = {
    startDate: startDate || null,
    endDate: endDate || null,
  };

  const categoryFilterOptions = [
    { value: "medical", label: "Medical" },
    { value: "dental", label: "Dental" },
    { value: "therapy", label: "Therapy" },
    { value: "school", label: "School" },
    { value: "extracurricular", label: "Extracurricular" },
    { value: "clothing", label: "Clothing" },
    { value: "childcare", label: "Childcare" },
    { value: "transportation", label: "Transportation" },
    { value: "other", label: "Other" },
  ] as const;

  const childFilterOptions = children.map((c) => ({
    value: c.id,
    label: c.first_name,
  }));

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader className="pb-2 px-4 pt-4">
        <CardTitle className="font-heading text-lg text-foreground">All expenses</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {expenses.length > 0 && (
          <>
            <button
              type="button"
              className="w-full text-left rounded-card border border-border bg-background-secondary/60 px-3 py-2 flex items-center justify-between gap-2 hover:bg-background-secondary"
              onClick={() => setSummaryOpen(true)}
            >
              <div>
                <p className="text-[11px] text-foreground-secondary mb-0.5">Net balance</p>
                <p className="text-sm font-medium text-foreground">{netLabel}</p>
              </div>
              <span className="text-[11px] text-primary underline">View details</span>
            </button>
            {summaryOpen && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                role="dialog"
                aria-modal="true"
                onClick={(e) => {
                  if (e.target === e.currentTarget) setSummaryOpen(false);
                }}
              >
                <div
                  className="bg-background border border-border rounded-card shadow-card max-w-sm w-full p-4 space-y-3"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-heading text-base font-semibold text-foreground">
                      Expense balance details
                    </h3>
                    <button
                      type="button"
                      className="text-xs text-foreground-secondary hover:text-foreground underline"
                      onClick={() => setSummaryOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="flex justify-between">
                      <span>They owe you</span>
                      <span className="font-medium">${totals.totalOwedToYou.toFixed(2)}</span>
                    </p>
                    <p className="flex justify-between">
                      <span>You owe them</span>
                      <span className="font-medium">${totals.totalYouOwe.toFixed(2)}</span>
                    </p>
                    <p className="flex justify-between border-t border-border pt-2 mt-1 text-[13px]">
                      <span className="text-foreground-secondary">Net</span>
                      <span className="font-medium">{netLabel}</span>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            placeholder="Search description, merchant, receipt filename…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-full max-w-[280px] rounded-card border-border text-sm"
            aria-label="Search expenses"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 rounded-full text-xs shrink-0"
            onClick={handleExportCSV}
            disabled={filtered.length === 0}
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
              variant="ghost"
              className="rounded-full h-8 text-xs text-red-600/90 hover:text-red-700 hover:bg-red-50"
              onClick={handleDeleteSelected}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        )}

        {expenses.length === 0 ? (
          <div className="py-12 text-center rounded-card border border-dashed border-border bg-background-secondary/30">
            <p className="text-sm text-foreground-secondary mb-1">No expenses yet.</p>
            <p className="text-xs text-foreground-secondary">Add your first expense using the form on the left.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center rounded-card border border-dashed border-border bg-background-secondary/30">
            <p className="text-sm text-foreground-secondary mb-1">No expenses match your filters.</p>
            <p className="text-xs text-foreground-secondary">Adjust filters or clear them to see all expenses.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-background">
            <table className="min-w-full table-fixed text-left text-xs md:text-sm">
              <colgroup>
                <col style={{ width: 40 }} />
                <col style={{ width: 76 }} />
                <col style={{ width: "32%" }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 80 }} />
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
                  <th className="px-3 py-2 font-medium">Expense ID</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Description</span>
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Category</span>
                      <ColumnFilterPopover
                        title="Category"
                        options={categoryFilterOptions}
                        selected={filterCategories}
                        onApply={setFilterCategories}
                        onClear={() => setFilterCategories([])}
                        open={categoryFilterOpen}
                        onOpenChange={setCategoryFilterOpen}
                        active={categoryFilterActive}
                        icon={Filter}
                        getOptionDotClass={(value) => getCategoryColor(value).dotClass}
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Child</span>
                      <ColumnFilterPopover
                        title="Child"
                        options={childFilterOptions}
                        selected={filterChildren}
                        onApply={setFilterChildren}
                        onClear={() => setFilterChildren([])}
                        open={childFilterOpen}
                        onOpenChange={setChildFilterOpen}
                        active={childFilterActive}
                        icon={Filter}
                      />
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <span>Date</span>
                      <span data-date-filter-trigger className="shrink-0">
                        <DateFilterPopover
                          open={dateFilterOpen}
                          onOpenChange={setDateFilterOpen}
                          startDate={dateFilterValue.startDate}
                          endDate={dateFilterValue.endDate}
                          onApply={applyDateFilter}
                          onClear={clearDateFilter}
                          active={dateFilterActive}
                        />
                      </span>
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Split</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Their share</span>
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Status</span>
                      <ColumnFilterPopover
                        title="Co-Parent Status"
                        options={STATUS_FILTER_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
                        selected={filterStatuses}
                        onApply={setFilterStatuses}
                        onClear={() => setFilterStatuses([])}
                        open={statusFilterOpen}
                        onOpenChange={setStatusFilterOpen}
                        active={statusFilterActive}
                        icon={Filter}
                      />
                    </span>
                  </th>
                  <th className="w-[72px] px-2 py-2 font-medium" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((exp, idx) => {
                  const amountNum = Number(exp.amount);
                  const owedNum = exp.amount_owed != null ? Number(exp.amount_owed) : null;
                  const isMine = exp.submitted_by === currentUserId;
                  const splitOther = custodySplitPercent;
                  const splitYou = 100 - splitOther;
                  const splitLabel = `${splitYou}/${splitOther}`;
                  const theirShare =
                    owedNum != null
                      ? isMine
                        ? owedNum
                        : amountNum - owedNum
                      : null;
                  const catColors = getCategoryColor(exp.category);
                  const statusLabel = STATUS_LABELS[exp.status] ?? exp.status;
                  const statusClasses =
                    exp.status === "submitted"
                      ? "bg-muted text-foreground-secondary"
                      : exp.status === "disputed"
                        ? "bg-alert/10 text-alert"
                        : exp.status === "approved"
                          ? "bg-success/15 text-success"
                          : exp.status === "resolved"
                            ? "bg-emerald-600/15 text-emerald-700"
                            : "bg-muted text-foreground-secondary";
                  return (
                    <tr
                      key={exp.id}
                      className={cn(
                        "border-t border-border border-l-4",
                        catColors.stripeClass,
                        idx % 2 === 0 ? "bg-background" : "bg-[#FAF8F5]",
                        "hover:bg-background-secondary/50"
                      )}
                    >
                      <td className="px-3 py-1.5 w-10 align-middle" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(exp.id)}
                          onChange={() => toggleSelect(exp.id)}
                          aria-label={`Select expense ${expenseIdFromIndex(idx)}`}
                          className="rounded border-border"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-xs align-middle">
                        {expenseIdFromIndex(idx)}
                      </td>
                      <td className="px-3 py-1.5 align-middle min-w-0">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span
                            className="font-semibold text-foreground overflow-hidden text-ellipsis whitespace-nowrap block"
                            title={exp.description}
                          >
                            {exp.description || "—"}
                          </span>
                          <span className="text-[11px] text-foreground-secondary overflow-hidden text-ellipsis whitespace-nowrap block">
                            {(CATEGORY_LABELS[exp.category] ?? exp.category) || ""} 
                            {exp.receipt_file_name && ` • ${exp.receipt_file_name}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", catColors.dotClass)}
                            aria-hidden
                          />
                          <span className="text-xs text-foreground-secondary">
                            {CATEGORY_LABELS[exp.category] ?? exp.category}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-foreground-secondary align-middle">
                        {exp.child_id && exp.child_name ? (
                          <div className="flex items-center gap-2">
                            {(() => {
                              const child = children.find((c) => c.id === exp.child_id);
                              if (child?.profile_image) {
                                return (
                                  <img
                                    src={child.profile_image}
                                    alt={child.first_name}
                                    className="h-6 w-6 rounded-full object-cover border border-border/60 bg-emerald-50"
                                  />
                                );
                              }
                              return (
                                <div className="h-6 w-6 rounded-full bg-emerald-50 text-emerald-800 flex items-center justify-center text-[10px] font-medium">
                                  {exp.child_name?.charAt(0).toUpperCase() ?? ""}
                                </div>
                              );
                            })()}
                            <span>{exp.child_name}</span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-foreground-secondary whitespace-nowrap align-middle">
                        {formatDate(exp.created_at)}
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        {Number.isNaN(amountNum) ? "—" : `$${amountNum.toFixed(2)}`}
                      </td>
                      <td className="px-3 py-1.5 align-middle text-foreground-secondary">
                        {splitLabel}
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        {theirShare != null && !Number.isNaN(theirShare) ? `$${theirShare.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-3 py-1.5 align-middle">
                        <span
                          className={cn(
                            "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                            statusClasses
                          )}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 align-middle" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center gap-0.5">
                          {exp.receipt_file_id && (
                            <button
                              type="button"
                              className="p-1.5 rounded text-foreground-secondary hover:text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label="View receipt"
                              onClick={async () => {
                                const res = await fetch(`/api/documents/${exp.receipt_file_id}/download`);
                                const data = await res.json().catch(() => ({}));
                                if ((data as { url?: string }).url) {
                                  window.open((data as { url: string }).url, "_blank");
                                }
                              }}
                            >
                              <Receipt className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canRespond(exp) && (
                            <>
                              <button
                                type="button"
                                className="p-1.5 rounded text-emerald-600 hover:text-emerald-700 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label="Approve expense"
                                disabled={respondingId === exp.id}
                                onClick={() => handleRespond(exp.id, "approve")}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="p-1.5 rounded text-alert hover:text-alert hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label="Dispute expense"
                                disabled={respondingId === exp.id}
                                onClick={() => handleRespond(exp.id, "dispute")}
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          {!canRespond(exp) && (
                            <button
                              type="button"
                              className="p-1.5 rounded text-foreground-secondary hover:text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label="Delete expense"
                              onClick={async () => {
                                if (!window.confirm("Delete this expense?")) return;
                                setDeleting(true);
                                try {
                                  const res = await fetch("/api/expenses/delete", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ ids: [exp.id] }),
                                  });
                                  if (!res.ok) {
                                    const data = await res.json().catch(() => ({}));
                                    window.alert((data as { error?: string }).error ?? "Failed to delete expense");
                                    return;
                                  }
                                  router.refresh();
                                } finally {
                                  setDeleting(false);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
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
    </Card>
  );
}
