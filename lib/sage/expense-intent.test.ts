import assert from "node:assert/strict";
import { buildExpenseInitialValues } from "@/components/sage/proposal-helpers";
import type { SageItem, SageProposal } from "@/components/sage/proposal-types";
import { routeChatIntent } from "@/lib/sage/chat-intent";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import type { ProcessObservationResult } from "@/lib/sage/process-observation";

const today = new Date("2026-10-21T18:00:00Z");
const timezone = "America/Denver";
const ashley = { id: "child-ashley", name: "Ashley" };
const avery = { id: "child-avery", name: "Avery" };
const children = [ashley, avery];
const kevin = { name: "Kevin", email: "kevin@example.com" };

function expenseCard(result: ReturnType<typeof routeChatIntent>) {
  return result.result.plan.proposals.find((p) => p.type === "log_expense");
}

function formValues(routed: ReturnType<typeof routeChatIntent>, proposal: SageProposal) {
  const result: ProcessObservationResult = routed.result;
  const item: SageItem = {
    id: "item-1",
    item_type: "expense",
    domain: "coordination",
    summary: result.interpretation.intent.summary,
    evidence_excerpt: result.interpretation.intent.evidence_excerpt,
    urgency: "normal",
    action_required: true,
    child_ids: result.child_ids,
    tool_input: {
      ...result.interpretation.entities,
      resolved_dates: result.resolved_dates,
      ...(result.expense_category ? { expense_category: result.expense_category } : {}),
    },
    plan: result.plan,
    status: "pending",
    created_at: "2026-10-21T18:00:00.000Z",
  };
  return buildExpenseInitialValues(item, proposal);
}

const paid = routeChatIntent({
  message: "I paid $85 for Ashley's occupational therapy appointment today.",
  children,
  coparents: [kevin],
  timezone,
  today,
});
const paidCard = expenseCard(paid);
assert.ok(paidCard);
assert.equal(paid.result.plan.proposals.some((p) => p.type === "calendar_update"), false);
assert.equal(paid.result.plan.proposals.some((p) => p.type === "ask_clarification"), false);
assert.equal(paid.reply.includes("What time"), false);
assert.deepEqual(paid.result.child_ids, [ashley.id]);
assert.equal(paid.result.unresolved_children.length, 0);
assert.equal(paidCard.amount, 85);
assert.equal(paidCard.category, "therapy");
assert.equal(paidCard.paid_by, "self");
assert.equal(paidCard.date, "2026-10-21");
assert.equal(paidCard.requires_approval, true);
assert.equal("executed" in paidCard, false);
assert.match(paidCard.description ?? "", /occupational therapy/i);
assert.doesNotMatch(paidCard.description ?? "", /visa|split|reimburse/i);
assert.equal(paid.result.event_subject, undefined);
const paidForm = formValues(paid, paidCard as SageProposal);
assert.equal(paidForm.childId, ashley.id);
assert.equal(paidForm.amount, 85);
assert.equal(paidForm.category, "therapy");
assert.equal(paidForm.incurredDate, "2026-10-21");
assert.match(paidForm.description ?? "", /occupational therapy/i);

const supplies = routeChatIntent({
  message: "I spent $45 on Avery's school supplies.",
  children,
  coparents: [kevin],
  timezone,
  today,
});
const suppliesCard = expenseCard(supplies);
assert.ok(suppliesCard);
assert.equal(supplies.result.plan.proposals.some((p) => p.type === "calendar_update"), false);
assert.deepEqual(supplies.result.child_ids, [avery.id]);
assert.equal(suppliesCard.amount, 45);
assert.equal(suppliesCard.category, "school");
assert.equal(suppliesCard.date, undefined);
assert.match(suppliesCard.description ?? "", /Avery/i);
assert.match(suppliesCard.description ?? "", /school supplies/i);

const kevinPaid = routeChatIntent({
  message: "Kevin paid $120 for Ashley's therapy.",
  children,
  coparents: [kevin],
  timezone,
  today,
});
const kevinCard = expenseCard(kevinPaid);
assert.ok(kevinCard);
assert.equal(kevinPaid.result.plan.proposals.some((p) => p.type === "reply_coparent"), false);
assert.equal(kevinPaid.result.plan.proposals.some((p) => p.type === "calendar_update"), false);
assert.deepEqual(kevinPaid.result.child_ids, [ashley.id]);
assert.equal(kevinCard.amount, 120);
assert.equal(kevinCard.category, "therapy");
assert.equal(kevinCard.paid_by, "coparent");
assert.equal(kevinCard.payer_name, "Kevin");
assert.match(kevinCard.description ?? "", /Kevin paid/i);
assert.doesNotMatch(kevinCard.description ?? "", /split|reimburse|visa/i);

const scheduled = routeChatIntent({
  message: "Add Ashley's therapy appointment Friday at 4 PM.",
  children,
  coparents: [kevin],
  timezone,
  today,
});
const scheduledCard = scheduled.result.plan.proposals.find((p) => p.type === "calendar_update");
assert.ok(scheduledCard);
assert.equal(scheduled.result.plan.proposals.some((p) => p.type === "log_expense"), false);
assert.equal(scheduledCard.event_start, "16:00");
assert.equal(scheduledCard.date, "2026-10-23");
assert.deepEqual(scheduled.result.child_ids, [ashley.id]);
assert.match(scheduledCard.title ?? "", /Therapy Appointment/);
assert.equal(scheduledCard.requires_approval, true);

const both = routeChatIntent({
  message: "Schedule Ashley's therapy and record the $85 payment.",
  children,
  coparents: [kevin],
  timezone,
  today,
});
const bothExpense = expenseCard(both);
const bothAsk = both.result.plan.proposals.find((p) => p.type === "ask_clarification");
assert.ok(bothExpense);
assert.ok(bothAsk);
assert.equal(both.result.plan.proposals.some((p) => p.type === "calendar_update"), false);
assert.equal(both.result.plan.proposals.some((p) => p.event_start === "09:00"), false);
assert.equal(bothExpense.amount, 85);
assert.equal(bothExpense.category, "therapy");
assert.deepEqual(both.result.child_ids, [ashley.id]);
assert.match(bothAsk.draft, /What time/i);
assert.match(both.reply, /expense/i);

const pending: ConversationContext = {
  thread_subject: "Therapy",
  event: {
    subject: "Therapy Appointment",
    child: "Ashley",
    date: "2026-10-22",
    time: null,
  },
  open_proposals: [
    { type: "ask_clarification", text: "What time is Ashley's therapy appointment?" },
  ],
};
const afterAsk = routeChatIntent({
  message: "I paid $85 for Ashley's occupational therapy appointment today.",
  children,
  coparents: [kevin],
  conversation: pending,
  timezone,
  today,
});
const afterCard = expenseCard(afterAsk);
assert.ok(afterCard);
assert.equal(afterAsk.result.plan.proposals.some((p) => p.type === "calendar_update"), false);
assert.equal(afterAsk.result.plan.proposals.some((p) => p.type === "ask_clarification"), false);
assert.equal(afterAsk.reply.includes("What time"), false);
assert.equal(afterCard.amount, 85);
assert.equal(afterCard.date, "2026-10-21");
assert.notEqual(afterCard.date, "2026-10-22");
assert.deepEqual(afterAsk.result.child_ids, [ashley.id]);
assert.equal(afterAsk.result.event_subject, undefined);

console.log("expense intent tests passed");
