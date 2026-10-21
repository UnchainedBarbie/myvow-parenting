import archiver from "archiver";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { documentAuthorizedForViewer, formatDocumentNumber } from "@/lib/documents-tab";
import {
  classifySupportingFile,
  supportingFileSentence,
  uniqueSupportingFiles,
  type SupportingFile,
} from "@/lib/reports/embed-attachments";
import {
  expenseEnteredInRange,
  formatExpenseNumber,
  sortExpensesForLedger,
  type ExpenseParty,
  type ExpenseReportOptions,
  type ExpenseReportSource,
} from "@/lib/reports/expense-report";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type ExpenseReportLoad = {
  expenses: ExpenseReportSource[];
  parents: ExpenseParty[];
  caseLabel: string;
  timeZone: string;
  viewerId: string;
  viewerName: string;
  receiptLines: string[];
  receiptFiles: SupportingFile[];
};

const DEFAULT_TIMEZONE = "America/Denver";

function safeZone(timeZone: string | null | undefined): string {
  const trimmed = timeZone?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function partyName(member: {
  display_name?: string | null;
  invited_name?: string | null;
  external_email?: string | null;
  invited_email?: string | null;
}, user: { full_name?: string | null; email?: string | null } | undefined): string {
  const name = member.display_name?.trim() || member.invited_name?.trim() || user?.full_name?.trim() || "";
  const email = member.external_email?.trim() || member.invited_email?.trim() || user?.email?.trim() || "";
  if (name && email) return `${name} (${email})`;
  return name || email;
}

function childNamesForExpense(
  expenseId: string,
  childId: string | null,
  childIdsByExpense: Map<string, string[]>,
  childById: Map<string, { first_name?: string | null; date_of_birth?: string | null }>
): string | null {
  const fromJunction = childIdsByExpense.get(expenseId) ?? [];
  const ids = fromJunction.length > 0 ? fromJunction : childId ? [childId] : [];
  const names = ids
    .map((id) => childById.get(id))
    .filter((child): child is { first_name?: string | null; date_of_birth?: string | null } => Boolean(child?.first_name))
    .sort((a, b) => {
      const dobA = a.date_of_birth?.trim() ?? "";
      const dobB = b.date_of_birth?.trim() ?? "";
      if (dobA && dobB && dobA !== dobB) return dobA < dobB ? -1 : 1;
      if (Boolean(dobA) !== Boolean(dobB)) return dobA ? -1 : 1;
      return (a.first_name ?? "").localeCompare(b.first_name ?? "", undefined, { sensitivity: "base" });
    })
    .map((child) => child.first_name?.trim() ?? "")
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : null;
}

export function expenseReportOptions(options: Record<string, boolean> | undefined): ExpenseReportOptions {
  const on = (key: string) => options?.[key] !== false;
  return {
    ledger: on("all_expenses"),
    payments: on("payment_records"),
    disputes: on("dispute_history"),
    netBalance: on("net_balance"),
    receiptsZip: on("receipts_zip"),
  };
}

export async function loadExpenseReport(input: {
  admin: Admin;
  caseId: string;
  userId: string;
  dateStart: string | null;
  dateEnd: string | null;
  options: ExpenseReportOptions;
  embedInPdf?: boolean;
}): Promise<ExpenseReportLoad> {
  const { admin, caseId, userId } = input;
  const [caseResult, memberResult, viewerResult, expenseResult] = await Promise.all([
    admin.from("cases").select("id, family_code").eq("id", caseId).maybeSingle(),
    admin
      .from("case_members")
      .select("user_id, display_name, invited_name, external_email, invited_email")
      .eq("case_id", caseId)
      .eq("role", "parent"),
    admin.from("users").select("id, full_name, email, timezone").eq("id", userId).maybeSingle(),
    admin
      .from("expenses")
      .select(
        "id, expense_number, created_at, incurred_date, description, category, category_description, amount, submitted_by, amount_owed, other_parent_share, other_parent_percent, split_label, allocation_status, status, dispute_reason, approved_by, approved_at, resolved_at, paid_at, payment_method, payment_reference, payment_notes, receipt_file_id"
      )
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (expenseResult.error) {
    throw new Error(expenseResult.error.message);
  }

  const timeZone = safeZone((viewerResult.data as { timezone?: string | null } | null)?.timezone);
  const familyCode = (caseResult.data as { family_code?: string | null } | null)?.family_code?.trim() || "";
  const members = (memberResult.data ?? []) as {
    user_id?: string | null;
    display_name?: string | null;
    invited_name?: string | null;
    external_email?: string | null;
    invited_email?: string | null;
  }[];
  const userIds = [
    ...new Set(
      members
        .map((member) => member.user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const rawExpenses = expenseResult.data ?? [];
  const relatedIds = [
    ...new Set(
      rawExpenses.flatMap((expense) => {
        const row = expense as { submitted_by?: string | null; approved_by?: string | null };
        return [row.submitted_by, row.approved_by].filter((id): id is string => Boolean(id));
      })
    ),
  ];
  const lookupIds = [...new Set([...userIds, ...relatedIds])];
  const userResult =
    lookupIds.length > 0
      ? await admin.from("users").select("id, full_name, email").in("id", lookupIds)
      : { data: [] as { id: string; full_name: string | null; email: string | null }[], error: null };
  const users = new Map(
    ((userResult.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((user) => [
      user.id,
      user,
    ])
  );
  const parents: ExpenseParty[] = members.map((member) => ({
    userId: member.user_id ?? null,
    name: partyName(member, member.user_id ? users.get(member.user_id) : undefined),
  }));
  const viewerUser = users.get(userId);
  const viewerMember = members.find((member) => member.user_id === userId);
  const viewerName = viewerMember
    ? partyName(viewerMember, viewerUser)
    : viewerUser?.full_name?.trim() || viewerUser?.email?.trim() || "";

  const expenseIds = rawExpenses.map((expense) => String((expense as { id: string }).id));
  const childIdsByExpense = new Map<string, string[]>();
  if (expenseIds.length > 0) {
    const { data: links } = await admin
      .from("expense_children")
      .select("expense_id, child_id")
      .in("expense_id", expenseIds);
    for (const link of links ?? []) {
      const expenseId = (link as { expense_id?: string }).expense_id;
      const childId = (link as { child_id?: string }).child_id;
      if (!expenseId || !childId) continue;
      const list = childIdsByExpense.get(expenseId) ?? [];
      list.push(childId);
      childIdsByExpense.set(expenseId, list);
    }
  }
  const { data: childRows } = await admin
    .from("children")
    .select("id, first_name, date_of_birth")
    .eq("case_id", caseId);
  const childById = new Map(
    ((childRows ?? []) as { id: string; first_name?: string | null; date_of_birth?: string | null }[]).map(
      (child) => [child.id, child]
    )
  );

  const receiptIds = [
    ...new Set(
      rawExpenses
        .map((expense) => (expense as { receipt_file_id?: string | null }).receipt_file_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const receiptDocs = new Map<
    string,
    {
      fileName: string | null;
      documentNumber: number | null;
      storagePath: string | null;
      mimeType: string | null;
      visibility: string | null;
      uploadedBy: string | null;
    }
  >();
  if (receiptIds.length > 0) {
    const { data } = await admin
      .from("documents")
      .select("id, file_name, document_number, storage_path, mime_type, visibility, uploaded_by")
      .in("id", receiptIds)
      .eq("case_id", caseId)
      .eq("status", "active")
      .is("deleted_at", null);
    for (const row of data ?? []) {
      const doc = row as {
        id: string;
        file_name?: string | null;
        document_number?: number | null;
        storage_path?: string | null;
        mime_type?: string | null;
        visibility?: string | null;
        uploaded_by?: string | null;
      };
      receiptDocs.set(doc.id, {
        fileName: doc.file_name ?? null,
        documentNumber: typeof doc.document_number === "number" ? doc.document_number : null,
        storagePath: doc.storage_path ?? null,
        mimeType: doc.mime_type ?? null,
        visibility: doc.visibility ?? null,
        uploadedBy: doc.uploaded_by ?? null,
      });
    }
  }

  const expenses: ExpenseReportSource[] = rawExpenses.map((expense) => {
    const row = expense as Record<string, unknown>;
    const receiptId = typeof row.receipt_file_id === "string" ? row.receipt_file_id : null;
    const receipt = receiptId ? receiptDocs.get(receiptId) : undefined;
    return {
      id: String(row.id),
      expenseNumber: typeof row.expense_number === "number" ? row.expense_number : null,
      createdAt: String(row.created_at ?? ""),
      incurredDate: typeof row.incurred_date === "string" ? row.incurred_date : null,
      description: typeof row.description === "string" ? row.description : "",
      category: typeof row.category === "string" ? row.category : "",
      categoryDescription: typeof row.category_description === "string" ? row.category_description : null,
      amount: row.amount as string | number | null,
      submittedBy: typeof row.submitted_by === "string" ? row.submitted_by : "",
      amountOwed: row.amount_owed as string | number | null,
      otherParentShare: row.other_parent_share as string | number | null,
      otherParentPercent: row.other_parent_percent as string | number | null,
      splitLabel: typeof row.split_label === "string" ? row.split_label : null,
      allocationStatus: typeof row.allocation_status === "string" ? row.allocation_status : null,
      status: typeof row.status === "string" ? row.status : "",
      disputeReason: typeof row.dispute_reason === "string" ? row.dispute_reason : null,
      approvedBy: typeof row.approved_by === "string" ? row.approved_by : null,
      approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
      resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null,
      paidAt: typeof row.paid_at === "string" ? row.paid_at : null,
      paymentMethod: typeof row.payment_method === "string" ? row.payment_method : null,
      paymentReference: typeof row.payment_reference === "string" ? row.payment_reference : null,
      paymentNotes: typeof row.payment_notes === "string" ? row.payment_notes : null,
      receiptName: receipt?.fileName ?? null,
      receiptDocumentNumber: receipt?.documentNumber ?? null,
      childName: childNamesForExpense(
        String(row.id),
        typeof row.child_id === "string" ? row.child_id : null,
        childIdsByExpense,
        childById
      ),
    };
  });

  const receiptLines: string[] = [];
  const receiptFiles: SupportingFile[] = [];
  if (input.options.receiptsZip) {
    const { data: viewerMember } = await admin
      .from("case_members")
      .select("role")
      .eq("case_id", caseId)
      .eq("user_id", userId)
      .maybeSingle();
    const viewerRole = (viewerMember as { role?: string | null } | null)?.role ?? null;
    const included = sortExpensesForLedger(
      expenses.filter((expense) =>
        expenseEnteredInRange(expense.createdAt, input.dateStart, input.dateEnd, timeZone)
      ),
      timeZone
    );
    const pending: SupportingFile[] = [];
    for (const expense of included) {
      const raw = rawExpenses.find((item) => String((item as { id: string }).id) === expense.id) as {
        receipt_file_id?: string | null;
      };
      if (!raw?.receipt_file_id) continue;
      const expenseLabel = formatExpenseNumber(expense.expenseNumber) || expense.id;
      const doc = receiptDocs.get(raw.receipt_file_id);
      const docLabel = doc ? formatDocumentNumber(doc.documentNumber) : "";
      const records = [expenseLabel, docLabel].filter((label) => label && label !== "—");
      pending.push({
        key: raw.receipt_file_id,
        records,
        fileName: doc?.fileName?.trim() || "receipt",
        mimeType: doc?.mimeType ?? null,
        bytes: null,
        unavailableReason: doc ? null : "The receipt document is missing or no longer active.",
      });
    }
    const unique = uniqueSupportingFiles(pending);
    for (const file of unique) {
      const doc = receiptDocs.get(file.key);
      const allowed =
        doc &&
        documentAuthorizedForViewer(
          { visibility: doc.visibility, uploadedBy: doc.uploadedBy },
          { userId, role: viewerRole }
        );
      if (!doc) {
        file.unavailableReason = "The receipt document is missing or no longer active.";
      } else if (!allowed) {
        file.unavailableReason = "This file is visible only to the parent who uploaded it.";
      } else if (!doc.storagePath) {
        file.unavailableReason = "No file is stored for this receipt.";
      } else {
        const { data, error } = await admin.storage.from("documents").download(doc.storagePath);
        if (error || !data) file.unavailableReason = "The file could not be downloaded.";
        else file.bytes = Buffer.from(await data.arrayBuffer());
      }
      const disposition = await classifySupportingFile(file);
      receiptLines.push(supportingFileSentence(file, disposition, input.embedInPdf !== false));
      receiptFiles.push(file);
    }
  }

  return {
    expenses,
    parents,
    caseLabel: familyCode || caseId,
    timeZone,
    viewerId: userId,
    viewerName,
    receiptLines,
    receiptFiles,
  };
}

export function zipReport(reportName: string, report: Buffer, files: { name: string; buffer: Buffer }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    archive.append(report, { name: reportName });
    for (const file of files) archive.append(file.buffer, { name: file.name });
    void archive.finalize();
  });
}
