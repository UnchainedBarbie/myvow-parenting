/**
 * Run with: npx tsx lib/sage/inbound-expense.test.ts
 */
import assert from "node:assert/strict";
import { plan } from "./planner";
import {
  applyInboundExpenseGate,
  EXPENSE_REMINDER_REPLY,
  inboundExpenseKind,
} from "./inbound-expense";

const REMINDER =
  "Hi, just a friendly reminder that there are outstanding shared expenses totaling $392.49. Could you please review and confirm when you get a chance? Thank you.";

assert.equal(inboundExpenseKind(REMINDER), "reminder");
assert.equal(inboundExpenseKind("I paid $85 for the dentist visit."), "new");
assert.equal(inboundExpenseKind("Here is the receipt for the $40 copay."), "new");
assert.equal(
  inboundExpenseKind("Your co-parent shared an orthodontic receipt for $612."),
  "new"
);
assert.equal(inboundExpenseKind("Can you cover half the dentist bill?"), "none");
assert.equal(inboundExpenseKind("Expenses came to $50."), "unclear");
assert.equal(
  inboundExpenseKind("Just a reminder that I paid $85 for the dentist."),
  "unclear"
);

const blank = {
  item_type: "needs_review",
  tool_name: null,
  action_required: false,
  action_type: null,
};

const logged = applyInboundExpenseGate({ ...blank }, "I paid $85 for the dentist visit.", true);
assert.equal(logged.item_type, "expense");
assert.equal(logged.tool_name, "expense");

const reminder = applyInboundExpenseGate(
  { item_type: "expense", tool_name: "expense", action_required: true, action_type: "pay" },
  REMINDER,
  true
);
assert.equal(reminder.item_type, "needs_response");
assert.equal(reminder.tool_name, null);
assert.equal(reminder.action_type, "respond");

const unclear = applyInboundExpenseGate(
  { item_type: "expense", tool_name: "expense", action_required: true, action_type: "pay" },
  "Can you cover half the dentist bill?",
  true
);
assert.equal(unclear.item_type, "needs_response");

const parent = applyInboundExpenseGate({ ...blank }, "Please log this expense of $40.", false);
assert.equal(parent.item_type, "expense");

async function main() {
  const planned = await plan({
    item_type: "expense",
    domain: "expense",
    action_required: true,
    action_type: "pay",
    summary: "Your co-parent says outstanding shared expenses total $392.49.",
    message_text: REMINDER,
    child_ids: [],
    unresolved_children: [],
    resolved_dates: [],
    sender: "your co-parent",
    source_type: "message",
  });
  assert.equal(
    planned.proposals.some((proposal) => proposal.type === "log_expense"),
    false
  );
  const reply = planned.proposals.find((proposal) => proposal.type === "reply_coparent");
  assert.equal(reply?.draft, EXPENSE_REMINDER_REPLY);
  assert.doesNotMatch(reply?.draft ?? "", /392\.49|outstanding/i);
  console.log("inbound-expense.test.ts: all assertions passed");
}

void main();
