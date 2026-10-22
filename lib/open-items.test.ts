import assert from "node:assert/strict";
import {
  deriveOpenItems,
  isClosedOpenItemProposal,
  openItemHref,
  type OpenItemSource,
} from "@/lib/open-items";
import type { SageProposal } from "@/components/sage/proposal-types";

function proposal(partial: Partial<SageProposal> & { type: string }): SageProposal {
  return {
    draft: "",
    depends_on: null,
    ...partial,
  };
}

function item(
  id: string,
  proposals: SageProposal[],
  extra: Partial<OpenItemSource> = {}
): OpenItemSource {
  return {
    id,
    created_at: "2026-10-21T15:00:00.000Z",
    status: "pending",
    source_type: "chat",
    summary: "Pickup Thursday",
    plan: { proposals },
    ...extra,
  };
}

const pendingExpense = proposal({
  type: "log_expense",
  draft: "Log the soccer fee",
  title: "Soccer fee",
});

const once = deriveOpenItems([item("item-1", [pendingExpense])]);
assert.equal(once.length, 1);
assert.equal(once[0]?.key, "item-1:0");
assert.equal(once[0]?.type, "expense");
assert.equal(once[0]?.kind, "awaiting_confirmation");
assert.equal(once[0]?.actionLabel, "Review expense");
assert.equal(once[0]?.title, "Soccer fee");
assert.deepEqual(
  deriveOpenItems([item("item-1", [pendingExpense])]).map((row) => row.key),
  ["item-1:0"]
);

const completed = deriveOpenItems([
  item("item-1", [proposal({ ...pendingExpense, executed: true, result_expense_id: "exp-1" })]),
]);
assert.equal(completed.length, 0);

const declined = deriveOpenItems([
  item("item-1", [proposal({ ...pendingExpense, status: "waived_by_user" })]),
]);
assert.equal(declined.length, 0);

const superseded = deriveOpenItems([
  item("item-1", [proposal({ type: "calendar_update", draft: "Move practice", status: "superseded" })]),
]);
assert.equal(superseded.length, 0);

const canceled = deriveOpenItems([
  item("item-1", [proposal({ type: "calendar_update", draft: "Move practice", status: "canceled" })]),
]);
assert.equal(canceled.length, 0);

const missing = deriveOpenItems([
  item("item-2", [
    proposal({
      type: "calendar_update",
      draft: "Add the recital",
      depends_on: "which day",
      calendar_intent: "offer",
    }),
  ]),
]);
assert.equal(missing.length, 1);
assert.equal(missing[0]?.kind, "missing_information");
assert.equal(missing[0]?.type, "calendar_event");
assert.equal(missing[0]?.actionLabel, "Confirm event");
assert.match(missing[0]?.explanation ?? "", /which day/);

const failed = deriveOpenItems([
  item("item-3", [
    proposal({
      type: "log_expense",
      draft: "Dentist",
      title: "Dentist",
      status: "save_failed",
      save_error: "The ledger write didn't finish.",
      result_expense_id: "exp-9",
    }),
  ]),
]);
assert.equal(failed.length, 1);
assert.equal(failed[0]?.kind, "save_failed");
assert.equal(failed[0]?.actionLabel, "Retry save");
assert.equal(failed[0]?.retry?.expenseId, "exp-9");
assert.equal(failed[0]?.explanation, "The ledger write didn't finish.");

const failedWithoutRecord = deriveOpenItems([
  item("item-3b", [
    proposal({
      type: "calendar_update",
      draft: "Add practice",
      save_error: "Calendar save failed.",
    }),
  ]),
]);
assert.equal(failedWithoutRecord.length, 1);
assert.equal(failedWithoutRecord[0]?.retry, null);

const draft = deriveOpenItems([
  item("item-4", [
    proposal({
      type: "reply_coparent",
      draft: "I can do Thursday.",
      requires_approval: true,
    }),
  ]),
]);
assert.equal(draft.length, 1);
assert.equal(draft[0]?.kind, "message_draft");
assert.equal(draft[0]?.actionLabel, "Review draft");
assert.match(draft[0]?.explanation ?? "", /Nothing is sent/);
const href = openItemHref("session-9", "item-4", 0);
assert.equal(href, "/sage/session-9?item=item-4&proposal=0");
assert.equal(href?.includes("send"), false);

const approvedDraft = deriveOpenItems([
  item("item-4", [
    proposal({
      type: "reply_coparent",
      draft: "I can do Thursday.",
      approved: true,
    }),
  ]),
]);
assert.equal(approvedDraft.length, 1);
assert.match(approvedDraft[0]?.explanation ?? "", /has not been sent/);

const filed = deriveOpenItems([
  item("item-5", [proposal({ type: "log_document", draft: "File the report", executed: true })]),
]);
assert.equal(filed.length, 0);

const filing = deriveOpenItems([
  item("item-5", [proposal({ type: "log_document", draft: "File the report", title: "Report card" })]),
]);
assert.equal(filing.length, 1);
assert.equal(filing[0]?.kind, "filing_decision");
assert.equal(filing[0]?.actionLabel, "Review document");

const two = deriveOpenItems([
  item("item-6", [
    pendingExpense,
    proposal({ type: "calendar_update", draft: "Add the game", calendar_intent: "offer" }),
  ]),
]);
assert.deepEqual(
  two.map((row) => row.key),
  ["item-6:0", "item-6:1"]
);

const notes = deriveOpenItems([
  item("item-7", [proposal({ type: "note_only", draft: "Just a note" })]),
]);
assert.equal(notes.length, 0);

const archived = deriveOpenItems([
  item("item-8", [pendingExpense], { status: "archived" }),
]);
assert.equal(archived.length, 0);

const committedCalendar = deriveOpenItems([
  item("item-9", [
    proposal({
      type: "calendar_update",
      draft: "Practice",
      executed: true,
      result_event_id: "evt-1",
    }),
  ]),
]);
assert.equal(committedCalendar.length, 0);

const emailReview = deriveOpenItems([
  item("inbox-1", [], {
    source_type: "email",
    item_type: "needs_review",
    summary: "School flyer",
    action_required: true,
    plan: { proposals: [] },
  }),
]);
assert.equal(emailReview.length, 1);
assert.equal(emailReview[0]?.key, "inbox-1:item");
assert.equal(emailReview[0]?.proposalIndex, null);

const questionOnly = deriveOpenItems([
  item("ask-1", [
    proposal({
      type: "ask_clarification",
      audience: "parent",
      draft: "What time is the appointment?",
    }),
  ]),
]);
assert.equal(questionOnly.length, 0);

const questionBesideExpense = deriveOpenItems([
  item("ask-2", [
    proposal({ type: "ask_clarification", audience: "parent", draft: "What time?" }),
    pendingExpense,
  ]),
]);
assert.equal(questionBesideExpense.length, 1);
assert.equal(questionBesideExpense[0]?.type, "expense");

const coparentQuestion = deriveOpenItems([
  item("ask-3", [
    proposal({
      type: "ask_clarification",
      audience: "coparent",
      draft: "Can you confirm the pickup time?",
    }),
  ]),
]);
assert.equal(coparentQuestion.length, 1);

const chatNoise = deriveOpenItems([
  item("chat-1", [proposal({ type: "note_only", draft: "hello" })], {
    source_type: "chat",
    item_type: "needs_review",
    action_required: true,
  }),
]);
assert.equal(chatNoise.length, 0);

assert.equal(
  isClosedOpenItemProposal(proposal({ type: "log_expense", status: "declined" })),
  true
);
assert.equal(openItemHref(null, "item-4", 0), null);

console.log("open-items tests passed");
