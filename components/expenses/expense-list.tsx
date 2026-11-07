"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ColumnFilterPopover } from "@/components/documents/column-filter-popover";
import { DateFilterPopover, type DateFilterValue } from "@/components/documents/date-filter-popover";
import { getCategoryColor } from "@/lib/categoryColors";
import { Download, FileSpreadsheet, FileText, Check, XCircle, Filter, Paperclip, Pencil, Lock, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { RecordSelectionBar } from "@/components/reports/record-selection-bar";
import { SelectionReportDialog } from "@/components/reports/selection-report-dialog";
import { downloadSelectionReport, SelectionDownloadError } from "@/lib/reports/download-selection-report";
import { namedUnavailableMessage } from "@/lib/reports/selection-report-shared";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { coparentShareInvolves } from "@/lib/expenses-share";
import {
  EXPENSE_CATEGORY_LABELS as CATEGORY_LABELS,
  EXPENSE_STATUS_FILTERS,
  canonicalExpenseStatus,
  coparentShareForExpense as coparentShareForRow,
  displayExpenseStatus,
  expenseBalanceFigures,
  expensePartialPaymentText,
  expenseStatusMatches,
  paymentCoversShare,
  expenseTabSplitText,
  expenseTabTheirShareText,
  formatStoredExpenseNumber,
  parsePaymentAmount,
  payableCoparentShare,
  paymentAmountError,
} from "@/lib/expenses-tab";
import { Label } from "@/components/ui/label";
import { ChildMultiSelect } from "@/components/documents/child-multi-select";
import {
  EXPENSE_VISIBILITY_LABELS,
  EXPENSE_VISIBILITY_UNSET_LABEL,
  expenseVisibilityKey,
  expenseVisibilityLabel,
} from "@/lib/expenses-visibility";

const STATUS_FILTER_OPTIONS = EXPENSE_STATUS_FILTERS;

export type ExpenseRow = {
  id: string;
  description: string;
  amount: string;
  category: string;
  category_description?: string | null;
  child_id: string | null;
  child_name: string | null;
  child_ids: string[];
  amount_owed: string | null;
  other_parent_share?: string | null;
  status: string;
  created_at: string;
  incurred_date: string | null;
  expense_number: number | null;
  submitted_by: string;
  receipt_file_id: string | null;
  receipt_file_name: string | null;
  dispute_reason?: string | null;
  paid_at?: string | null;
  paid_amount?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  payment_notes?: string | null;
  allocation_status?: "ALLOCATED" | "NONE" | "MANUAL_REQUIRED" | "pending" | null;
  split_label?: string | null;
  visibility?: string | null;
};

type ExpenseSortKey =
  | "expense_id"
  | "description"
  | "date"
  | "total"
  | "their_share";
type SortDir = "asc" | "desc";

function compareChildrenByAge(
  a: { first_name?: string | null; date_of_birth?: string | null },
  b: { first_name?: string | null; date_of_birth?: string | null }
) {
  const dobA = a.date_of_birth?.trim() ?? "";
  const dobB = b.date_of_birth?.trim() ?? "";
  const hasA = dobA.length > 0;
  const hasB = dobB.length > 0;
  if (hasA && hasB) {
    if (dobA !== dobB) return dobA < dobB ? -1 : 1;
  } else if (hasA !== hasB) {
    return hasA ? -1 : 1;
  }
  return (a.first_name ?? "").localeCompare(b.first_name ?? "", undefined, {
    sensitivity: "base",
  });
}

interface ExpenseListProps {
  expenses: ExpenseRow[];
  currentUserId: string;
  custodySplitPercent: number;
  caseId: string;
  children: { id: string; first_name: string; profile_image?: string | null; date_of_birth?: string | null }[];
}

function formatDate(createdAt: string) {
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Postgres DATE as "YYYY-MM-DD" — parse as local calendar day, not UTC midnight. */
function formatDateOnly(isoDate: string) {
  const m = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return formatDate(isoDate);
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  return new Date(year, monthIndex, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Calendar day shown in the Date column: incurred_date, else local day of created_at. */
function ledgerDateKey(exp: ExpenseRow): string {
  if (exp.incurred_date) {
    const m = exp.incurred_date.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = new Date(exp.created_at);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function csvIncurredDate(exp: ExpenseRow): string {
  if (!exp.incurred_date) return "";
  const m = exp.incurred_date.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function csvEnteredDate(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function dateTiebreak(a: ExpenseRow, b: ExpenseRow): number {
  const ka = ledgerDateKey(a);
  const kb = ledgerDateKey(b);
  if (ka !== kb) return ka < kb ? 1 : -1;
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? 1 : -1;
  }
  return 0;
}

function compareExpenses(
  a: ExpenseRow,
  b: ExpenseRow,
  sortKey: ExpenseSortKey,
  sortDir: SortDir,
  currentUserId: string
): number {
  let c = 0;
  switch (sortKey) {
    case "expense_id": {
      const na = a.expense_number;
      const nb = b.expense_number;
      if (na == null && nb == null) c = 0;
      else if (na == null) return 1;
      else if (nb == null) return -1;
      else c = na - nb;
      break;
    }
    case "description":
      c = (a.description ?? "").localeCompare(b.description ?? "", undefined, {
        sensitivity: "base",
      });
      break;
    case "date":
      c = ledgerDateKey(a).localeCompare(ledgerDateKey(b));
      if (c === 0) {
        c = a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
      }
      break;
    case "total": {
      const aa = Number(a.amount);
      const bb = Number(b.amount);
      const aOk = Number.isFinite(aa);
      const bOk = Number.isFinite(bb);
      if (!aOk && !bOk) c = 0;
      else if (!aOk) return 1;
      else if (!bOk) return -1;
      else c = aa - bb;
      break;
    }
    case "their_share":
      c =
        coparentShareForRow(a, currentUserId) -
        coparentShareForRow(b, currentUserId);
      break;
  }
  if (c === 0 && sortKey !== "date") {
    return dateTiebreak(a, b);
  }
  return sortDir === "desc" ? -c : c;
}

function SortHeaderButton({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  column: ExpenseSortKey;
  sortKey: ExpenseSortKey;
  sortDir: SortDir;
  onSort: (key: ExpenseSortKey) => void;
}) {
  const active = sortKey === column;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-0.5 font-medium hover:text-foreground"
      onClick={() => onSort(column)}
      aria-label={`Sort by ${label}${
        active ? `, ${sortDir === "desc" ? "descending" : "ascending"}` : ""
      }`}
    >
      <span>{label}</span>
      {active ? (
        sortDir === "desc" ? (
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
        ) : (
          <ChevronUp className="h-3 w-3 shrink-0" aria-hidden />
        )
      ) : null}
    </button>
  );
}

function csvStoredExpenseNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return `EXP-${String(Math.trunc(Number(n))).padStart(3, "0")}`;
}

function csvEscape(value: string): string {
  const s = String(value ?? "").replace(/"/g, '""');
  return /[",\\r\\n]/.test(s) ? `"${s}"` : s;
}

export function ExpenseList({
  expenses,
  currentUserId,
  custodySplitPercent,
  caseId,
  children,
}: ExpenseListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const childrenByAge = useMemo(
    () => [...children].sort(compareChildrenByAge),
    [children]
  );
  const [searchInput, setSearchInput] = useState("");
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterChildren, setFilterChildren] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>(() => {
    const status = searchParams.get("status")?.toLowerCase();
    if (status === "pending") return ["pending"];
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
  const [filterVisibilities, setFilterVisibilities] = useState<string[]>([]);
  const [visibilityFilterOpen, setVisibilityFilterOpen] = useState(false);
  const [sortKey, setSortKey] = useState<ExpenseSortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
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
  const [markPaidAmount, setMarkPaidAmount] = useState<string>("");
  const [markPaidMethod, setMarkPaidMethod] = useState<string>("");
  const [markPaidRef, setMarkPaidRef] = useState<string>("");
  const [markPaidNotes, setMarkPaidNotes] = useState<string>("");
  const [paymentReadOnly, setPaymentReadOnly] = useState(false);
  const [paymentBaseline, setPaymentBaseline] = useState<{
    date: string;
    amount: string;
    method: string;
    reference: string;
    notes: string;
    paidAtIso: string | null;
  } | null>(null);
  const [exportingSelected, setExportingSelected] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [creatingReport, setCreatingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportChoices, setReportChoices] = useState({ summary: true, details: true, files: true });
  const [editExpense, setEditExpense] = useState<ExpenseRow | null>(null);
  const [editForm, setEditForm] = useState({
    description: "",
    amount: "",
    category: "other",
    child_ids: [] as string[],
    incurred_date: "",
    category_description: "",
    status: "submitted",
    dispute_reason: "",
    paid_at: "",
    payment_method: "",
    payment_reference: "",
    payment_notes: "",
    visibility: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const editLoadIdRef = useRef<string | null>(null);

  async function openEditModal(exp: ExpenseRow) {
    editLoadIdRef.current = exp.id;
    const fallback =
      exp.child_ids.length > 0
        ? exp.child_ids
        : exp.child_id
          ? [exp.child_id]
          : [];
    setEditExpense(exp);
    setEditForm({
      description: exp.description ?? "",
      amount: exp.amount ?? "",
      category: exp.category ?? "other",
      child_ids: fallback,
      incurred_date: (() => {
        const raw = (exp.incurred_date ?? "").trim();
        const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
      })(),
      category_description: (exp.category_description ?? "").slice(0, 100),
      status: canonicalExpenseStatus(exp.status) || "pending",
      dispute_reason: exp.dispute_reason ?? "",
      paid_at: (exp as { paid_at?: string | null }).paid_at
        ? new Date((exp as { paid_at: string }).paid_at).toISOString().slice(0, 10)
        : "",
      payment_method: (exp as { payment_method?: string | null }).payment_method ?? "",
      payment_reference: (exp as { payment_reference?: string | null }).payment_reference ?? "",
      payment_notes: (exp as { payment_notes?: string | null }).payment_notes ?? "",
      visibility: expenseVisibilityKey(exp.visibility),
    });
    try {
      const res = await fetch(`/api/expenses/${exp.id}`);
      const data = (await res.json().catch(() => ({}))) as { child_ids?: unknown };
      if (editLoadIdRef.current !== exp.id) return;
      if (res.ok && Array.isArray(data.child_ids)) {
        const ids = data.child_ids.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0
        );
        setEditForm((f) => ({ ...f, child_ids: ids }));
      }
    } catch {
      // Keep fallback from expenses.child_id
    }
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
          category_description:
            editForm.category === "other"
              ? editForm.category_description.trim() || null
              : null,
          child_id: editForm.child_ids[0] ?? null,
          child_ids: editForm.child_ids,
          incurred_date: editForm.incurred_date || null,
          status: editForm.status || undefined,
          dispute_reason: editForm.dispute_reason.trim() || null,
          ...(editExpense.submitted_by === currentUserId &&
          editForm.visibility !== expenseVisibilityKey(editExpense.visibility)
            ? { visibility: editForm.visibility || null }
            : {}),
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
  const visibilityFilterActive = filterVisibilities.length > 0;

  const anyFilterActive =
    debouncedSearch.length > 0 ||
    categoryFilterActive ||
    childFilterActive ||
    statusFilterActive ||
    visibilityFilterActive ||
    dateFilterActive;

  function handleSortClick(key: ExpenseSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const { filtered, figures } = useMemo(() => {
    const parts = debouncedSearch.split(/\s+/).filter(Boolean);

    const result = expenses.filter((exp) => {
      const text = [
        exp.description ?? "",
        exp.category ?? "",
        exp.child_name ?? "",
        exp.receipt_file_name ?? "",
        expenseVisibilityLabel(exp.visibility),
      ]
        .join(" ")
        .toLowerCase();

      if (parts.length && !parts.every((p) => text.includes(p))) return false;

      if (filterCategories.length && !filterCategories.includes(exp.category)) return false;
      if (filterChildren.length) {
        if (
          !exp.child_ids.length ||
          !exp.child_ids.some((id) => filterChildren.includes(id))
        ) {
          return false;
        }
      }
      if (!expenseStatusMatches(exp.status, filterStatuses)) return false;
      if (filterVisibilities.length && !filterVisibilities.includes(expenseVisibilityKey(exp.visibility))) return false;

      if (startDate || endDate) {
        const key = ledgerDateKey(exp);
        if (startDate && key < startDate) return false;
        if (endDate && key > endDate) return false;
      }

      return true;
    });

    result.sort((a, b) => compareExpenses(a, b, sortKey, sortDir, currentUserId));

    return {
      filtered: result,
      figures: expenseBalanceFigures(result, currentUserId),
    };
  }, [debouncedSearch, expenses, filterCategories, filterChildren, filterStatuses, filterVisibilities, startDate, endDate, currentUserId, sortKey, sortDir]);

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
      "Date entered",
      "Total",
      "Split",
      "Their share",
      "Visibility",
      "Status",
    ];
    const rows = filtered.map((exp) => {
      const amountNum = Number(exp.amount);
      const theirShare = coparentShareForRow(exp, currentUserId);
      const involved = coparentShareInvolves(theirShare);
      const statusLabel = displayExpenseStatus(exp, involved);
      return [
        csvStoredExpenseNumber(exp.expense_number),
        exp.description ?? "",
        CATEGORY_LABELS[exp.category] ?? exp.category,
        exp.child_name ?? "—",
        csvIncurredDate(exp),
        csvEnteredDate(exp.created_at),
        Number.isNaN(amountNum) ? "" : amountNum.toFixed(2),
        expenseTabSplitText(exp),
        theirShare.toFixed(2),
        expenseVisibilityLabel(exp.visibility),
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
    const selected = expenses.filter((exp) => selectedIds.has(exp.id));
    if (selected.length === 0) return;
    setExportingSelected(true);
    try {
      const headers = [
        "Expense ID",
        "Description",
        "Category",
        "Child",
        "Date",
        "Date entered",
        "Total",
        "Split",
        "Their share",
        "Visibility",
        "Status",
        "Payment Method",
        "Payment Date",
        "Payment Reference",
      ];
      const rows = selected.map((exp) => {
        const amountNum = Number(exp.amount);
        const theirShare = coparentShareForRow(exp, currentUserId);
        const involved = coparentShareInvolves(theirShare);
        const statusLabel = displayExpenseStatus(exp, involved);
        const paymentMethod = (exp as any).payment_method ?? "";
        const paidAt = (exp as any).paid_at
          ? formatDate((exp as any).paid_at as string)
          : "";
        const paymentRef = (exp as any).payment_reference ?? "";
        return [
          csvStoredExpenseNumber(exp.expense_number),
          exp.description ?? "",
          CATEGORY_LABELS[exp.category] ?? exp.category,
          exp.child_name ?? "—",
          csvIncurredDate(exp),
          csvEnteredDate(exp.created_at),
          Number.isNaN(amountNum) ? "" : amountNum.toFixed(2),
          expenseTabSplitText(exp),
          theirShare.toFixed(2),
          expenseVisibilityLabel(exp.visibility),
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
    setFilterVisibilities([]);
    setStartDate("");
    setEndDate("");
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    setDeleteConfirmIds(Array.from(selectedIds));
  }

  async function handleDownloadSelectedReceipts() {
    const chosen = expenses.filter((exp) => selectedIds.has(exp.id));
    const selected = chosen.filter((exp) => exp.receipt_file_id);
    const missingReceipts = chosen.length - selected.length;
    if (selected.length === 0) {
      showErrorToast("No receipts attached to selected expenses");
      return;
    }
    if (missingReceipts > 0) {
      showErrorToast(
        `${missingReceipts} selected expense${missingReceipts === 1 ? " has" : "s have"} no receipt.`
      );
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
    action: "approve" | "dispute" | "resolve" | "mark_paid" | "update_payment",
    opts?: {
      dispute_reason?: string;
      paid_at?: string;
      paid_amount?: number;
      payment_method?: string;
      payment_reference?: string;
      payment_notes?: string;
    }
  ): Promise<boolean> {
    setRespondingId(expenseId);
    try {
      const body: {
        expense_id: string;
        action: string;
        dispute_reason?: string;
        paid_at?: string;
        paid_amount?: number;
        payment_method?: string;
        payment_reference?: string;
        payment_notes?: string;
      } = {
        expense_id: expenseId,
        action,
      };
      if (opts?.dispute_reason) body.dispute_reason = opts.dispute_reason;
      if (action === "mark_paid" || action === "update_payment") {
        body.paid_at = opts?.paid_at;
        body.paid_amount = opts?.paid_amount;
        body.payment_method = opts?.payment_method ?? "";
        body.payment_reference = opts?.payment_reference ?? "";
        body.payment_notes = opts?.payment_notes ?? "";
      }
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
        return false;
      }
      router.refresh();
      if (action === "approve") {
        showSuccessToast("Expense approved");
      } else if (action === "dispute") {
        showSuccessToast("Dispute submitted");
      } else if (action === "resolve") {
        showSuccessToast("Expense resolved");
      } else if (action === "mark_paid") {
        showSuccessToast("Expense marked paid");
      } else if (action === "update_payment") {
        showSuccessToast("Payment record updated");
      }
      return true;
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : "Request failed");
      return false;
    } finally {
      setRespondingId(null);
    }
  }

  function paymentDateInput(iso: string | null | undefined): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function openPayment(exp: ExpenseRow, mode: "record" | "view") {
    const share = payableCoparentShare(exp);
    const recorded = parsePaymentAmount(exp.paid_amount);
    const date =
      mode === "view"
        ? paymentDateInput(exp.paid_at)
        : paymentDateInput(new Date().toISOString());
    const amount =
      mode === "view"
        ? recorded != null
          ? recorded.toFixed(2)
          : ""
        : share != null
          ? share.toFixed(2)
          : "";
    const method = mode === "view" ? exp.payment_method ?? "" : "";
    const reference = mode === "view" ? exp.payment_reference ?? "" : "";
    const notes = mode === "view" ? exp.payment_notes ?? "" : "";
    setMarkPaidExpense(exp);
    setPaymentReadOnly(mode === "view");
    setMarkPaidDate(date);
    setMarkPaidAmount(amount);
    setMarkPaidMethod(method);
    setMarkPaidRef(reference);
    setMarkPaidNotes(notes);
    setPaymentBaseline(
      mode === "view"
        ? {
            date,
            amount,
            method,
            reference,
            notes,
            paidAtIso: exp.paid_at ?? null,
          }
        : null
    );
  }

  function closePayment() {
    setMarkPaidExpense(null);
    setPaymentBaseline(null);
    setPaymentReadOnly(false);
  }

  async function savePayment() {
    if (!markPaidExpense || respondingId) return;
    const share = payableCoparentShare(markPaidExpense);
    const amount = parsePaymentAmount(markPaidAmount);
    const amountError = paymentAmountError(amount, share);
    if (amountError || amount == null) {
      showErrorToast(amountError ?? "Enter the amount paid.");
      return;
    }
    const unchanged =
      paymentBaseline != null &&
      markPaidDate === paymentBaseline.date &&
      amount === parsePaymentAmount(paymentBaseline.amount) &&
      markPaidMethod === paymentBaseline.method &&
      markPaidRef.trim() === paymentBaseline.reference.trim() &&
      markPaidNotes.trim() === paymentBaseline.notes.trim();
    if (unchanged) {
      setPaymentReadOnly(true);
      return;
    }
    const paidAtIso =
      paymentBaseline && markPaidDate === paymentBaseline.date && paymentBaseline.paidAtIso
        ? paymentBaseline.paidAtIso
        : markPaidDate
          ? new Date(`${markPaidDate}T00:00:00`).toISOString()
          : new Date().toISOString();
    const saved = await handleRespond(
      markPaidExpense.id,
      paymentBaseline ? "update_payment" : "mark_paid",
      {
        paid_at: paidAtIso,
        paid_amount: amount,
        payment_method: markPaidMethod,
        payment_reference: markPaidRef.trim(),
        payment_notes: markPaidNotes.trim(),
      }
    );
    if (saved) closePayment();
  }

  const canRespond = (exp: ExpenseRow) =>
    exp.submitted_by !== currentUserId &&
    canonicalExpenseStatus(exp.status) === "pending" &&
    coparentShareInvolves(coparentShareForRow(exp, currentUserId));

  async function handleCreateExpenseReport() {
    const ids = expenses.filter((exp) => selectedIds.has(exp.id)).map((exp) => exp.id);
    setCreatingReport(true);
    setReportError(null);
    try {
      const result = await downloadSelectionReport({
        caseId,
        reportType: "expenses",
        ids,
        options: reportChoices,
      });
      const missing = result.warnings.length;
      showSuccessToast(
        missing > 0
          ? `Expense report downloaded. ${missing} attachment${missing === 1 ? " was" : "s were"} unavailable.`
          : "Expense report downloaded"
      );
      setReportOpen(false);
    } catch (error) {
      const labels = new Map(expenses.map((expense) => [expense.id, expense.description?.trim() || "Untitled expense"]));
      setReportError(
        error instanceof SelectionDownloadError
          ? namedUnavailableMessage(error.message, error.unavailableIds, labels)
          : error instanceof Error
            ? error.message
            : "The report could not be created."
      );
    } finally {
      setCreatingReport(false);
    }
  }

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
                <p className="text-[11px] text-foreground-secondary mb-0.5">Agreed outstanding</p>
                <p className="text-sm font-medium text-foreground">{figures.agreed.label}</p>
                <p className="text-[11px] text-foreground-secondary mt-1">Claimed, awaiting response</p>
                <p className="text-sm font-medium text-foreground">{figures.claimed.label}</p>
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
                  <div className="space-y-3 text-sm">
                    <div className="space-y-1">
                      <p className="text-[11px] text-foreground-secondary">Agreed outstanding</p>
                      <p className="flex justify-between">
                        <span>They owe you</span>
                        <span className="font-medium">${figures.agreed.owedToYou.toFixed(2)}</span>
                      </p>
                      <p className="flex justify-between">
                        <span>You owe them</span>
                        <span className="font-medium">${figures.agreed.youOwe.toFixed(2)}</span>
                      </p>
                      <p className="flex justify-between border-t border-border pt-2 mt-1 text-[13px]">
                        <span className="text-foreground-secondary">Net</span>
                        <span className="font-medium">{figures.agreed.label}</span>
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-foreground-secondary">Claimed, awaiting response</p>
                      <p className="flex justify-between">
                        <span>They owe you</span>
                        <span className="font-medium">${figures.claimed.owedToYou.toFixed(2)}</span>
                      </p>
                      <p className="flex justify-between">
                        <span>You owe them</span>
                        <span className="font-medium">${figures.claimed.youOwe.toFixed(2)}</span>
                      </p>
                      <p className="flex justify-between border-t border-border pt-2 mt-1 text-[13px]">
                        <span className="text-foreground-secondary">Net</span>
                        <span className="font-medium">{figures.claimed.label}</span>
                      </p>
                    </div>
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
          <RecordSelectionBar
            count={selectedIds.size}
            deleting={deleting}
            onDelete={handleDeleteSelected}
            actions={[
              {
                label: "Download Receipts",
                hint: "Original files only",
                icon: Download,
                onClick: () => void handleDownloadSelectedReceipts(),
              },
              {
                label: "Export Data",
                hint: "Spreadsheet data only",
                icon: FileSpreadsheet,
                onClick: () => void handleExportSelectedCSV(),
                disabled: exportingSelected,
                busyLabel: "Exporting…",
              },
              {
                label: "Create Report",
                hint: "Report + receipts",
                icon: FileText,
                onClick: () => {
                  setReportChoices({ summary: true, details: true, files: true });
                  setReportError(null);
                  setReportOpen(true);
                },
              },
            ]}
          />
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
                  <th
                    className="px-3 py-2 font-medium whitespace-nowrap min-w-[90px]"
                    aria-sort={
                      sortKey === "expense_id"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <SortHeaderButton
                      label="Expense ID"
                      column="expense_id"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSortClick}
                    />
                  </th>
                  <th
                    className="px-3 py-2 font-medium"
                    aria-sort={
                      sortKey === "description"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <SortHeaderButton
                      label="Description"
                      column="description"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSortClick}
                    />
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
                  <th
                    className="px-3 py-2 font-medium whitespace-nowrap"
                    aria-sort={
                      sortKey === "date"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      <SortHeaderButton
                        label="Date"
                        column="date"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSortClick}
                      />
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
                  <th
                    className="px-3 py-2 font-medium whitespace-nowrap"
                    aria-sort={
                      sortKey === "total"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <SortHeaderButton
                      label="Total"
                      column="total"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSortClick}
                    />
                  </th>
                  <th className="px-2 py-2 font-medium whitespace-nowrap">Split</th>
                  <th
                    className="px-2 py-2 font-medium whitespace-nowrap"
                    aria-sort={
                      sortKey === "their_share"
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <SortHeaderButton
                      label="Their share"
                      column="their_share"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSortClick}
                    />
                  </th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <span>Visibility</span>
                      <ColumnFilterPopover
                        title="Visibility"
                        options={[
                          { value: "private", label: EXPENSE_VISIBILITY_LABELS.private },
                          { value: "parents_only", label: EXPENSE_VISIBILITY_LABELS.parents_only },
                          { value: "family", label: EXPENSE_VISIBILITY_LABELS.family },
                          { value: "", label: EXPENSE_VISIBILITY_UNSET_LABEL },
                        ]}
                        selected={filterVisibilities}
                        onApply={setFilterVisibilities}
                        onClear={() => setFilterVisibilities([])}
                        open={visibilityFilterOpen}
                        onOpenChange={setVisibilityFilterOpen}
                        active={visibilityFilterActive}
                      />
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
                  const involved = coparentShareInvolves(coparentShareForRow(exp, currentUserId));
                  const catColors = getCategoryColor(exp.category);
                  const otherCategoryNote =
                    exp.category === "other"
                      ? (exp.category_description ?? "").trim()
                      : "";
                  const statusLabel = displayExpenseStatus(exp, involved);
                  const partialPayment = expensePartialPaymentText(exp);
                  const statusKey = canonicalExpenseStatus(exp.status);
                  const statusClasses =
                    !involved &&
                    (statusKey === "pending" || statusKey === "approved" || statusKey === "logged")
                      ? "bg-[#F2F5EF] text-[#5B7A52]"
                      : statusKey === "pending"
                      ? "bg-muted text-foreground-secondary"
                      : statusKey === "disputed"
                        ? "bg-[#FDF6E3] text-[#D4A843]"
                        : statusKey === "approved" || statusKey === "logged"
                          ? "bg-[#F2F5EF] text-[#5B7A52]"
                          : statusKey === "paid"
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
                          aria-label={`Select expense ${formatStoredExpenseNumber(exp.expense_number)}`}
                          className="rounded border-border"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-xs align-middle whitespace-nowrap">
                        {formatStoredExpenseNumber(exp.expense_number)}
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
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={cn(
                                "h-2.5 w-2.5 shrink-0 rounded-full",
                                catColors.dotClass
                              )}
                              aria-hidden
                            />
                            <span className="text-xs text-foreground-secondary">
                              {CATEGORY_LABELS[exp.category] ?? exp.category}
                            </span>
                          </span>
                          {otherCategoryNote ? (
                            <span className="text-[11px] text-foreground-secondary overflow-hidden text-ellipsis whitespace-nowrap block max-w-[160px]">
                              {otherCategoryNote}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-foreground-secondary align-middle">
                        {exp.child_name ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-foreground-secondary whitespace-nowrap align-middle">
                        {exp.incurred_date
                          ? formatDateOnly(exp.incurred_date)
                          : formatDate(exp.created_at)}
                      </td>
                      <td className="px-3 py-1.5 align-middle whitespace-nowrap">
                        {Number.isNaN(amountNum) ? "—" : `$${amountNum.toFixed(2)}`}
                      </td>
                      <td className="px-2 py-1.5 align-middle text-foreground-secondary whitespace-nowrap">
                        {expenseTabSplitText(exp)}
                      </td>
                      <td className="px-2 py-1.5 align-middle whitespace-nowrap">
                        {expenseTabTheirShareText(exp, currentUserId)}
                      </td>
                      <td className="px-3 py-1.5 align-middle whitespace-nowrap text-foreground-secondary">
                        {expenseVisibilityLabel(exp.visibility)}
                      </td>
                      <td className="px-3 py-1.5 align-middle whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          {exp.status === "paid" ? (
                            <button
                              type="button"
                              className={cn(
                                "inline-block rounded-full px-2 py-0.5 text-xs font-medium hover:underline",
                                statusClasses
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                openPayment(exp, "view");
                              }}
                            >
                              {statusLabel}
                            </button>
                          ) : (
                            <span
                              className={cn(
                                "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                                statusClasses
                              )}
                            >
                              {statusLabel}
                            </span>
                          )}
                          {partialPayment && (
                            <button
                              type="button"
                              className="text-left text-[11px] text-foreground-secondary hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                openPayment(exp, "view");
                              }}
                            >
                              {partialPayment}
                            </button>
                          )}
                          {exp.submitted_by !== currentUserId ? (
                            <div className="flex flex-wrap gap-1 text-[11px]">
                              {involved && statusKey === "pending" && (
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
                              {payableCoparentShare(exp) != null && statusKey === "approved" && (
                                <button
                                  type="button"
                                  className="inline-flex items-center rounded-full bg-[#5B7A52] px-2 py-0.5 text-[11px] text-white hover:bg-[#476242]"
                                  disabled={respondingId === exp.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openPayment(exp, partialPayment ? "view" : "record");
                                  }}
                                >
                                  {partialPayment ? "Update payment" : "Mark Paid"}
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1 text-[11px] text-foreground-secondary">
                              {involved && statusKey === "pending" && (
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
                              {involved && statusKey === "approved" && !partialPayment && (
                                <span className="text-[#5B7A52]">Approved</span>
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
                void handleRespond(disputeExpense.id, "dispute", disputeText.trim() ? { dispute_reason: disputeText.trim() } : undefined);
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
          if (e.target === e.currentTarget) closePayment();
        }}
      >
        <div
          className="w-full max-w-[420px] rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-record-title"
        >
          <h2 id="payment-record-title" className="font-heading text-base font-semibold text-[#3D3D3D]">
            {paymentBaseline ? "Payment record" : "Mark expense as paid"}
          </h2>
          <p className="mt-1 text-[11px] text-[#8A8A8A]">
            {markPaidExpense.description || "Expense"}
            {payableCoparentShare(markPaidExpense) != null
              ? ` · Co-parent's share $${payableCoparentShare(markPaidExpense)!.toFixed(2)}`
              : ""}
          </p>

          <div className="mt-3 space-y-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[#3D3D3D]" htmlFor="payment-date">
                Date paid
              </label>
              <input
                id="payment-date"
                type="date"
                value={markPaidDate}
                disabled={paymentReadOnly}
                onChange={(e) => setMarkPaidDate(e.target.value)}
                className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E] disabled:cursor-default disabled:bg-[#F4F1EA]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[#3D3D3D]" htmlFor="payment-amount">
                Amount
              </label>
              <input
                id="payment-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={markPaidAmount}
                disabled={paymentReadOnly}
                onChange={(e) => setMarkPaidAmount(e.target.value)}
                className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E] disabled:cursor-default disabled:bg-[#F4F1EA]"
              />
              {!paymentReadOnly && payableCoparentShare(markPaidExpense) != null && (
                <p className="text-[11px] text-[#8A8A8A]">
                  The co-parent's share is ${payableCoparentShare(markPaidExpense)!.toFixed(2)}. Enter that, or a smaller amount. A smaller amount stays Approved and the remainder stays outstanding. The status becomes Paid when the amount covers the share.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[#3D3D3D]" htmlFor="payment-method">
                Payment method
              </label>
              <select
                id="payment-method"
                value={markPaidMethod}
                disabled={paymentReadOnly}
                onChange={(e) => setMarkPaidMethod(e.target.value)}
                className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E] disabled:cursor-default disabled:bg-[#F4F1EA]"
              >
                <option value="">{paymentReadOnly ? "—" : "Select method"}</option>
                <option value="Venmo">Venmo</option>
                <option value="Zelle">Zelle</option>
                <option value="Cash">Cash</option>
                <option value="Check">Check</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[#3D3D3D]" htmlFor="payment-reference">
                Reference / confirmation number
              </label>
              <input
                id="payment-reference"
                type="text"
                value={markPaidRef}
                disabled={paymentReadOnly}
                onChange={(e) => setMarkPaidRef(e.target.value)}
                placeholder={paymentReadOnly ? "" : "e.g., Venmo transaction ID"}
                className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-xs text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E] disabled:cursor-default disabled:bg-[#F4F1EA]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[#3D3D3D]" htmlFor="payment-notes">
                Notes
              </label>
              <textarea
                id="payment-notes"
                value={markPaidNotes}
                disabled={paymentReadOnly}
                onChange={(e) => setMarkPaidNotes(e.target.value)}
                placeholder={paymentReadOnly ? "" : "Any additional details"}
                className="w-full min-h-[72px] rounded-md border border-[#E8E4DC] bg-white px-2 py-1.5 text-xs text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E] disabled:cursor-default disabled:bg-[#F4F1EA]"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full text-xs"
              onClick={() => {
                if (paymentBaseline && !paymentReadOnly) {
                  setMarkPaidDate(paymentBaseline.date);
                  setMarkPaidAmount(paymentBaseline.amount);
                  setMarkPaidMethod(paymentBaseline.method);
                  setMarkPaidRef(paymentBaseline.reference);
                  setMarkPaidNotes(paymentBaseline.notes);
                  setPaymentReadOnly(true);
                  return;
                }
                closePayment();
              }}
            >
              {paymentBaseline && !paymentReadOnly ? "Cancel" : "Close"}
            </Button>
            {paymentReadOnly && payableCoparentShare(markPaidExpense) != null ? (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                onClick={() => {
                  if (!markPaidAmount) {
                    const share = payableCoparentShare(markPaidExpense);
                    if (share != null) setMarkPaidAmount(share.toFixed(2));
                  }
                  setPaymentReadOnly(false);
                }}
              >
                Edit
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                disabled={respondingId === markPaidExpense.id}
                onClick={() => void savePayment()}
              >
                {paymentCoversShare(
                  parsePaymentAmount(markPaidAmount),
                  payableCoparentShare(markPaidExpense)
                )
                  ? "Mark Paid"
                  : "Save payment"}
              </Button>
            )}
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
                Date incurred
                {editExpense.submitted_by !== currentUserId && (
                  <Lock className="h-3 w-3 text-foreground-secondary" aria-hidden />
                )}
              </Label>
              {editExpense.submitted_by === currentUserId ? (
                <input
                  type="date"
                  value={editForm.incurred_date}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, incurred_date: e.target.value }))
                  }
                  className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                />
              ) : (
                <p className="text-sm text-foreground-secondary py-1.5">
                  {editExpense.incurred_date
                    ? formatDateOnly(editExpense.incurred_date)
                    : formatDate(editExpense.created_at)}
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
                  onChange={(e) => {
                    const next = e.target.value;
                    setEditForm((f) => ({
                      ...f,
                      category: next,
                      ...(next !== "other" ? { category_description: "" } : {}),
                    }));
                  }}
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

            {editForm.category === "other" && (
              <div className="space-y-1">
                <Label className="text-xs font-medium text-[#3D3D3D] flex items-center gap-1">
                  Category description
                  {editExpense.submitted_by !== currentUserId && (
                    <Lock className="h-3 w-3 text-foreground-secondary" aria-hidden />
                  )}
                </Label>
                {editExpense.submitted_by === currentUserId ? (
                  <input
                    type="text"
                    value={editForm.category_description}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        category_description: e.target.value.slice(0, 100),
                      }))
                    }
                    placeholder="e.g., School supplies, Birthday party"
                    maxLength={100}
                    className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                  />
                ) : (
                  <p className="text-sm text-foreground-secondary py-1.5">
                    {(editExpense.category_description ?? "").trim() || "—"}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs font-medium text-[#3D3D3D] flex items-center gap-1">
                Who can see this?
                {editExpense.submitted_by !== currentUserId && (
                  <Lock className="h-3 w-3 text-foreground-secondary" aria-hidden />
                )}
              </Label>
              {editExpense.submitted_by === currentUserId ? (
                <select
                  value={editForm.visibility}
                  onChange={(e) => setEditForm((f) => ({ ...f, visibility: e.target.value }))}
                  className="h-8 w-full rounded-md border border-[#E8E4DC] bg-white px-2 text-sm text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                >
                  <option value="">{EXPENSE_VISIBILITY_UNSET_LABEL}</option>
                  <option value="private">{EXPENSE_VISIBILITY_LABELS.private}</option>
                  <option value="parents_only">{EXPENSE_VISIBILITY_LABELS.parents_only}</option>
                  <option value="family">{EXPENSE_VISIBILITY_LABELS.family}</option>
                </select>
              ) : (
                <p className="text-sm text-foreground-secondary py-1.5">
                  {expenseVisibilityLabel(editExpense.visibility)}
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
                <ChildMultiSelect
                  id="edit-expense-child"
                  children={childrenByAge}
                  value={editForm.child_ids}
                  onChange={(ids) => setEditForm((f) => ({ ...f, child_ids: ids }))}
                />
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
                    {STATUS_FILTER_OPTIONS.filter(
                      (opt) => opt.value !== "paid" || editExpense.status === "paid"
                    ).map((opt) => (
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
                  <p className="text-[11px] text-[#8A8A8A]">
                    Open the Paid status to see the payment record.
                  </p>
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
    <SelectionReportDialog
      open={reportOpen}
      title="Create expense report"
      countLabel={`${selectedIds.size} selected expense${selectedIds.size === 1 ? "" : "s"}`}
      choices={[
        { id: "summary", label: "Include summary and reimbursement totals" },
        { id: "details", label: "Include itemized expense details" },
        { id: "files", label: "Include receipts and supporting files" },
      ]}
      selected={reportChoices}
      onToggle={(id) => setReportChoices((current) => ({ ...current, [id]: !current[id as keyof typeof current] }))}
      onClose={() => {
        if (!creatingReport) setReportOpen(false);
      }}
      onGenerate={() => void handleCreateExpenseReport()}
      generating={creatingReport}
      error={reportError}
    />
    </>
  );
}
