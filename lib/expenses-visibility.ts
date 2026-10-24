import { documentAuthorizedForViewer } from "@/lib/documents-tab";

/** Values the expense form and documents vault already use. */
export const EXPENSE_VISIBILITY_VALUES = ["private", "parents_only", "family"] as const;

export type ExpenseVisibility = (typeof EXPENSE_VISIBILITY_VALUES)[number];

export const EXPENSE_VISIBILITY_LABELS: Record<ExpenseVisibility, string> = {
  private: "Just me",
  parents_only: "Parents only",
  family: "Family",
};

export const EXPENSE_VISIBILITY_UNSET_LABEL = "Not set";

export type ExpenseViewer = { userId: string; role?: string | null };

export type ExpenseAccessRow = {
  visibility?: string | null;
  submitted_by?: string | null;
};

type QueryError = { message?: string } | null;

type ExpenseQueryResult = PromiseLike<{ data: unknown; error: QueryError }>;

export type LoadedExpense = ExpenseAccessRow & Record<string, any>;

/**
 * A stored visibility, or null when the row has none.
 * Empty and unknown strings stay null so the UI does not invent Parents only or Just me.
 */
export function storedExpenseVisibility(value: unknown): ExpenseVisibility | null {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (key === "private" || key === "parents_only" || key === "family") return key;
  if (key === "parents") return "parents_only";
  if (key === "family_read_only") return "family";
  if (key === "shared_ai_review") return "parents_only";
  return null;
}

/** Label for the value actually stored. Blank stays "Not set". */
export function expenseVisibilityLabel(value: unknown): string {
  const stored = storedExpenseVisibility(value);
  if (stored) return EXPENSE_VISIBILITY_LABELS[stored];
  if (typeof value === "string" && value.trim()) return value.trim();
  return EXPENSE_VISIBILITY_UNSET_LABEL;
}

export function parseExpenseVisibility(value: unknown): ExpenseVisibility | null {
  return storedExpenseVisibility(value);
}

/** Filter and edit values. Known aliases use the canonical value. Unknown text stays as stored. */
export function expenseVisibilityKey(value: unknown): string {
  const stored = storedExpenseVisibility(value);
  if (stored) return stored;
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

/**
 * Who may see this expense.
 * Null visibility is a legacy row: it stays visible to case members, which is how
 * expenses behaved before the column existed. Private is the submitter only.
 * Sharing percent is not an input.
 */
export function expenseVisibleToViewer(expense: ExpenseAccessRow, viewer: ExpenseViewer): boolean {
  const raw = typeof expense.visibility === "string" ? expense.visibility.trim().toLowerCase() : "";
  if (!raw) return true;
  const stored = storedExpenseVisibility(raw);
  if (stored === "private") return expense.submitted_by === viewer.userId;
  if (stored === "parents_only") {
    if (expense.submitted_by === viewer.userId) return true;
    const role = (viewer.role ?? "").trim().toLowerCase();
    return role === "parent" || role === "professional_viewer";
  }
  if (stored === "family") return true;
  return expense.submitted_by === viewer.userId;
}

export function visibleExpenseRows<T extends ExpenseAccessRow>(
  rows: T[] | null | undefined,
  viewer: ExpenseViewer
): T[] {
  return (rows ?? []).filter((row) => expenseVisibleToViewer(row, viewer));
}

/** A receipt is available only when both the expense and the file allow this viewer. */
export function expenseReceiptVisibleToViewer(input: {
  expense: ExpenseAccessRow;
  document: { visibility: string | null | undefined; uploadedBy: string | null | undefined };
  viewer: { userId: string; role: string | null | undefined };
}): boolean {
  if (!expenseVisibleToViewer(input.expense, input.viewer)) return false;
  return documentAuthorizedForViewer(input.document, {
    userId: input.viewer.userId,
    role: input.viewer.role,
  });
}

export function missingVisibilityColumn(error: QueryError): boolean {
  const message = error?.message ?? "";
  return /visibility/i.test(message) && /column|schema cache|could not find/i.test(message);
}

function columnList(columns: string, includeVisibility: boolean): string {
  const parts = columns
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part !== "visibility");
  if (!parts.includes("submitted_by")) parts.push("submitted_by");
  if (includeVisibility) parts.push("visibility");
  return parts.join(", ");
}

/**
 * Read expenses and drop rows this viewer cannot see.
 * If the visibility column is not in the database yet, rows come back with
 * visibility null and keep their current case-wide access. Nothing is rewritten.
 */
/** Copy the expense visibility onto a receipt the same parent uploaded. */
export async function alignReceiptDocumentVisibility(
  admin: { from: (table: string) => any },
  input: { receiptId: string | null | undefined; visibility: ExpenseVisibility | null; userId: string }
): Promise<void> {
  if (!input.receiptId || !input.visibility) return;
  const { data } = await admin
    .from("documents")
    .select("id, uploaded_by")
    .eq("id", input.receiptId)
    .maybeSingle();
  if (!data || data.uploaded_by !== input.userId) return;
  await admin
    .from("documents")
    .update({ visibility: input.visibility })
    .eq("id", input.receiptId)
    .eq("uploaded_by", input.userId);
}

export async function readExpenses(
  run: (columns: string) => ExpenseQueryResult,
  columns: string
): Promise<{ rows: LoadedExpense[]; error: QueryError }> {
  const first = await run(columnList(columns, true));
  if (missingVisibilityColumn(first.error)) {
    const second = await run(columnList(columns, false));
    const rows = (Array.isArray(second.data) ? second.data : []).map((row) => ({
      ...(row as LoadedExpense),
      visibility: null,
    }));
    return { rows, error: second.error };
  }
  if (first.error) return { rows: [], error: first.error };
  const rows = (Array.isArray(first.data) ? first.data : []) as LoadedExpense[];
  return { rows, error: null };
}

export async function loadVisibleExpenses(
  run: (columns: string) => ExpenseQueryResult,
  columns: string,
  viewer: ExpenseViewer
): Promise<{ rows: LoadedExpense[]; error: QueryError }> {
  const loaded = await readExpenses(run, columns);
  if (loaded.error) return { rows: [], error: loaded.error };
  return { rows: visibleExpenseRows(loaded.rows, viewer), error: null };
}
