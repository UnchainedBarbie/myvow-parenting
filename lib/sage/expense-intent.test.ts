import assert from "node:assert/strict";
import { buildExpenseInitialValues, needsDateField } from "@/components/sage/proposal-helpers";
import type { SageItem, SageProposal } from "@/components/sage/proposal-types";
import { routeChatIntent } from "@/lib/sage/chat-intent";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { resolveExpenseIncurredDate } from "@/lib/sage/expense-date";
import { deriveOpenItems } from "@/lib/open-items";
import { plan } from "@/lib/sage/planner";
import { stampExpenseProposal } from "@/lib/sage/expense-proposal-sharing";
import type { ProcessObservationResult } from "@/lib/sage/process-observation";
import type { SharingResult } from "@/lib/expenses-sharing";

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
assert.equal(suppliesCard.date, "2026-10-21");
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

const fieldTrip = "I paid $40 for Avery's school field trip. My co-parent owes half.";
const trip = routeChatIntent({
  message: fieldTrip,
  children,
  coparents: [kevin],
  timezone,
  today,
});
const tripCard = expenseCard(trip);
assert.ok(tripCard);
assert.equal(trip.result.plan.proposals.some((p) => p.type === "calendar_update"), false);
assert.equal(trip.result.plan.proposals.some((p) => p.type === "ask_clarification"), false);
assert.equal(trip.result.plan.status, "ready");
assert.equal(trip.result.resolved_dates.length, 0);
assert.equal(trip.result.event_subject, undefined);
assert.deepEqual(trip.result.child_ids, [avery.id]);
assert.equal(tripCard.amount, 40);
assert.equal(tripCard.category, "school");
assert.equal(tripCard.paid_by, "self");
assert.equal(tripCard.sharing_intent, "shared");
assert.equal(tripCard.stated_percent, 50);
assert.equal(tripCard.date, "2026-10-21");
assert.equal(tripCard.requires_approval, true);
assert.equal(tripCard.depends_on, null);
const tripForm = formValues(trip, tripCard as SageProposal);
assert.equal(tripForm.incurredDate, "2026-10-21");
assert.equal(tripForm.childId, avery.id);
assert.equal(tripForm.amount, 40);
assert.equal(needsDateField(tripCard as SageProposal, formItem(trip)), false);

const noRule: SharingResult = {
  allocation_status: "UNRESOLVED",
  other_parent_percent: null,
  other_parent_share: null,
  split_label: null,
  clarification: "I don't have a sharing rule for School. What percentage should the other parent pay?",
};
const half = stampExpenseProposal(tripCard, noRule).proposal;
assert.equal(half.other_parent_share, 20);
assert.equal(half.amount_owed, 20);
assert.equal(half.split_label, "50/50");
assert.equal(half.notify_coparent, true);
assert.match(half.split_review ?? "", /\$20\.00/);
assert.match(half.split_review ?? "", /Notify co-parent: on/);
assert.equal(half.date, "2026-10-21");

const withRule: SharingResult = {
  allocation_status: "ALLOCATED",
  other_parent_percent: 50,
  other_parent_share: 20,
  split_label: "50/50",
  clarification: null,
};
const ruled = stampExpenseProposal(tripCard, withRule).proposal;
assert.equal(ruled.other_parent_share, 20);
assert.equal(ruled.notify_coparent, true);

const open = deriveOpenItems([
  {
    id: "item-trip",
    created_at: "2026-10-21T18:00:00.000Z",
    item_type: "expense",
    summary: trip.result.interpretation.intent.summary,
    plan: { proposals: trip.result.plan.proposals },
  },
]);
assert.equal(open.length, 1);
assert.equal(open[0].type, "expense");
assert.equal(open[0].kind, "awaiting_confirmation");
assert.equal(open.some((item) => item.kind === "missing_information"), false);

const tripOnFriday = routeChatIntent({
  message: "I paid $40 for Avery's school field trip on Friday. My co-parent owes half.",
  children,
  coparents: [kevin],
  timezone,
  today,
});
const fridayActivity = expenseCard(tripOnFriday);
assert.ok(fridayActivity);
assert.equal(fridayActivity.date, "2026-10-21");
assert.equal(tripOnFriday.result.plan.proposals.some((p) => p.type === "ask_clarification"), false);
assert.equal(tripOnFriday.result.plan.proposals.some((p) => p.type === "calendar_update"), false);
assert.equal(
  resolveExpenseIncurredDate(
    "I paid $40 for Avery's school field trip on Friday. My co-parent owes half.",
    today,
    timezone
  ).iso,
  "2026-10-21"
);

const paidFriday = routeChatIntent({
  message: "I paid $40 on Friday for Avery's school field trip. My co-parent owes half.",
  children,
  coparents: [kevin],
  timezone,
  today,
});
const fridayPaid = expenseCard(paidFriday);
assert.ok(fridayPaid);
assert.equal(fridayPaid.date, "2026-10-16");
assert.equal(fridayPaid.amount, 40);
assert.equal(paidFriday.result.child_ids[0], avery.id);
assert.equal(paidFriday.result.plan.proposals.some((p) => p.type === "ask_clarification"), false);

const paidYesterday = routeChatIntent({
  message: "I paid $40 yesterday for Avery's school field trip.",
  children,
  coparents: [kevin],
  timezone,
  today,
});
assert.equal(expenseCard(paidYesterday)?.date, "2026-10-20");
assert.equal(paidYesterday.result.plan.proposals.some((p) => p.type === "calendar_update"), false);

async function plannerDates() {
const expenseBlocked = await plan({
  item_type: "expense",
  domain: "coordination",
  action_required: true,
  summary: "You'd like to log Avery's school field trip.",
  child_ids: [avery.id],
  unresolved_children: [],
  resolved_dates: [{ raw: "field trip", status: "needs_clarification", iso: null }],
  sender: "You",
  source_type: "chat",
});
assert.equal(expenseBlocked.status, "ready");
assert.equal(expenseBlocked.proposals.some((p) => p.type === "ask_clarification"), false);
assert.equal(expenseBlocked.proposals.some((p) => p.type === "log_expense"), true);
assert.equal(expenseBlocked.proposals.find((p) => p.type === "log_expense")?.depends_on, null);

const calendarBlocked = await plan({
  item_type: "calendar_update",
  domain: "coordination",
  action_required: true,
  summary: "Add Avery's field trip.",
  child_ids: [avery.id],
  unresolved_children: [],
  resolved_dates: [],
  sender: "You",
  source_type: "chat",
});
assert.equal(calendarBlocked.status, "awaiting_clarification");
assert.match(calendarBlocked.proposals[0]?.draft ?? "", /Which date should I use/i);
assert.equal(calendarBlocked.proposals.some((p) => p.type === "log_expense"), false);
console.log("expense intent tests passed");
}

function formItem(routed: ReturnType<typeof routeChatIntent>): SageItem {
  const result: ProcessObservationResult = routed.result;
  return {
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
    },
    plan: result.plan,
    status: "pending",
    created_at: "2026-10-21T18:00:00.000Z",
  };
}

void plannerDates();
