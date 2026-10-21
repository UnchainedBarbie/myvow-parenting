import assert from "node:assert/strict";
import type { SageProposal } from "@/components/sage/proposal-types";
import { deriveOpenItems, type OpenItemSource } from "@/lib/open-items";
import {
  finalizeExecutedProposal,
  isSupersededProposal,
  ownerItemMatch,
  reconcileProposalPlan,
  reviseProposal,
  supersededExecutionError,
  type ProposalRecord,
} from "@/lib/sage/proposal-lifecycle";

function proposal(partial: ProposalRecord & { type: string }): ProposalRecord {
  return { draft: "", depends_on: null, ...partial };
}

function item(id: string, proposals: ProposalRecord[]): OpenItemSource {
  return {
    id,
    created_at: "2026-10-21T15:00:00.000Z",
    status: "pending",
    source_type: "chat",
    summary: "Thursday plan",
    plan: { proposals: proposals as SageProposal[] },
  };
}

function pendingTitles(proposals: ProposalRecord[], id = "item-1"): string[] {
  return deriveOpenItems([item(id, proposals)]).map((row) => row.title);
}

const original = proposal({
  id: "event-a",
  type: "calendar_update",
  draft: "Soccer Thursday at 4",
  title: "Soccer Thursday at 4",
});

const first = reviseProposal([original], 0, {
  draft: "Soccer Thursday at 5",
  title: "Soccer Thursday at 5",
});
assert.ok(first);
assert.equal(isSupersededProposal(first.proposals[0]), true);
assert.equal(first.proposals[0].superseded_by, first.replacementId);
assert.equal(first.proposals[1].supersedes, first.previousId);
assert.equal(first.proposals[1].approved, undefined);
assert.equal(first.proposals[1].executed, undefined);
assert.deepEqual(pendingTitles(first.proposals), ["Soccer Thursday at 5"]);

const completed = finalizeExecutedProposal(first.proposals[1], { eventId: "evt-1" });
const afterComplete = first.proposals.slice();
afterComplete[1] = completed.proposal;
assert.equal(completed.proposal.result_event_id, "evt-1");
assert.equal(deriveOpenItems([item("item-1", afterComplete)]).length, 0);

const second = reviseProposal(first.proposals, first.replacementIndex, {
  draft: "Soccer Friday at 5",
  title: "Soccer Friday at 5",
});
assert.ok(second);
assert.equal(isSupersededProposal(second.proposals[0]), true);
assert.equal(isSupersededProposal(second.proposals[1]), true);
assert.equal(second.proposals[1].superseded_by, second.replacementId);
assert.deepEqual(pendingTitles(second.proposals), ["Soccer Friday at 5"]);
const finishedChain = second.proposals.slice();
finishedChain[second.replacementIndex] = finalizeExecutedProposal(
  finishedChain[second.replacementIndex],
  { eventId: "evt-2" }
).proposal;
assert.equal(deriveOpenItems([item("item-1", finishedChain)]).length, 0);

const withExpense = [
  original,
  proposal({
    id: "expense-b",
    type: "log_expense",
    draft: "Cleats",
    title: "Cleats",
  }),
];
const calendarOnly = reviseProposal(withExpense, 0, {
  draft: "Soccer Friday at 6",
  title: "Soccer Friday at 6",
});
assert.ok(calendarOnly);
const sameConversation = deriveOpenItems([
  item("item-1", calendarOnly.proposals),
  item("item-2", [
    proposal({
      id: "event-c",
      type: "calendar_update",
      draft: "Dentist Tuesday",
      title: "Dentist Tuesday",
      date: "2026-10-27",
    }),
  ]),
]);
assert.equal(sameConversation.length, 3);
assert.ok(sameConversation.some((row) => row.title === "Soccer Friday at 6"));
assert.ok(sameConversation.some((row) => row.title === "Cleats"));
assert.ok(sameConversation.some((row) => row.title === "Dentist Tuesday"));
assert.equal(
  sameConversation.some((row) => row.title === "Soccer Thursday at 4"),
  false
);

const updateExisting = proposal({
  id: "event-update",
  type: "calendar_update",
  draft: "Move soccer to 5",
  title: "Move soccer to 5",
  calendar_intent: "update",
  calendar_event_id: "evt-existing",
});
assert.deepEqual(pendingTitles([updateExisting]), ["Move soccer to 5"]);
const updateReconcile = reconcileProposalPlan([updateExisting]);
assert.equal(updateReconcile.changed, false);
assert.equal(updateReconcile.proposals[0].executed, undefined);
const applied = finalizeExecutedProposal(updateExisting, { eventId: "evt-existing" });
assert.equal(pendingTitles([applied.proposal]).length, 0);
assert.equal(applied.proposal.result_event_id, "evt-existing");

for (const type of ["log_expense", "log_document", "reply_coparent"] as const) {
  const revised = reviseProposal(
    [proposal({ id: `${type}-1`, type, draft: "Original", title: "Original" })],
    0,
    type === "reply_coparent"
      ? { revised_text: "Updated draft" }
      : { draft: "Updated", title: "Updated" }
  );
  assert.ok(revised, type);
  assert.equal(isSupersededProposal(revised.proposals[0]), true);
  assert.equal(revised.proposals[1].approved, undefined);
  const open = deriveOpenItems([item(type, revised.proposals)]);
  assert.equal(open.length, 1, type);
  assert.equal(open[0].proposalIndex, revised.replacementIndex);
}

const replaced = supersededExecutionError(first.proposals, 0, "item-1");
assert.ok(replaced);
assert.equal(replaced.error, "This proposal was replaced. Use the current version.");
assert.equal(replaced.current_proposal_id, first.replacementId);
assert.equal(replaced.current_proposal_index, first.replacementIndex);
assert.equal(replaced.current_item_id, "item-1");
assert.equal(supersededExecutionError(first.proposals, first.replacementIndex, "item-1"), null);

const failedSave = proposal({
  id: "expense-save",
  type: "log_expense",
  draft: "Soccer fee",
  title: "Soccer fee",
  status: "save_failed",
  save_error: "timeout",
  result_expense_id: "exp-1",
});
const recovered = reviseProposal([failedSave], 0, {
  draft: "Soccer fee, corrected",
  title: "Soccer fee, corrected",
});
assert.ok(recovered);
assert.equal(isSupersededProposal(recovered.proposals[0]), true);
assert.equal(recovered.proposals[1].status, "save_failed");
assert.equal(recovered.proposals[1].result_expense_id, "exp-1");
assert.equal(supersededExecutionError(recovered.proposals, 0, "item-1")?.current_proposal_id, recovered.replacementId);
const retry = deriveOpenItems([item("item-1", recovered.proposals)]);
assert.equal(retry.length, 1);
assert.equal(retry[0].actionLabel, "Retry save");
assert.equal(retry[0].retry?.expenseId, "exp-1");
const firstFinish = finalizeExecutedProposal(recovered.proposals[1], { expenseId: "exp-1" });
assert.equal(firstFinish.alreadyExecuted, false);
assert.equal(firstFinish.proposal.result_expense_id, "exp-1");
const secondFinish = finalizeExecutedProposal(firstFinish.proposal, { expenseId: "exp-2" });
assert.equal(secondFinish.alreadyExecuted, true);
assert.equal(secondFinish.proposal.result_expense_id, "exp-1");

const linked = reconcileProposalPlan([
  proposal({ id: "a", type: "calendar_update", draft: "Old time", title: "Old time" }),
  proposal({
    id: "b",
    type: "calendar_update",
    draft: "New time",
    title: "New time",
    supersedes: "a",
  }),
]);
assert.equal(linked.changed, true);
assert.equal(linked.proposals[0].status, "superseded");
assert.equal(linked.proposals[0].superseded_by, "b");
assert.deepEqual(pendingTitles(linked.proposals), ["New time"]);
const linkedAgain = reconcileProposalPlan(linked.proposals);
assert.equal(linkedAgain.changed, false);

const statusOnly = reconcileProposalPlan([
  proposal({
    id: "a",
    type: "log_document",
    draft: "Old file",
    title: "Old file",
    superseded_by: "b",
  }),
  proposal({ id: "b", type: "log_document", draft: "New file", title: "New file" }),
]);
assert.equal(statusOnly.changed, true);
assert.equal(statusOnly.proposals[0].status, "superseded");
assert.equal(reconcileProposalPlan(statusOnly.proposals).changed, false);

const ambiguous = reconcileProposalPlan([
  proposal({
    id: "a",
    type: "calendar_update",
    draft: "Soccer",
    title: "Soccer",
    date: "2026-10-22",
  }),
  proposal({
    id: "b",
    type: "calendar_update",
    draft: "Soccer",
    title: "Soccer",
    date: "2026-10-22",
  }),
]);
assert.equal(ambiguous.changed, false);
assert.equal(deriveOpenItems([item("item-1", ambiguous.proposals)]).length, 2);

const partialHistory = reconcileProposalPlan([
  proposal({
    id: "a",
    type: "log_expense",
    draft: "Fee",
    title: "Fee",
    status: "save_failed",
    save_error: "timeout",
    result_expense_id: "exp-9",
  }),
  proposal({
    id: "b",
    type: "log_expense",
    draft: "Fee revised",
    title: "Fee revised",
    supersedes: "a",
  }),
]);
assert.equal(partialHistory.proposals[0].status, "superseded");
assert.equal(partialHistory.proposals[1].result_expense_id, "exp-9");
assert.equal(partialHistory.proposals[1].status, "save_failed");
assert.notEqual(partialHistory.proposals[1].executed, true);
assert.equal(reconcileProposalPlan(partialHistory.proposals).changed, false);

const untouchedFailure = reconcileProposalPlan([
  proposal({
    id: "p",
    type: "log_expense",
    draft: "Fee",
    title: "Fee",
    status: "save_failed",
    save_error: "timeout",
    result_expense_id: "exp-1",
  }),
]);
assert.equal(untouchedFailure.changed, false);
assert.notEqual(untouchedFailure.proposals[0].executed, true);

for (const status of ["declined", "canceled", "cancelled", "dismissed", "completed", "superseded"]) {
  const closed = deriveOpenItems([
    item("item-1", [proposal({ type: "reply_coparent", draft: "Draft", status })]),
  ]);
  assert.equal(closed.length, 0, status);
}

const scope = ownerItemMatch("parent-1", "case-1", "item-1");
assert.equal(scope.visible_to, "parent-1");
assert.equal(scope.case_id, "case-1");
assert.equal(scope.id, "item-1");
assert.throws(() => ownerItemMatch("", "case-1", "item-1"));
const otherParent = proposal({
  id: "other",
  type: "calendar_update",
  draft: "Soccer Thursday at 4",
  title: "Soccer Thursday at 4",
  date: "2026-10-22",
});
assert.equal(reconcileProposalPlan([otherParent]).changed, false);
assert.equal(
  deriveOpenItems([item("parent-item", [original]), item("other-item", [otherParent])]).length,
  2
);

console.log("proposal lifecycle tests passed");
