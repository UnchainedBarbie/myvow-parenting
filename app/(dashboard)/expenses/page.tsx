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
      <div className="p-6 md:p-8">
        <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">
          Expenses
        </h1>
        <p className="text-foreground-secondary mb-8">
          Submit expenses with receipt upload, auto-split, and approve or dispute.
        </p>
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
    .select("id, first_name")
    .eq("case_id", caseId)
    .order("first_name");

  const { data: expensesRaw } = await admin
    .from("expenses")
    .select(
      "id, description, amount, category, child_id, amount_owed, status, created_at, submitted_by, receipt_file_id"
    )
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  const childIds = [...new Set((expensesRaw ?? []).map((e) => e.child_id).filter(Boolean))] as string[];
  const { data: childRows } =
    childIds.length > 0
      ? await admin
          .from("children")
          .select("id, first_name")
          .in("id", childIds)
      : { data: [] };
  const childMap = (childRows ?? []).reduce(
    (acc, c) => {
      acc[c.id] = c.first_name;
      return acc;
    },
    {} as Record<string, string>
  );

  const expenses: ExpenseRow[] = (expensesRaw ?? []).map((e) => ({
    id: e.id,
    description: e.description,
    amount: String(e.amount),
    category: e.category,
    child_id: e.child_id,
    child_name: e.child_id ? childMap[e.child_id] ?? null : null,
    amount_owed: e.amount_owed != null ? String(e.amount_owed) : null,
    status: e.status,
    created_at: e.created_at,
    submitted_by: e.submitted_by,
    receipt_file_id: e.receipt_file_id,
  }));

  return (
    <div className="p-6 md:p-8">
      <h1 className="font-heading text-2xl font-semibold text-foreground mb-2">
        Expenses
      </h1>
      <p className="text-foreground-secondary mb-8">
        Submit expenses with receipt upload. Split is based on your case custody
        agreement. Approve or dispute expenses from the other parent.
      </p>
      <div className="space-y-8">
        <ExpenseForm
          caseId={caseId}
          children={children ?? []}
          custodySplitPercent={custodySplitPercent}
        />
        <ExpenseList
          expenses={expenses}
          currentUserId={user.id}
          custodySplitPercent={custodySplitPercent}
        />
      </div>
    </div>
  );
}
