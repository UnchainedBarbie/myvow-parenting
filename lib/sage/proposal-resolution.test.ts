import assert from "node:assert/strict";
import type { SageProposal } from "@/components/sage/proposal-types";
import { deriveOpenItems, type OpenItemSource } from "@/lib/open-items";
import { ownerItemMatch } from "@/lib/sage/proposal-lifecycle";
import {
  dismissProposalRecord,
  isResolvedProposal,
  reconcileResolvedProposals,
} from "@/lib/sage/proposal-resolution";

function proposal(partial: Partial<SageProposal> & { type: string }): SageProposal {
  return { draft: "", depends_on: null, ...partial };
}

function item(id: string, proposals: SageProposal[]): OpenItemSource {
  return {
    id,
    created_at: "2026-10-21T15:00:00.000Z",
    status: "pending",
    source_type: "chat",
    summary: "Thursday",
    plan: { proposals },
  };
}

const approvedReply = proposal({
  id: "reply-approved",
  type: "reply_coparent",
  draft: "I can pick up at 4.",
  title: "Pickup reply",
  approved: true,
  approved_at: "2026-10-21T16:00:00.000Z",
});
assert.equal(isResolvedProposal(approvedReply), false);
assert.equal(deriveOpenItems([item("item-reply", [approvedReply])]).length, 1);

const sentReply = proposal({
  id: "reply-sent",
  type: "reply_coparent",
  draft: "I can pick up at 5.",
  title: "Sent pickup reply",
  result_message_id: "msg-1",
});
const sibling = proposal({
  id: "expense-open",
  type: "log_expense",
  draft: "Cleats",
  title: "Cleats",
});
const sameWords = proposal({
  id: "reply-other",
  type: "reply_coparent",
  draft: "I can pick up at 5.",
  title: "Sent pickup reply",
});
const open = deriveOpenItems([
  item("item-reply", [approvedReply, sentReply, sibling]),
  item("item-other", [sameWords]),
]);
assert.deepEqual(
  open.map((row) => row.title).sort(),
  ["Cleats", "Pickup reply", "Sent pickup reply"]
);
assert.equal(open.some((row) => row.sageItemId === "item-reply" && row.proposalIndex === 1), false);

const repaired = reconcileResolvedProposals([sentReply, sibling, sameWords]);
assert.equal(repaired.changed, true);
assert.equal(repaired.proposals[0].executed, true);
assert.equal(repaired.proposals[0].result_message_id, "msg-1");
assert.equal(repaired.proposals[1].executed, undefined);
assert.equal(repaired.proposals[2].executed, undefined);
assert.equal(deriveOpenItems([item("item-reply", repaired.proposals as SageProposal[])]).length, 2);
assert.equal(reconcileResolvedProposals(repaired.proposals).changed, false);

const linked = reconcileResolvedProposals(
  [proposal({ id: "reply-a", type: "reply_coparent", draft: "See you then.", title: "See you then." })],
  [{ proposalId: "reply-a", messageId: "msg-9" }]
);
assert.equal(linked.proposals[0].result_message_id, "msg-9");
assert.equal(linked.proposals[0].executed, true);
assert.equal(linked.proposals[0].approved, undefined);
assert.equal(deriveOpenItems([item("item-a", linked.proposals as SageProposal[])]).length, 0);
assert.equal(reconcileResolvedProposals(linked.proposals, [{ proposalId: "reply-a", messageId: "msg-9" }]).changed, false);

const unrelatedLink = reconcileResolvedProposals(
  [
    proposal({ id: "reply-a", type: "reply_coparent", draft: "One", title: "One" }),
    proposal({ id: "reply-b", type: "reply_coparent", draft: "One", title: "One" }),
  ],
  [{ proposalId: "reply-a", messageId: "msg-9" }]
);
assert.equal(unrelatedLink.proposals[0].executed, true);
assert.equal(unrelatedLink.proposals[1].executed, undefined);
assert.equal(deriveOpenItems([item("item-b", unrelatedLink.proposals as SageProposal[])]).length, 1);

const savedEvent = proposal({
  id: "event-1",
  type: "calendar_update",
  draft: "Soccer at 5",
  title: "Soccer at 5",
  result_event_id: "evt-1",
});
const eventRepair = reconcileResolvedProposals([savedEvent]);
assert.equal(eventRepair.proposals[0].executed, true);
assert.equal(deriveOpenItems([item("item-event", eventRepair.proposals as SageProposal[])]).length, 0);

const updateTarget = proposal({
  id: "event-2",
  type: "calendar_update",
  draft: "Move soccer to 6",
  title: "Move soccer to 6",
  calendar_intent: "update",
  calendar_event_id: "evt-existing",
});
assert.equal(reconcileResolvedProposals([updateTarget]).changed, false);
assert.equal(deriveOpenItems([item("item-update", [updateTarget])]).length, 1);

const failedSave = proposal({
  id: "exp-1",
  type: "log_expense",
  draft: "Fee",
  title: "Fee",
  status: "save_failed",
  save_error: "timeout",
  result_expense_id: "exp-1",
});
assert.equal(reconcileResolvedProposals([failedSave]).changed, false);
assert.equal(deriveOpenItems([item("item-fee", [failedSave])]).length, 1);

const approvedAsk = proposal({
  id: "ask-1",
  type: "ask_clarification",
  draft: "Which day works?",
  approved_at: "2026-10-21T12:00:00.000Z",
});
const askRepair = reconcileResolvedProposals([approvedAsk]);
assert.equal(askRepair.proposals[0].status, "completed");
assert.equal(askRepair.proposals[0].approved, true);
assert.equal(deriveOpenItems([item("item-ask", askRepair.proposals as SageProposal[])]).length, 0);

const pendingAsk = proposal({
  id: "ask-2",
  type: "ask_clarification",
  draft: "Which day works?",
  title: "Which day works?",
});
assert.equal(reconcileResolvedProposals([pendingAsk, approvedReply]).changed, false);
assert.equal(deriveOpenItems([item("item-pending", [pendingAsk, approvedReply])]).length, 2);

const dismissed = dismissProposalRecord(
  { ...approvedReply, result_message_id: "" } as unknown as Record<string, unknown>,
  "2026-10-21T18:00:00.000Z"
);
assert.equal(dismissed.status, "waived_by_user");
assert.equal(dismissed.approved, true);
assert.equal(dismissed.executed, undefined);
assert.equal(
  deriveOpenItems([item("item-dismissed", [dismissed as SageProposal])]).length,
  0
);
assert.equal(dismissProposalRecord(dismissed, "2026-10-21T19:00:00.000Z"), dismissed);

const scope = ownerItemMatch("parent-1", "case-1", "item-reply");
assert.equal(scope.visible_to, "parent-1");
assert.throws(() => ownerItemMatch("", "case-1", "item-reply"));

console.log("proposal resolution tests passed");
