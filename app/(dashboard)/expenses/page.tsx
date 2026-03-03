import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { ExpenseList, type ExpenseRow } from "@/components/expenses/expense-list";

export default async function ExpensesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = getServiceRoleClient();
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const caseId = membership?.case_id ?? null;

  if (!caseId) {
    return (
      <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
        <div className="mb-4">
          <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
            Expenses
          </h1>
          <p className="text-xs md:text-sm text-foreground-secondary leading-snug">
            Submit expenses with receipt upload, auto-split, and approve or dispute.
          </p>
        </div>
        <div className="rounded-card border border-border bg-background-secondary p-8 text-center">
          <p className="text-foreground-secondary">
            Create or join a case in Settings to track expenses.
          </p>
        </div>
      </div>
    );
  }

  const { data: caseRow } = await admin
    .from("cases")
    .select("custody_split_percent")
    .eq("id", caseId)
    .single();

  const custodySplitPercent = Number(caseRow?.custody_split_percent ?? 50);

  const { data: children } = await admin
    .from("children")
    .select("id, first_name, profile_image")
    .eq("case_id", caseId)
    .order("first_name");

  const { data: expensesRaw } = await admin
    .from("expenses")
    .select(
      "id, description, amount, category, child_id, amount_owed, status, created_at, submitted_by, receipt_file_id, dispute_reason, paid_at, payment_method, payment_reference, deleted_at"
    )
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const childIds = [...new Set((expensesRaw ?? []).map((e) => e.child_id).filter(Boolean))] as string[];
  const { data: childRows } =
    childIds.length > 0
      ? await admin
          .from("children")
          .select("id, first_name, profile_image")
          .in("id", childIds)
      : { data: [] };
  const childMap = (childRows ?? []).reduce(
    (acc, c) => {
      acc[c.id] = {
        first_name: c.first_name as string,
        profile_image: (c.profile_image as string | null) ?? null,
      };
      return acc;
    },
    {} as Record<string, { first_name: string; profile_image: string | null }>
  );

  const receiptIds = [
    ...new Set(
      (expensesRaw ?? [])
        .map((e) => e.receipt_file_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const { data: receiptDocs } =
    receiptIds.length > 0
      ? await admin
          .from("documents")
          .select("id, file_name")
          .in("id", receiptIds)
      : { data: [] };
  const receiptNameMap = (receiptDocs ?? []).reduce(
    (acc, row) => {
      const r = row as { id: string; file_name: string | null };
      acc[r.id] = r.file_name ?? null;
      return acc;
    },
    {} as Record<string, string | null>
  );

  const expenses: ExpenseRow[] = (expensesRaw ?? []).map((e) => ({
    id: e.id,
    description: e.description,
    amount: String(e.amount),
    category: e.category,
    child_id: e.child_id,
    child_name: e.child_id ? childMap[e.child_id]?.first_name ?? null : null,
    amount_owed: e.amount_owed != null ? String(e.amount_owed) : null,
    status: e.status,
    created_at: e.created_at,
    submitted_by: e.submitted_by,
    receipt_file_id: e.receipt_file_id,
    receipt_file_name:
      e.receipt_file_id && typeof e.receipt_file_id === "string"
        ? receiptNameMap[e.receipt_file_id] ?? null
        : null,
    dispute_reason: (e as any).dispute_reason ?? null,
  }));

  return (
    <div className="px-3 pt-3 pb-1 md:px-4 md:pt-4 md:pb-2">
      <div className="mb-4">
        <h1 className="font-heading text-xl md:text-2xl font-semibold text-foreground mb-1">
          Expenses
        </h1>
        <p className="text-xs md:text-sm text-foreground-secondary leading-snug">
          Track and split shared parenting expenses.
        </p>
      </div>
      <div className="space-y-2">
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,28%)_minmax(0,1fr)] items-start">
          <ExpenseForm
            caseId={caseId}
            children={children ?? []}
            custodySplitPercent={custodySplitPercent}
          />
          <ExpenseList
            expenses={expenses}
            currentUserId={user.id}
            custodySplitPercent={custodySplitPercent}
            children={children ?? []}
          />
        </div>
      </div>
    </div>
  );
}
