import { getServiceRoleClient } from "@/lib/supabase/server";

export type AllocationStatus = "ALLOCATED" | "NONE" | "MANUAL_REQUIRED";

type RuleType = "SPLIT_PERCENT" | "FIXED_AMOUNT" | "NONE" | "MANUAL";

interface ExpenseRuleRow {
  id: string;
  parenting_plan_id: string | null;
  case_id: string;
  category: string | null;
  child_scope: string | null;
  rule_type: RuleType;
  other_parent_percent: number | null;
  notes: string | null;
}

export interface ExpenseAllocationInput {
  caseId: string;
  amount: number;
  category: string;
  childId: string | null;
}

export interface ExpenseAllocationResult {
  allocation_status: AllocationStatus;
  other_parent_percent: number | null;
  other_parent_share: number | null;
  split_label: string | null;
}

/**
 * Compute allocation for an expense based on parenting plan rules.
 * Fallback: if no matching rule, treat as NONE (no allocation).
 */
export async function computeAllocationFromParentingPlan(
  input: ExpenseAllocationInput
): Promise<ExpenseAllocationResult> {
  const admin = getServiceRoleClient();

  // Find the most recent active parenting plan for this case.
  const { data: plan } = await admin
    .from("parenting_plans")
    .select("id")
    .eq("case_id", input.caseId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const planId = (plan as { id?: string } | null)?.id ?? null;

  const { data: rules } = await admin
    .from("parenting_plan_expense_rules")
    .select(
      "id, parenting_plan_id, case_id, category, child_scope, rule_type, other_parent_percent, notes"
    )
    .eq("case_id", input.caseId)
    .order("created_at", { ascending: true });

  const candidates: ExpenseRuleRow[] = (rules ?? []).filter((r) => {
    if (planId && r.parenting_plan_id && r.parenting_plan_id !== planId) {
      return false;
    }
    if (r.category && r.category !== input.category) {
      return false;
    }
    if (r.child_scope && r.child_scope !== input.childId) {
      return false;
    }
    return true;
  }) as ExpenseRuleRow[];

  let best: ExpenseRuleRow | null = null;
  let bestScore = -1;

  for (const rule of candidates) {
    let score = 0;
    if (rule.category === input.category) score += 2;
    if (rule.child_scope && rule.child_scope === input.childId) score += 3;
    if (!rule.child_scope) score += 1;
    if (!rule.category) score += 0;
    if (planId && rule.parenting_plan_id === planId) score += 1;

    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }

  if (!best) {
    return {
      allocation_status: "NONE",
      other_parent_percent: null,
      other_parent_share: 0,
      split_label: null,
    };
  }

  if (best.rule_type === "NONE") {
    return {
      allocation_status: "NONE",
      other_parent_percent: null,
      other_parent_share: 0,
      split_label: null,
    };
  }

  if (best.rule_type === "MANUAL") {
    return {
      allocation_status: "MANUAL_REQUIRED",
      other_parent_percent: null,
      other_parent_share: null,
      split_label: null,
    };
  }

  if (best.rule_type === "SPLIT_PERCENT") {
    const pct = typeof best.other_parent_percent === "number" ? best.other_parent_percent : 0;
    const shareRaw = input.amount * (pct / 100);
    const share = Math.round(shareRaw * 100) / 100;
    const splitLabel =
      pct > 0 && pct < 100 ? `${pct}/${100 - pct}` : pct === 0 ? "0/100" : "100/0";

    return {
      allocation_status: "ALLOCATED",
      other_parent_percent: pct,
      other_parent_share: share,
      split_label: splitLabel,
    };
  }

  // FIXED_AMOUNT and unhandled types fall back to MANUAL for now.
  return {
    allocation_status: "MANUAL_REQUIRED",
    other_parent_percent: null,
    other_parent_share: null,
    split_label: null,
  };
}

