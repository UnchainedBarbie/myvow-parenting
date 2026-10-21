import { getServiceRoleClient } from "@/lib/supabase/server";
import {
  resolveExpenseSharing,
  type SharingResult,
  type SharingRule,
} from "@/lib/expenses-sharing";

export type ExpenseAllocationResult = SharingResult;

export interface ExpenseAllocationInput {
  caseId: string;
  amount: number;
  category: string;
  childId: string | null;
}

/**
 * Live `expenses.allocation_status` values are stored as pending for a resolved split.
 * UNRESOLVED and MANUAL_REQUIRED are not saved; the caller asks before writing a row.
 */
export function allocationStatusForDb(status: "ALLOCATED" | "NONE" | "MANUAL_REQUIRED"): string {
  if (status === "MANUAL_REQUIRED") return "MANUAL_REQUIRED";
  return "pending";
}

function asPercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Compute allocation from this case's parenting-plan rules and healthcare percents.
 * Therapy uses the healthcare class. A missing rule is UNRESOLVED, not a $0 share.
 */
export async function computeAllocationFromParentingPlan(
  input: ExpenseAllocationInput
): Promise<ExpenseAllocationResult> {
  const admin = getServiceRoleClient();

  const { data: caseRow } = await admin
    .from("cases")
    .select("custody_split_percent, extraordinary_medical_split_percent")
    .eq("id", input.caseId)
    .maybeSingle();

  const defaults = {
    extraordinaryMedicalPercent: asPercent(
      (caseRow as { extraordinary_medical_split_percent?: unknown } | null)
        ?.extraordinary_medical_split_percent
    ),
    custodySplitPercent: asPercent(
      (caseRow as { custody_split_percent?: unknown } | null)?.custody_split_percent
    ),
  };

  const { data: plan } = await admin
    .from("parenting_plans")
    .select("id")
    .eq("case_id", input.caseId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const planId = (plan as { id?: string } | null)?.id ?? null;

  const { data: rules, error: rulesError } = await admin
    .from("parenting_plan_expense_rules")
    .select(
      "id, parenting_plan_id, case_id, category, child_scope, rule_type, other_parent_percent, notes"
    )
    .eq("case_id", input.caseId)
    .order("created_at", { ascending: true });

  if (rulesError) {
    console.warn(
      "[expenses-allocation] plan rules unavailable, using case split:",
      rulesError.message
    );
  }

  const sharingRules: SharingRule[] = rulesError
    ? []
    : ((rules ?? []) as SharingRule[]);

  return resolveExpenseSharing({
    amount: input.amount,
    category: input.category,
    childId: input.childId,
    rules: sharingRules,
    activePlanId: planId,
    defaults,
  });
}
