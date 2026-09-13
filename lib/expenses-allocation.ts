import { getServiceRoleClient } from "@/lib/supabase/server";

export type AllocationStatus = "ALLOCATED" | "NONE" | "MANUAL_REQUIRED";

function normalizeCategory(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isMedicalish(category: string): boolean {
  const c = normalizeCategory(category);
  return c === "medical" || c === "dental";
}

/** Dentist bills use medical; dental and medical share the same plan split. */
function categoriesCompatible(
  ruleCategory: string | null | undefined,
  inputCategory: string
): boolean {
  const a = normalizeCategory(ruleCategory);
  const b = normalizeCategory(inputCategory);
  if (!a || a === b) return true;
  return isMedicalish(a) && isMedicalish(b);
}

function asPercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function splitFromPercent(
  amount: number,
  pct: number
): ExpenseAllocationResult {
  const share = Math.round(amount * (pct / 100) * 100) / 100;
  const splitLabel =
    pct > 0 && pct < 100 ? `${pct}/${100 - pct}` : pct === 0 ? "0/100" : "100/0";
  return {
    allocation_status: pct > 0 ? "ALLOCATED" : "NONE",
    other_parent_percent: pct,
    other_parent_share: share,
    split_label: splitLabel,
  };
}

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
 * Live `expenses.allocation_status` check allows pending (and similar), not ALLOCATED/NONE.
 * Successful splits still store amount_owed + other_parent_percent; pending matches historical rows.
 */
export function allocationStatusForDb(status: AllocationStatus): string {
  if (status === "MANUAL_REQUIRED") return "MANUAL_REQUIRED";
  return "pending";
}

/**
 * Case-level percents from the parenting plan / court-order ingest.
 * Medical/dental use extraordinary_medical_split_percent; otherwise custody_split_percent.
 * This is what older "Add expense" rows used before per-category rule rows existed.
 */
async function allocationFromCaseDefaults(
  caseId: string,
  amount: number,
  category: string
): Promise<ExpenseAllocationResult> {
  const admin = getServiceRoleClient();
  const { data: caseRow } = await admin
    .from("cases")
    .select("custody_split_percent, extraordinary_medical_split_percent")
    .eq("id", caseId)
    .maybeSingle();

  const medicalPct = asPercent(
    (caseRow as { extraordinary_medical_split_percent?: unknown } | null)
      ?.extraordinary_medical_split_percent
  );
  const custodyPct = asPercent(
    (caseRow as { custody_split_percent?: unknown } | null)?.custody_split_percent
  );

  // Medical/dental follow the extraordinary-medical split (else the general custody split).
  // Other categories without a matching rule row stay unallocated — same as historical
  // "Add expense" rows for non-medical (e.g. DMV) that stored $0 share.
  if (!isMedicalish(category)) {
    return {
      allocation_status: "NONE",
      other_parent_percent: null,
      other_parent_share: 0,
      split_label: null,
    };
  }

  const pct = medicalPct ?? custodyPct;
  if (pct == null) {
    return {
      allocation_status: "NONE",
      other_parent_percent: null,
      other_parent_share: 0,
      split_label: null,
    };
  }
  return splitFromPercent(amount, pct);
}

/**
 * Compute allocation for an expense based on parenting plan rules.
 * If per-category rules are missing (table not migrated, or no matching row),
 * fall back to the case's medical / custody split percents — the same source
 * the original Add-expense path used.
 */
export async function computeAllocationFromParentingPlan(
  input: ExpenseAllocationInput
): Promise<ExpenseAllocationResult> {
  const admin = getServiceRoleClient();

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

  if (rulesError || !rules || rules.length === 0) {
    if (rulesError) {
      console.warn(
        "[expenses-allocation] plan rules unavailable, using case split:",
        rulesError.message
      );
    }
    return allocationFromCaseDefaults(input.caseId, input.amount, input.category);
  }

  const candidates: ExpenseRuleRow[] = (rules ?? []).filter((r) => {
    if (planId && r.parenting_plan_id && r.parenting_plan_id !== planId) {
      return false;
    }
    if (r.category && !categoriesCompatible(r.category, input.category)) {
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
    if (rule.category && categoriesCompatible(rule.category, input.category)) {
      score += 2;
    }
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
    return allocationFromCaseDefaults(input.caseId, input.amount, input.category);
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
    const pct = asPercent(best.other_parent_percent);
    if (pct == null) {
      return allocationFromCaseDefaults(input.caseId, input.amount, input.category);
    }
    return splitFromPercent(input.amount, pct);
  }

  return {
    allocation_status: "MANUAL_REQUIRED",
    other_parent_percent: null,
    other_parent_share: null,
    split_label: null,
  };
}
