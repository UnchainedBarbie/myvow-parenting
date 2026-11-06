import { looksLikeExpenseCommand, parseExpenseAmountFromText } from "@/lib/expenses-share";

export type InboundExpenseKind = "new" | "reminder" | "unclear" | "none";

/** Acknowledgement. It does not repeat the sender's total. */
export const EXPENSE_REMINDER_REPLY = "I'll review them.";

/**
 * An inbound message is a new expense only when the sender is reporting a cost
 * to record. A reminder of expenses already on the books is not that. Anything
 * else that mentions money or expenses is unclear, and nothing should be logged.
 */
export function inboundExpenseKind(text: string): InboundExpenseKind {
  const body = text.replace(/\s+/g, " ").trim();
  if (!body) return "none";
  const reminder = remindsRecordedExpenses(body);
  const reported = reportsNewExpense(body);
  if (reminder && reported) return "unclear";
  if (reminder) return "reminder";
  if (reported) return "new";
  if (/\bexpenses?\b/i.test(body) || /\$\s*\d/.test(body)) return "unclear";
  return "none";
}

export function expenseReminderNotice(text: string): string {
  const amount = parseExpenseAmountFromText(text);
  if (amount != null) {
    return `Your co-parent says outstanding shared expenses total $${amount.toFixed(2)} and asks you to review them.`;
  }
  return "Your co-parent is reminding you about outstanding shared expenses and asks you to review them.";
}

type ExpenseIntent = {
  item_type: string;
  tool_name: string | null;
  action_required: boolean;
  action_type?: string | null;
};

/**
 * User commands keep the existing expense detection. An inbound message is logged
 * only when it is confidently a new expense. A reminder, or an unclear mention,
 * is a reply, not a ledger row.
 */
export function applyInboundExpenseGate<T extends ExpenseIntent>(
  intent: T,
  message: string,
  inbound: boolean
): T {
  if (!inbound) {
    if (
      intent.item_type !== "expense" &&
      (intent.tool_name === "expense" || looksLikeExpenseCommand(message))
    ) {
      intent.item_type = "expense";
      intent.tool_name = "expense";
      intent.action_required = true;
    }
    return intent;
  }
  if (inboundExpenseKind(message) === "new") {
    intent.item_type = "expense";
    intent.tool_name = "expense";
    intent.action_required = true;
    return intent;
  }
  const wouldLog =
    intent.item_type === "expense" ||
    intent.tool_name === "expense" ||
    looksLikeExpenseCommand(message);
  if (!wouldLog) return intent;
  intent.item_type = "needs_response";
  intent.tool_name = null;
  intent.action_required = true;
  intent.action_type = "respond";
  return intent;
}

function remindsRecordedExpenses(text: string): boolean {
  return (
    /\breminders?\b/i.test(text) ||
    /\boutstanding\b/i.test(text) ||
    /\balready (?:recorded|logged|submitted|entered|saved)\b/i.test(text) ||
    /\b(?:on|in) the (?:ledger|books)\b/i.test(text) ||
    /\bthere are\b[^.]{0,80}\bexpenses?\b/i.test(text) ||
    /\bexpenses?\b[^.]{0,40}\b(?:total(?:ing)?|balance)\b/i.test(text) ||
    /\b(?:total(?:ing)?|balance)\b[^.]{0,40}\bexpenses?\b/i.test(text) ||
    /\breview\b[^.]{0,40}\bexpenses?\b/i.test(text) ||
    /\bexpenses?\b[^.]{0,48}\b(?:review|confirm)\b/i.test(text)
  );
}

function reportsNewExpense(text: string): boolean {
  return (
    /\b(?:i|we|i've|we've)\s+(?:just\s+)?(?:paid|spent|incurred)\b/i.test(text) ||
    /\breceipt\b/i.test(text) ||
    /\breimburse(?:ment)?\b/i.test(text) ||
    /\b(?:submitting|submit)\b[^.]{0,40}\bexpense\b/i.test(text) ||
    /\b(?:log|record)\b[^.]{0,24}\b(?:expense|receipt|bill)\b/i.test(text) ||
    /\b(?:bill|charge|cost)\s+(?:is|was)\b[^.]{0,24}\$\d/i.test(text) ||
    /\bcharged\s+\$\d/i.test(text)
  );
}
