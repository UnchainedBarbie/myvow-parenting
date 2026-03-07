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
import { Download, Trash2, Check, XCircle, Filter, Paperclip, Pencil, Lock } from "lucide-react";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Label } from "@/components/ui/label";

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
  disputed: "Disputed",
  resolved: "Resolved",
  paid: "Paid",
};

const STATUS_FILTER_OPTIONS = [
  { value: "submitted", label: "Pending" },
  { value: "disputed", label: "Disputed" },
  { value: "resolved", label: "Resolved" },
  { value: "paid", label: "Paid" },
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
  dispute_reason?: string | null;
  paid_at?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  payment_notes?: string | null;
  allocation_status?: "ALLOCATED" | "NONE" | "MANUAL_REQUIRED" | "pending" | null;
  split_label?: string | null;
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
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null);
  const [deleteSingleId, setDeleteSingleId] = useState<string | null>(null);
  const [disputeExpense, setDisputeExpense] = useState<ExpenseRow | null>(null);
  const [disputeText, setDisputeText] = useState("");
  const [markPaidExpense, setMarkPaidExpense] = useState<ExpenseRow | null>(null);
  const [markPaidDate, setMarkPaidDate] = useState<string>("");
  const [markPaidMethod, setMarkPaidMethod] = useState<string>("");
  const [markPaidRef, setMarkPaidRef] = useState<string>("");
  const [markPaidNotes, setMarkPaidNotes] = useState<string>("");
  const [exportingSelected, setExportingSelected] = useState(false);
  const [editExpense, setEditExpense] = useState<ExpenseRow | null>(null);
  const [editForm, setEditForm] = useState({
    description: "",
    amount: "",
    category: "other",
    child_id: "",
    status: "submitted",
    dispute_reason: "",
    paid_at: "",
    payment_method: "",
    payment_reference: "",
    payment_notes: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  function openEditModal(exp: ExpenseRow) {
    setEditExpense(exp);
    setEditForm({
      description: exp.description ?? "",
      amount: exp.amount ?? "",
      category: exp.category ?? "other",
      child_id: exp.child_id ?? "",
      status: exp.status ?? "submitted",
      dispute_reason: exp.dispute_reason ?? "",
      paid_at: (exp as { paid_at?: string | null }).paid_at
        ? new Date((exp as { paid_at: string }).paid_at).toISOString().slice(0, 10)
        : "",
      payment_method: (exp as { payment_method?: string | null }).payment_method ?? "",
      payment_reference: (exp as { payment_reference?: string | null }).payment_reference ?? "",
      payment_notes: (exp as { payment_notes?: string | null }).payment_notes ?? "",
    });
  }

  function closeEditModal() {
    setEditExpense(null);
    setSavingEdit(false);
  }

  async function handleSaveEdit() {
    if (!editExpense) return;
    const amountNum = parseFloat(editForm.amount);
    if (Number.isNaN(amountNum) && editForm.amount.trim() !== "") {
      showErrorToast("Enter a valid amount.");
      return;
    }
    if (
      editExpense.submitted_by !== currentUserId &&
      editForm.status === "disputed" &&
      !editForm.dispute_reason.trim()
    ) {
      showErrorToast("Please add a dispute reason.");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/expenses/${editExpense.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: editForm.description.trim() || undefined,
          amount: editForm.amount.trim() ? amountNum : undefined,
          category: editForm.category || undefined,
          child_id: editForm.child_id || null,
          status: editForm.status || undefined,
          dispute_reason: editForm.dispute_reason.trim() || null,
          paid_at: editForm.paid_at || null,
          payment_method: editForm.payment_method.trim() || null,
          payment_reference: editForm.payment_reference.trim() || null,
          payment_notes: editForm.payment_notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast((data as { message?: string }).message ?? "Failed to update expense.");
        return;
      }
      showSuccessToast("Expense updated");
      closeEditModal();
      router.refresh();
    } finally {
      setSavingEdit(false);
    }
  }

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
      // Exclude fully paid expenses from net balance.
      if (
        exp.status !== "paid" &&
        !Number.isNaN(amountNum) &&
        owedNum != null &&
        !Number.isNaN(owedNum)
      ) {
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
      const owedNum = exp.amount_owed != null ? Number(exp.amount_owed) : null;
      const isMine = exp.submitted_by === currentUserId;
      const theirShare =
        owedNum != null ? (isMine ? owedNum : amountNum - owedNum) : null;
      const statusLabel = STATUS_LABELS[exp.status] ?? exp.status;
      return [
        id,
        exp.description ?? "",
        CATEGORY_LABELS[exp.category] ?? exp.category,
        exp.child_name ?? "—",
        formatDate(exp.created_at),
        Number.isNaN(amountNum) ? "" : amountNum.toFixed(2),
        exp.split_label ?? "",
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

  async function handleExportSelectedCSV() {
    const selected = filtered.filter((exp) => selectedIds.has(exp.id));
    if (selected.length === 0) return;
    setExportingSelected(true);
    try {
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
        "Payment Method",
        "Payment Date",
        "Payment Reference",
      ];
      const rows = selected.map((exp) => {
        const idx = filtered.findIndex((e) => e.id === exp.id);
        const idLabel = expenseIdFromIndex(idx >= 0 ? idx : 0);
        const amountNum = Number(exp.amount);
        const owedNum = exp.amount_owed != null ? Number(exp.amount_owed) : null;
        const isMine = exp.submitted_by === currentUserId;
        const theirShare =
          owedNum != null ? (isMine ? owedNum : amountNum - owedNum) : null;
        const statusLabel = STATUS_LABELS[exp.status] ?? exp.status;
        const paymentMethod = (exp as any).payment_method ?? "";
        const paidAt = (exp as any).paid_at
          ? formatDate((exp as any).paid_at as string)
          : "";
        const paymentRef = (exp as any).payment_reference ?? "";
        const splitLabel = (exp as any).split_label ?? "";
        return [
          idLabel,
          exp.description ?? "",
          CATEGORY_LABELS[exp.category] ?? exp.category,
          exp.child_name ?? "—",
          formatDate(exp.created_at),
          Number.isNaN(amountNum) ? "" : amountNum.toFixed(2),
          splitLabel,
          theirShare != null ? theirShare.toFixed(2) : "",
          statusLabel,
          paymentMethod,
          paidAt,
          paymentRef,
        ]
          .map(csvEscape)
          .join(",");
      });
      const csv = [headers.map(csvEscape).join(","), ...rows].join("\r\n");
      const blob = new Blob(["\uFEFF" + csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MyVow-Expenses-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingSelected(false);
    }
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
    setDeleteConfirmIds(Array.from(selectedIds));
  }

  async function handleDownloadSelectedReceipts() {
    const selected = filtered.filter(
      (exp) => selectedIds.has(exp.id) && exp.receipt_file_id
    );
    if (selected.length === 0) {
      showErrorToast("No receipts attached to selected expenses");
      return;
    }
    const ids = [
      ...new Set(
        selected
          .map((exp) => exp.receipt_file_id)
          .filter((id): id is string => !!id)
      ),
    ];
    if (ids.length === 1) {
      const res = await fetch(`/api/documents/${ids[0]}/download`);
      const data = await res.json().catch(() => ({}));
      const url = (data as { url?: string }).url;
      if (url) {
        window.open(url, "_blank");
      } else {
        showErrorToast("Download failed");
      }
      return;
    }
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
        showErrorToast(message);
        return;
      }
      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        showErrorToast(
          "Download failed: no receipts could be included in the ZIP."
        );
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MyVow-Receipts-${new Date()
        .toISOString()
        .slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showErrorToast("Download failed. Check the console for details.");
    }
  }

  async function performDelete(ids: string[]) {
    setDeleting(true);
    try {
      const res = await fetch("/api/expenses/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showErrorToast(
          (data as { error?: string }).error ?? "Failed to delete expenses"
        );
        return;
      }
      setSelectedIds(new Set());
      router.refresh();
      showSuccessToast("Expenses deleted");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRespond(
    expenseId: string,
    action: "approve" | "dispute" | "resolve" | "mark_paid",
    opts?: {
      dispute_reason?: string;
      paid_at?: string;
      payment_method?: string;
      payment_reference?: string;
      payment_notes?: string;
    }
  ) {
    setRespondingId(expenseId);
    try {
      const body: {
        expense_id: string;
        action: string;
        dispute_reason?: string;
        paid_at?: string;
        payment_method?: string;
        payment_reference?: string;
        payment_notes?: string;
      } = {
        expense_id: expenseId,
        action,
      };
      if (opts?.dispute_reason) body.dispute_reason = opts.dispute_reason;
      if (opts?.paid_at) body.paid_at = opts.paid_at;
      if (opts?.payment_method) body.payment_method = opts.payment_method;
      if (opts?.payment_reference) body.payment_reference = opts.payment_reference;
      if (opts?.payment_notes) body.payment_notes = opts.payment_notes;
      const res = await fetch("/api/expenses/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast(
          (data as { message?: string }).message ?? "Request failed"
        );
        return;
      }
      router.refresh();
      if (action === "approve") {
        showSuccessToast("Expense approved");
      } else if (action === "dispute") {
        showSuccessToast("Dispute submitted");
      } else if (action === "resolve") {
        showSuccessToast("Expense resolved");
      } else if (action === "mark_paid") {
        showSuccessToast("Marked as paid");
      }
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
  startDate: startDate || "",
  endDate: endDate || "",
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
    <>
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
            <span className="text-xs text-foreground-secondary">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              className="text-xs text-[#5B7A52] hover:underline"
              onClick={() => void handleDownloadSelectedReceipts()}
              disabled={deleting}
            >
              Download Receipts
            </button>
            <button
              type="button"
              className="text-xs text-[#5B7A52] hover:underline"
              onClick={() => void handleExportSelectedCSV()}
              disabled={exportingSelected}
            >
              {exportingSelected ? "Exporting…" : "Export"}
            </button>
            <button
              type="button"
              className="text-xs text-red-600/90 hover:text-red-700 hover:underline"
              onClick={handleDeleteSelected}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
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
                  <th className="px-3 py-2 font-medium whitespace-nowrap min-w-[90px]">
                    Expense ID
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      <span>Description</span>
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <span>Category</span>
                      <ColumnFilterPopover
                        title="Category"
                        options={[...categoryFilterOptions]}
                        selected={filterCategories}
                        onApply={setFilterCategories}
                        onClear={() => setFilterCategories([])}
                        open={categoryFilterOpen}
                        onOpenChange={setCategoryFilterOpen}
                        active={categoryFilterActive}
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
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Total</th>
                  <th className="px-2 py-2 font-medium whitespace-nowrap">Split</th>
                  <th className="px-2 py-2 font-medium whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <span>Their share</span>
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">
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
                  const theirShare =
                    owedNum != null ? (isMine ? owedNum : amountNum - owedNum) : null;
                  const catColors = getCategoryColor(exp.category);
                  const statusLabel = STATUS_LABELS[exp.status] ?? exp.status;
                  const statusClasses =
                    exp.status === "submitted"
                      ? "bg-muted text-foreground-secondary"
                      : exp.status === "disputed"
                        ? "bg-[#FDF6E3] text-[#D4A843]"
                        : exp.status === "resolved"
                          ? "bg-[#F2F5EF] text-[#5B7A52]"
                          : exp.status === "paid"
                            ? "bg-[#E0EDDA] text-[#3D6B35]"
                            : "bg-muted text-foreground-secondary";
                  const handleRowActivate = () => {
                    openEditModal(exp);
                  };

                  return (
                    <tr
                      key={exp.id}
                      className={cn(
                        "border-t border-border border-l-4",
                        catColors.stripeClass,
                        idx % 2 === 0 ? "bg-background" : "bg-[#FAF8F5]",
                        "hover:bg-background-secondary/50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      )}
                      role="button"
                      tabIndex={0}
                      onClick={handleRowActivate}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleRowActivate();
                        }
                      }}
                      aria-label={`Open expense details: ${exp.description || "Expense"}, total ${
                        Number.isNaN(amountNum) ? "—" : `$${amountNum.toFixed(2)}`
                      }`}
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
                      <td className="px-3 py-1.5 text-xs align-middle whitespace-nowrap">
                        {expenseIdFromIndex(idx)}
                      </td>
                      <td className="px-3 py-1.5 align-middle min-w-0">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-1 min-w-0">
                            <span
                              className="font-semibold text-foreground truncate max-w-[400px] block"
                              title={exp.description}
                            >
                              {exp.description || "—"}
                            </span>
                          </div>
                          <span className="text-[11px] text-foreground-secondary overflow-hidden text-ellipsis whitespace-nowrap block">
                            {(CATEGORY_LABELS[exp.category] ?? exp.category) || ""} 
                            {exp.receipt_file_name && ` • ${exp.receipt_file_name}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 align-middle whitespace-nowrap">
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
                      <td className="px-3 py-1.5 align-middle whitespace-nowrap">
                        {Number.isNaN(amountNum) ? "—" : `$${amountNum.toFixed(2)}`}
                      </td>
                      <td className="px-2 py-1.5 align-middle text-foreground-secondary whitespace-nowrap">
                        {exp.allocation_status === "NONE"
                          ? "—"
                          : exp.split_label || ""}
                      </td>
                      <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                        {exp.allocation_status === "NONE"
                          ? "$0.00"
                          : theirShare != null && !Number.isNaN(theirShare)
                          ? `$${theirShare.toFixed(2)}`
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5 align-middle whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                              statusClasses
                            )}
                          >
                            {exp.allocation_status === "NONE"
                              ? "No allocation"
                              : statusLabel}
                          </span>
                          {exp.submitted_by !== currentUserId ? (
                            <div className="flex flex-wrap gap-1 text-[11px]">
                              {exp.status === "submitted" && (
                                <>
                                  <button
                                    type="button"
                                    className="inline-flex items-center rounded-full border border-[#7C8B6E] px-2 py-0.5 text-[11px] text-[#5B7A52] hover:bg-[#F2F5EF]"
                                    disabled={respondingId === exp.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleRespond(exp.id, "approve");
                                    }}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="inline-flex items-center rounded-full border border-[#D4A843] px-2 py-0.5 text-[11px] text-[#B8960F] hover:bg-[#FDF6E3]"
                                    disabled={respondingId === exp.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDisputeExpense(exp);
                                      setDisputeText(exp.dispute_reason ?? "");
                                    }}
                                  >
                                    Dispute
                                  </button>
                                </>
                              )}
                              {exp.status === "disputed" && (
                                <button
                                  type="button"
                                  className="inline-flex items-center rounded-full border border-[#7C8B6E] px-2 py-0.5 text-[11px] text-[#5B7A52] hover:bg-[#F2F5EF]"
                                  disabled={respondingId === exp.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleRespond(exp.id, "resolve");
                                  }}
                                >
                                  Resolve
                                </button>
                              )}
                              {exp.status === "resolved" && (
                                <button
                                  type="button"
                                  className="inline-flex items-center rounded-full bg-[#5B7A52] px-2 py-0.5 text-[11px] text-white hover:bg-[#476242]"
                                  disabled={respondingId === exp.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const today = new Date().toISOString().slice(0, 10);
                                    setMarkPaidExpense(exp);
                                    setMarkPaidDate(today);
                                    const theirShareNum =
                                      theirShare != null && !Number.isNaN(theirShare)
                                        ? theirShare
                                        : 0;
                                    setMarkPaidMethod("");
                                    setMarkPaidRef("");
                                    setMarkPaidNotes("");
                                  }}
                                >
                                  Mark Paid
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1 text-[11px] text-foreground-secondary">
                              {exp.status === "submitted" && (
                                <span>Awaiting response</span>
                              )}
                              {exp.status === "disputed" && (
                                <>
                                  {exp.dispute_reason && (
                                    <span className="max-w-xs">
                                      {exp.dispute_reason}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    className="mt-0.5 inline-flex items-center rounded-full border border-[#7C8B6E] px-2 py-0.5 text-[11px] text-[#5B7A52] hover:bg-[#F2F5EF]"
                                  disabled={respondingId === exp.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleRespond(exp.id, "resolve");
                                  }}
                                  >
                                    Resolve
                                  </button>
                                </>
                              )}
                              {exp.status === "resolved" && (
                                <span className="text-[#5B7A52]">Resolved</span>
                              )}
                              {exp.status === "paid" && (
                                <span className="text-[#3D6B35]">Paid</span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 align-middle" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center gap-0.5">
                          {exp.receipt_file_id && (
                            <button
                              type="button"
                              className="p-1.5 rounded text-foreground-secondary hover:text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label="Download receipt"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const res = await fetch(
                                  `/api/documents/${exp.receipt_file_id}/download`
                                );
                                const data = await res.json().catch(() => ({}));
                                if ((data as { url?: string }).url) {
                                  window.open((data as { url: string }).url, "_blank");
                                } else {
                                  showErrorToast("Download failed");
                                }
                              }}
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          )}
                          <button
                            type="button"
                            className="p-1.5 rounded text-[#8A8A8A] hover:text-[#5B7A52] hover:bg-[#E8EDE3]/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label="Edit expense"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(exp);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {!canRespond(exp) && (
                            <button
                              type="button"
                              className="p-1.5 rounded text-foreground-secondary hover:text-foreground hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              aria-label="Delete expense"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteSingleId(exp.id);
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

    <ConfirmModal
      open={deleteConfirmIds !== null}
      title="Delete expenses?"
      description="This cannot be undone."
      confirmLabel="Delete"
      confirmTone="danger"
      onCancel={() => setDeleteConfirmIds(null)}
      onConfirm={() => {
        const ids = deleteConfirmIds;
        if (!ids || ids.length === 0) return;
        void performDelete(ids).finally(() => setDeleteConfirmIds(null));
      }}
    />

    <ConfirmModal
      open={deleteSingleId !== null}
      title="Delete expense?"
      description="This cannot be undone."
      confirmLabel="Delete"
      confirmTone="danger"
      onCancel={() => setDeleteSingleId(null)}
      onConfirm={() => {
        const id = deleteSingleId;
        if (!id) return;
        void performDelete([id]).finally(() => setDeleteSingleId(null));
      }}
    />

    {disputeExpense && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setDisputeExpense(null);
            setDisputeText("");
          }
        }}
      >
        <div className="w-full max-w-[420px] rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card">
          <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
            Dispute Expense
          </h2>
          <p className="mt-1 text-[11px] text-[#8A8A8A]">
            {disputeExpense.description || "Expense"} · $
            {Number(disputeExpense.amount).toFixed(2)}
          </p>
          <textarea
            value={disputeText}
            onChange={(e) => setDisputeText(e.target.value)}
            className="mt-3 w-full min-h-[96px] rounded-lg border border-[#E8E4DC] bg-white px-3 py-2 text-sm text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
            placeholder="What's the issue with this expense?"
          />
          <p className="mt-1 text-[11px] text-[#8A8A8A]">
            Optional — leave blank to dispute without a reason.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full text-xs"
              onClick={() => {
                setDisputeExpense(null);
                setDisputeText("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-full bg-[#D4A843] text-xs text-white hover:bg-[#C39A35]"
              onClick={() => {
                if (!disputeExpense) return;
                void handleRespond(disputeExpense.id, "dispute", disputeText.trim() || undefined);
                setDisputeExpense(null);
                setDisputeText("");
              }}
            >
              Submit Dispute
            </Button>
          </div>
        </div>
      </div>
    )}

    {markPaidExpense && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setMarkPaidExpense(null);
          }
        }}
      >
        <div className="w-full max-w-[420px] rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card">
          <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
            Mark expense as paid
          </h2>
          <p className="mt-1 text-[11px] text-[#8A8A8A]">
            {markPaidExpense.description || "Expense"} · $
            {Number(markPaidExpense.amount).toFixed(2)}
          </p>

          <div className="mt-3 space-y-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#3D3D3D]">
                Date paid
              </label>
              <input
                type="date"
                value={markPaidDate}
                onChange={(e) => setMarkPaidDate(e.target.value)}
                className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[#3D3D3D]">
                Payment method
              </label>
              <select
                value={markPaidMethod}
                onChange={(e) => setMarkPaidMethod(e.target.value)}
                className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
              >
                <option value="">Select method</option>
                <option value="Venmo">Venmo</option>
                <option value="Zelle">Zelle</option>
                <option value="Cash">Cash</option>
                <option value="Check">Check</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[#3D3D3D]">
                Reference / confirmation number
              </label>
              <input
                type="text"
                value={markPaidRef}
                onChange={(e) => setMarkPaidRef(e.target.value)}
                placeholder="e.g., Venmo transaction ID"
                className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[#3D3D3D]">
                Notes
              </label>
              <textarea
                value={markPaidNotes}
                onChange={(e) => setMarkPaidNotes(e.target.value)}
                placeholder="Any additional details"
                className="w-full min-h-[72px] rounded-md border border-[#E8E4DC] bg-white px-2 py-1.5 text-xs text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full text-xs"
              onClick={() => setMarkPaidExpense(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
              onClick={() => {
                if (!markPaidExpense) return;
                const paidAtIso = markPaidDate
                  ? new Date(markPaidDate + "T00:00:00").toISOString()
                  : new Date().toISOString();
                void handleRespond(markPaidExpense.id, "mark_paid", {
                  paid_at: paidAtIso,
                  payment_method: markPaidMethod || undefined,
                  payment_reference: markPaidRef.trim() || undefined,
                  payment_notes: markPaidNotes.trim() || undefined,
                }).finally(() => {
                  setMarkPaidExpense(null);
                });
              }}
            >
              Mark Paid
            </Button>
          </div>
        </div>
      </div>
    )}

    {editExpense && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-expense-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeEditModal();
        }}
      >
        <div
          className="w-full max-w-lg rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-lg max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="edit-expense-title" className="font-heading text-lg font-semibold text-[#3D3D3D]">
            Edit Expense
          </h2>

          <div className="mt-4 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-[#3D3D3D] flex items-center gap-1">
                Description
                {editExpense.submitted_by !== currentUserId && (
                  <Lock className="h-3 w-3 text-foreground-secondary" aria-hidden />
                )}
              </Label>
              {editExpense.submitted_by === currentUserId ? (
                <div className="space-y-1">
                  <Input
                    value={editForm.description}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, description: e.target.value }))
                    }
                    maxLength={80}
                    className="h-8 text-sm border-[#E8E4DC]"
                  />
                  <div className="text-[10px] text-muted-foreground text-right">
                    {editForm.description.length}/80
                  </div>
                </div>
              ) : (
                <p className="text-sm text-foreground-secondary py-1.5">
                  {editExpense.description || "—"}
                </p>
              )}
            </div>

            {/* Core amount / category / child fields */}
            <div className="space-y-1">
              <Label className="text-xs font-medium text-[#3D3D3D] flex items-center gap-1">
                Amount
                {editExpense.submitted_by !== currentUserId && (
                  <Lock className="h-3 w-3 text-foreground-secondary" aria-hidden />
                )}
              </Label>
              {editExpense.submitted_by === currentUserId ? (
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.amount}
                  onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                  className="h-8 text-sm border-[#E8E4DC]"
                />
              ) : (
                <p className="text-sm text-foreground-secondary py-1.5">
                  ${Number(editExpense.amount).toFixed(2)}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-[#3D3D3D] flex items-center gap-1">
                Category
                {editExpense.submitted_by !== currentUserId && (
                  <Lock className="h-3 w-3 text-foreground-secondary" aria-hidden />
                )}
              </Label>
              {editExpense.submitted_by === currentUserId ? (
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                  className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                >
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-foreground-secondary py-1.5">
                  {CATEGORY_LABELS[editExpense.category] ?? editExpense.category}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-[#3D3D3D] flex items-center gap-1">
                Child
                {editExpense.submitted_by !== currentUserId && (
                  <Lock className="h-3 w-3 text-foreground-secondary" aria-hidden />
                )}
              </Label>
              {editExpense.submitted_by === currentUserId ? (
                <select
                  value={editForm.child_id}
                  onChange={(e) => setEditForm((f) => ({ ...f, child_id: e.target.value }))}
                  className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                >
                  <option value="">All children</option>
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>{c.first_name}</option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-foreground-secondary py-1.5">
                  {editExpense.child_name ?? "—"}
                </p>
              )}
            </div>

            {/* Co-parent response fields: only when expense was submitted by co-parent */}
            {editExpense.submitted_by !== currentUserId && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-[#3D3D3D]">Status</Label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                  >
                    {STATUS_FILTER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {editForm.status === "disputed" && (
                  <div className="space-y-1">
                    <Label className="text-xs font-medium text-[#3D3D3D]">
                      Dispute reason
                    </Label>
                    <Input
                      value={editForm.dispute_reason}
                      onChange={(e) => setEditForm((f) => ({ ...f, dispute_reason: e.target.value }))}
                      placeholder="Required when disputing"
                      className="h-8 text-sm border-[#E8E4DC]"
                    />
                  </div>
                )}

                {editForm.status === "paid" && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-[#3D3D3D]">Date paid</Label>
                      <Input
                        type="date"
                        value={editForm.paid_at}
                        onChange={(e) => setEditForm((f) => ({ ...f, paid_at: e.target.value }))}
                        className="h-8 text-sm border-[#E8E4DC]"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-[#3D3D3D]">Payment method</Label>
                      <select
                        value={editForm.payment_method}
                        onChange={(e) => setEditForm((f) => ({ ...f, payment_method: e.target.value }))}
                        className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                      >
                        <option value="">—</option>
                        <option value="Venmo">Venmo</option>
                        <option value="Zelle">Zelle</option>
                        <option value="Cash">Cash</option>
                        <option value="Check">Check</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-[#3D3D3D]">Payment reference</Label>
                      <Input
                        value={editForm.payment_reference}
                        onChange={(e) => setEditForm((f) => ({ ...f, payment_reference: e.target.value }))}
                        placeholder="Optional"
                        className="h-8 text-sm border-[#E8E4DC]"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs font-medium text-[#3D3D3D]">Payment notes</Label>
                      <Input
                        value={editForm.payment_notes}
                        onChange={(e) => setEditForm((f) => ({ ...f, payment_notes: e.target.value }))}
                        placeholder="Optional"
                        className="h-8 text-sm border-[#E8E4DC]"
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={closeEditModal}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-full bg-[#5B7A52] text-white hover:bg-[#476242]"
              disabled={savingEdit}
              onClick={() => void handleSaveEdit()}
            >
              {savingEdit ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
