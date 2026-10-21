/**
 * Case sharing rules for an expense. Pure: no database and no server imports.
 * Therapy stays the stored category. It uses the healthcare sharing class
 * (medical, dental, therapy) so a Health / extraordinary-medical rule applies.
 */

export type ExpensePayer = "self" | "coparent";

export type SharingAllocationStatus =
  | "ALLOCATED"
  | "NONE"
  | "MANUAL_REQUIRED"
  | "UNRESOLVED";

export type SharingRuleType = "SPLIT_PERCENT" | "FIXED_AMOUNT" | "NONE" | "MANUAL";

export type SharingRule = {
  id?: string;
  parenting_plan_id?: string | null;
  category: string | null;
  child_scope: string | null;
  rule_type: SharingRuleType | string;
  other_parent_percent: number | null;
};

export type CaseSplitDefaults = {
  extraordinaryMedicalPercent: number | null;
  custodySplitPercent: number | null;
};

export type SharingInput = {
  amount: number;
  category: string;
  childId: string | null;
  rules: SharingRule[];
  activePlanId?: string | null;
  defaults: CaseSplitDefaults;
};

export type SharingResult = {
  allocation_status: SharingAllocationStatus;
  other_parent_percent: number | null;
  /** Co-parent's portion of the cost, in dollars. Null when the rule cannot be applied. */
  other_parent_share: number | null;
  split_label: string | null;
  /** Question to ask before saving. Set only when the expense must not be saved yet. */
  clarification: string | null;
};

export type SavedExpenseShare = {
  allocation_status: "ALLOCATED" | "NONE";
  other_parent_percent: number | null;
  other_parent_share: number;
  split_label: string;
  /** Positive when the logger paid. Negative when the other parent paid and the logger owes their own portion. */
  amount_owed: number;
};

export type ExpenseLoggingIntent = "personal" | "shared" | "unspecified";

export type ExpenseEntryMode = "personal" | "shared" | "choose" | "ask_percent";

export type ExpenseEntryPlan = {
  mode: ExpenseEntryMode;
  /** Default or the parent's explicit notification choice. */
  notifyCoparent: boolean;
  /** Dollar fields when the expense can be saved. Null when the form still needs a choice or a percentage. */
  fields: SavedExpenseShare | null;
  review: string;
  needsPercent: boolean;
  /** True when a case rule produced the split. A typed percentage is not a case rule. */
  ruleApplied: boolean;
};

export type PayerDecision =
  | { kind: "self" }
  | { kind: "coparent"; name: string }
  | { kind: "ask"; question: string };

const HEALTHCARE = new Set(["medical", "dental", "therapy"]);

export function isHealthcareCategory(category: string | null | undefined): boolean {
  return HEALTHCARE.has(normalizeCategory(category));
}

export function categoriesShareRule(
  ruleCategory: string | null | undefined,
  expenseCategory: string | null | undefined
): boolean {
  const rule = normalizeCategory(ruleCategory);
  const expense = normalizeCategory(expenseCategory);
  if (!rule || rule === expense) return true;
  return isHealthcareCategory(rule) && isHealthcareCategory(expense);
}

export function resolveExpenseSharing(input: SharingInput): SharingResult {
  const amount = Number(input.amount);
  const category = normalizeCategory(input.category) || "other";
  if (!Number.isFinite(amount) || amount <= 0) {
    return unresolved("What was the amount of this expense?");
  }

  const planId = input.activePlanId ?? null;
  const candidates = input.rules.filter((rule) => ruleMatches(rule, input.childId, category, planId));
  const specific = candidates.filter((rule) => normalizeCategory(rule.category));
  const general = candidates.filter((rule) => !normalizeCategory(rule.category));

  const specificDecision = decideRules(specific, input.childId, category, planId);
  if (specificDecision.kind === "ambiguous") {
    return unresolved(
      `More than one sharing rule could apply to ${categoryLabel(category)}, and they disagree. Which percentage should the other parent pay?`
    );
  }
  if (specificDecision.kind === "rule") {
    return applyRule(specificDecision.rule, amount, category, input.defaults);
  }

  if (isHealthcareCategory(category)) {
    const pct = healthcarePercent(input.defaults);
    if (pct != null) return splitFromPercent(amount, pct);
  }

  const generalDecision = decideRules(general, input.childId, category, planId);
  if (generalDecision.kind === "ambiguous") {
    return unresolved(
      `More than one sharing rule could apply to ${categoryLabel(category)}, and they disagree. Which percentage should the other parent pay?`
    );
  }
  if (generalDecision.kind === "rule") {
    return applyRule(generalDecision.rule, amount, category, input.defaults);
  }

  if (isHealthcareCategory(category)) {
    return unresolved(
      `I don't have a healthcare sharing percentage for ${categoryLabel(category)} on this case. What percentage should the other parent pay?`
    );
  }
  return unresolved(
    `I don't have a sharing rule for ${categoryLabel(category)} on this case. What percentage should the other parent pay?`
  );
}

export function savedExpenseShare(
  result: SharingResult,
  amount: number,
  payer: ExpensePayer
): { saveable: true; fields: SavedExpenseShare } | { saveable: false; clarification: string } {
  if (result.allocation_status !== "ALLOCATED" && result.allocation_status !== "NONE") {
    return {
      saveable: false,
      clarification:
        result.clarification?.trim() ||
        "I need a sharing percentage before I can log this expense.",
    };
  }
  const other = roundCents(result.other_parent_share ?? 0);
  const loggerShare = roundCents(amount - other);
  return {
    saveable: true,
    fields: {
      allocation_status: result.allocation_status,
      other_parent_percent: result.other_parent_percent,
      other_parent_share: other,
      split_label: result.split_label ?? (other === 0 ? "0/100" : ""),
      amount_owed: payer === "coparent" ? -loggerShare : other,
    },
  };
}

export function expenseSplitReview(input: {
  result: SharingResult;
  amount: number;
  payer: ExpensePayer;
  payerName?: string | null;
}): string {
  const saved = savedExpenseShare(input.result, input.amount, input.payer);
  if (!saved.saveable) return saved.clarification;
  const { split_label, other_parent_share, amount_owed } = saved.fields;
  if (input.payer === "coparent") {
    const name = input.payerName?.trim() || "The other parent";
    return `${name} paid. Split ${split_label}. Your share is $${Math.abs(amount_owed).toFixed(2)}.`;
  }
  return `Split ${split_label}. The other parent's share is $${other_parent_share.toFixed(2)}.`;
}

export function detectExpenseLoggingIntent(text: string): {
  intent: ExpenseLoggingIntent;
  statedPercent: number | null;
  notify: boolean | null;
  /** True when the message asks for a personal log and a shared split. */
  conflict: boolean;
} {
  const personal =
    /\b(just log|for my records|my own records|personal(?:ly)?|don'?t share|do not share|not a shared|no reimbursement|not requesting reimbursement)\b/i.test(
      text
    );
  const shared =
    /\b(owes|owe|split|shared expense|share this|reimburse|their share|co-?parent owes)\b/i.test(text) ||
    /\bhalf\b/i.test(text) ||
    /\d+(?:\.\d+)?\s*%/.test(text);
  const conflict = personal && shared;
  let intent: ExpenseLoggingIntent = "unspecified";
  if (conflict) intent = "unspecified";
  else if (personal) intent = "personal";
  else if (shared) intent = "shared";

  let notify: boolean | null = null;
  if (/\b(don'?t|do not|dont) notify\b/i.test(text) || /\bwithout notifying\b/i.test(text)) {
    notify = false;
  } else if (/\bnotify\b/i.test(text)) {
    notify = true;
  }
  return { intent, statedPercent: statedSharePercent(text), notify, conflict };
}

/**
 * Decide whether an expense is a personal log, a shared split, a choice, or a request for a percentage.
 * A missing rule is a choice. It is not a zero share and it is not an error.
 */
export function planExpenseEntry(input: {
  intent: ExpenseLoggingIntent;
  statedPercent: number | null;
  notifyOverride: boolean | null;
  conflict?: boolean;
  allocation: SharingResult;
  amount: number;
  payer: ExpensePayer;
  payerName?: string | null;
}): ExpenseEntryPlan {
  if (input.conflict) {
    return {
      mode: "choose",
      notifyCoparent: false,
      needsPercent: false,
      ruleApplied: false,
      fields: null,
      review: "Choose Personal log or Shared expense.",
    };
  }

  if (input.intent === "personal") {
    const notifyCoparent = input.notifyOverride === true;
    return {
      mode: "personal",
      notifyCoparent,
      needsPercent: false,
      ruleApplied: false,
      fields: personalFields(),
      review: withNotify(
        "Personal log. This does not change the co-parent balance.",
        notifyCoparent
      ),
    };
  }

  const ruleResolved =
    input.allocation.allocation_status === "ALLOCATED" || input.allocation.allocation_status === "NONE";
  if (ruleResolved) {
    const notifyCoparent = input.notifyOverride ?? true;
    const saved = savedExpenseShare(input.allocation, input.amount, input.payer);
    const review = saved.saveable
      ? expenseSplitReview({
          result: input.allocation,
          amount: input.amount,
          payer: input.payer,
          payerName: input.payerName,
        })
      : input.allocation.clarification ?? "I need a sharing percentage before I can log this expense.";
    return {
      mode: "shared",
      notifyCoparent,
      needsPercent: false,
      ruleApplied: true,
      fields: saved.saveable ? saved.fields : null,
      review: withNotify(review, notifyCoparent),
    };
  }

  if (input.statedPercent != null) {
    const stated = splitFromPercent(input.amount, input.statedPercent);
    if (stated.allocation_status === "ALLOCATED" || stated.allocation_status === "NONE") {
      const notifyCoparent = input.notifyOverride ?? true;
      const saved = savedExpenseShare(stated, input.amount, input.payer);
      const review = saved.saveable
        ? expenseSplitReview({
            result: stated,
            amount: input.amount,
            payer: input.payer,
            payerName: input.payerName,
          })
        : stated.clarification ?? "What percentage should the other parent pay?";
      return {
        mode: "shared",
        notifyCoparent,
        needsPercent: false,
        ruleApplied: false,
        fields: saved.saveable ? saved.fields : null,
        review: withNotify(review, notifyCoparent),
      };
    }
  }

  const notifyCoparent = input.notifyOverride ?? input.intent === "shared";
  if (input.intent === "shared" || input.allocation.allocation_status === "MANUAL_REQUIRED") {
    const question =
      input.allocation.clarification?.trim() ||
      "What percentage should the other parent pay?";
    return {
      mode: "ask_percent",
      notifyCoparent,
      needsPercent: true,
      ruleApplied: false,
      fields: null,
      review: withNotify(question, notifyCoparent),
    };
  }

  if (input.allocation.allocation_status === "UNRESOLVED" && /disagree/i.test(input.allocation.clarification ?? "")) {
    return {
      mode: "ask_percent",
      notifyCoparent,
      needsPercent: true,
      ruleApplied: false,
      fields: null,
      review: withNotify(
        input.allocation.clarification ?? "Which percentage should the other parent pay?",
        notifyCoparent
      ),
    };
  }

  return {
    mode: "choose",
    notifyCoparent: false,
    needsPercent: false,
    ruleApplied: false,
    fields: null,
    review: "No sharing rule applies. Choose Personal log or Shared expense.",
  };
}

export function detectExpensePayer(
  text: string,
  coparents: { name: string }[],
  children: { name: string }[] = []
): PayerDecision {
  const self = /\b(i|i've|i have|we|we've|we have)\s+(just\s+)?(paid|pay|spent|spend)\b/i.test(text);
  const named = coparents.filter((coparent) => personPaid(text, coparent.name));
  const childPaid = children.some((child) => personPaid(text, child.name));
  const otherParent =
    /\b(co-?parent|other parent)\s+(just\s+)?(paid|spent|pay|spend)\b/i.test(text) ||
    /\b(paid|spent|pay|spend)\s+by\s+(the\s+)?(co-?parent|other parent)\b/i.test(text);

  if (childPaid && named.length === 0) {
    return { kind: "ask", question: "Who paid this expense?" };
  }
  if (otherParent && named.length === 0) {
    if (self) return { kind: "ask", question: "Who paid this expense?" };
    if (coparents.length === 1) return { kind: "coparent", name: coparents[0].name };
    return { kind: "ask", question: "Which parent paid this expense?" };
  }
  if (named.length > 1 || (named.length === 1 && self)) {
    return { kind: "ask", question: "Who paid this expense?" };
  }
  if (named.length === 1) return { kind: "coparent", name: named[0].name };

  const unknown = text.match(/\b([A-Z][a-z]+)\s+(?:just\s+)?(?:paid|spent)\b/);
  if (unknown && !/^(I|We)$/.test(unknown[1])) {
    const token = unknown[1];
    const knownChild = children.some((child) => nameToken(child.name) === token.toLowerCase());
    if (!knownChild) {
      return {
        kind: "ask",
        question: `I don't know whether ${token} is the other parent on this case. Who paid this expense?`,
      };
    }
  }
  return { kind: "self" };
}

export type HistoricalSharingGap = "healthcare_zero_without_split" | "category_zero_without_split";

/** Rows saved before a sharing rule was applied. Identification only — do not rewrite them. */
export function historicalSharingGap(row: {
  category: string | null;
  split_label: string | null;
  other_parent_share: number | string | null;
  amount_owed: number | string | null;
}): HistoricalSharingGap | null {
  const label = (row.split_label ?? "").trim();
  if (label) return null;
  const stored = numberOrNull(row.other_parent_share);
  const owed = numberOrNull(row.amount_owed);
  const noDollarShare = (stored == null || stored === 0) && (owed == null || owed === 0);
  if (!noDollarShare) return null;
  if (isHealthcareCategory(row.category)) return "healthcare_zero_without_split";
  return "category_zero_without_split";
}

function decideRules(
  rules: SharingRule[],
  childId: string | null,
  category: string,
  planId: string | null
): { kind: "none" } | { kind: "ambiguous" } | { kind: "rule"; rule: SharingRule } {
  if (rules.length === 0) return { kind: "none" };
  let bestScore = -1;
  for (const rule of rules) {
    bestScore = Math.max(bestScore, ruleScore(rule, childId, category, planId));
  }
  const best = rules.filter((rule) => ruleScore(rule, childId, category, planId) === bestScore);
  const decided = best
    .map((rule) => ({ rule, key: outcomeKey(rule) }))
    .filter((item): item is { rule: SharingRule; key: string } => item.key != null);
  const keys = new Set(decided.map((item) => item.key));
  if (keys.size > 1) return { kind: "ambiguous" };
  if (keys.size === 1) return { kind: "rule", rule: decided[0].rule };
  return { kind: "none" };
}

function applyRule(
  rule: SharingRule,
  amount: number,
  category: string,
  defaults: CaseSplitDefaults
): SharingResult {
  const type = String(rule.rule_type || "").toUpperCase();
  if (type === "NONE") return explicitZero();
  if (type === "MANUAL" || type === "FIXED_AMOUNT") {
    return {
      allocation_status: "MANUAL_REQUIRED",
      other_parent_percent: null,
      other_parent_share: null,
      split_label: null,
      clarification: `The parenting plan says the split for ${categoryLabel(category)} has to be decided for each expense. What percentage should the other parent pay?`,
    };
  }
  if (type === "SPLIT_PERCENT") {
    const pct = asPercent(rule.other_parent_percent);
    if (pct == null) {
      if (isHealthcareCategory(category)) {
        const fallback = healthcarePercent(defaults);
        if (fallback != null) return splitFromPercent(amount, fallback);
      }
      return unresolved(
        `The sharing rule for ${categoryLabel(category)} does not include a percentage. What percentage should the other parent pay?`
      );
    }
    return splitFromPercent(amount, pct);
  }
  return {
    allocation_status: "MANUAL_REQUIRED",
    other_parent_percent: null,
    other_parent_share: null,
    split_label: null,
    clarification: `The parenting plan says the split for ${categoryLabel(category)} has to be decided for each expense. What percentage should the other parent pay?`,
  };
}

function splitFromPercent(amount: number, pct: number): SharingResult {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return unresolved(
      "The sharing percentage on this case isn't between 0 and 100. What percentage should the other parent pay?"
    );
  }
  const share = roundCents(amount * (pct / 100));
  return {
    allocation_status: pct > 0 ? "ALLOCATED" : "NONE",
    other_parent_percent: pct,
    other_parent_share: share,
    split_label: `${formatPct(pct)}/${formatPct(100 - pct)}`,
    clarification: null,
  };
}

function personalFields(): SavedExpenseShare {
  return {
    allocation_status: "NONE",
    other_parent_percent: 0,
    other_parent_share: 0,
    split_label: "Personal",
    amount_owed: 0,
  };
}

function withNotify(review: string, notify: boolean): string {
  const sentence = review.trim().replace(/\.$/, "");
  return `${sentence}. Notify co-parent: ${notify ? "on" : "off"}.`;
}

function statedSharePercent(text: string): number | null {
  if (/\bhalf\b/i.test(text)) return 50;
  const percent = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percent) {
    const value = Number(percent[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 100) return value;
  }
  const ratio = text.match(/\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\b/);
  if (ratio) {
    const left = Number(ratio[1]);
    const right = Number(ratio[2]);
    if (Number.isFinite(left) && Number.isFinite(right) && Math.abs(left + right - 100) < 0.01) {
      return left;
    }
  }
  return null;
}

function explicitZero(): SharingResult {
  return {
    allocation_status: "NONE",
    other_parent_percent: 0,
    other_parent_share: 0,
    split_label: "0/100",
    clarification: null,
  };
}

function unresolved(clarification: string): SharingResult {
  return {
    allocation_status: "UNRESOLVED",
    other_parent_percent: null,
    other_parent_share: null,
    split_label: null,
    clarification,
  };
}

function ruleMatches(
  rule: SharingRule,
  childId: string | null,
  category: string,
  planId: string | null
): boolean {
  if (planId && rule.parenting_plan_id && rule.parenting_plan_id !== planId) return false;
  if (rule.child_scope && rule.child_scope !== childId) return false;
  const ruleCategory = normalizeCategory(rule.category);
  if (ruleCategory && !categoriesShareRule(ruleCategory, category)) return false;
  return true;
}

function ruleScore(
  rule: SharingRule,
  childId: string | null,
  category: string,
  planId: string | null
): number {
  let score = 0;
  const ruleCategory = normalizeCategory(rule.category);
  if (ruleCategory && ruleCategory === category) score += 5;
  else if (ruleCategory && isHealthcareCategory(ruleCategory) && isHealthcareCategory(category)) score += 4;
  else if (!ruleCategory) score += 1;
  if (rule.child_scope && rule.child_scope === childId) score += 3;
  else if (!rule.child_scope) score += 1;
  if (planId && rule.parenting_plan_id === planId) score += 1;
  return score;
}

function outcomeKey(rule: SharingRule): string | null {
  const type = String(rule.rule_type || "").toUpperCase();
  if (type === "NONE") return "NONE";
  if (type === "MANUAL" || type === "FIXED_AMOUNT") return "MANUAL";
  if (type === "SPLIT_PERCENT") {
    const pct = asPercent(rule.other_parent_percent);
    return pct == null ? null : `SPLIT:${pct}`;
  }
  return "MANUAL";
}

function healthcarePercent(defaults: CaseSplitDefaults): number | null {
  return defaults.extraordinaryMedicalPercent ?? defaults.custodySplitPercent;
}

function personPaid(text: string, name: string): boolean {
  const token = nameToken(name);
  if (!token || token.length < 2) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\b${escaped}\\b(?:\\s+\\w+){0,3}\\s+(?:just\\s+)?(?:paid|spent|pay|spend)\\b|\\b(?:paid|spent|pay|spend)\\s+by\\s+${escaped}\\b`,
    "i"
  );
  return pattern.test(text);
}

function nameToken(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function categoryLabel(category: string): string {
  const normalized = normalizeCategory(category);
  if (!normalized || normalized === "other") return "this category";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeCategory(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function asPercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatPct(pct: number): string {
  const rounded = Math.round(pct * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/\.?0+$/, "");
}
