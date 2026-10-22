import assert from "node:assert/strict";
import { deriveOpenItems } from "@/lib/open-items";
import { routeChatIntent, shouldPreserveOpenWork } from "@/lib/sage/chat-intent";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { reviseProposal } from "@/lib/sage/proposal-lifecycle";
import {
  deriveWorkingMemory,
  isActionableFocus,
  settleParentChatPlan,
  type MemorySource,
} from "@/lib/sage/working-memory";

const today = new Date("2026-10-21T18:00:00Z");
const timezone = "America/Denver";
const children = [
  { id: "child-ashley", name: "Ashley" },
  { id: "child-avery", name: "Avery" },
];

const calendarSources: MemorySource[] = [
  {
    itemId: "item-cal",
    itemType: "calendar_event",
    proposals: [
      {
        id: "cal-1",
        type: "calendar_update",
        draft: "Add to calendar: Ashley's dentist, Fri Oct 23.",
        date: "2026-10-23",
        title: "Ashley's dentist",
        depends_on: "time",
        requires_approval: true,
      },
      {
        id: "ask-1",
        type: "ask_clarification",
        draft: "What time is Ashley's dentist appointment?",
        audience: "parent",
        clarifies: "calendar",
        depends_on: "time",
        requires_approval: true,
      },
    ],
  },
];

const calendarMemory = deriveWorkingMemory(calendarSources);
const calendarConversation: ConversationContext = {
  thread_subject: "Ashley dentist",
  event: {
    subject: "dentist",
    child: "Ashley",
    date: "2026-10-23",
    time: null,
    eventId: null,
  },
  open_proposals: [
    { type: "ask_clarification", text: "What time is Ashley's dentist appointment?" },
    { type: "calendar_update", text: "Add to calendar: Ashley's dentist, Fri Oct 23." },
  ],
  memory: calendarMemory,
};

assert.equal(calendarMemory.clarification?.proposalId, "ask-1");
assert.equal(calendarMemory.clarification?.kind, "calendar");
assert.equal(calendarMemory.clarification?.collected.date, "2026-10-23");
assert.deepEqual(calendarMemory.clarification?.missing, ["time"]);
assert.equal(calendarMemory.focus?.proposalId, "ask-1");
assert.equal(isActionableFocus(calendarMemory.history.find((entry) => entry.proposalId === "cal-1")), true);

const expenseMessage = "I paid $40 for Avery's school field trip. My co-parent owes half.";
const expense = routeChatIntent({
  message: expenseMessage,
  conversation: calendarConversation,
  coparents: [{ name: "Kevin", email: "kevin@example.com" }],
  children,
  events: [
    {
      id: "evt-dentist",
      title: "Ashley's dentist",
      childId: "child-ashley",
      start: "2026-10-23T15:00:00Z",
      description: null,
      status: "confirmed",
      allDay: false,
      visibility: "family",
      createdBy: "parent-1",
    },
  ],
  timezone,
  today,
});
const expenseTypes = expense.result.plan.proposals.map((proposal) => proposal.type);
assert.deepEqual(expenseTypes, ["log_expense"]);
assert.equal(expense.result.plan.proposals.some((proposal) => proposal.type === "calendar_update"), false);
assert.equal(expense.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
assert.equal(expense.result.plan.proposals.some((proposal) => proposal.type === "note_only"), false);
assert.equal(expense.result.resolved_dates.length, 0);
assert.equal(expense.result.event_subject ?? null, null);
assert.deepEqual(expense.result.child_ids, ["child-avery"]);
const expenseCard = expense.result.plan.proposals[0];
assert.equal(expenseCard.amount, 40);
assert.equal(expenseCard.stated_percent, 50);
assert.equal(expenseCard.requires_approval, true);
assert.equal("executed" in expenseCard, false);
assert.equal(expenseCard.calendar_event_id ?? null, null);
assert.equal("result_expense_id" in expenseCard, false);
assert.equal(shouldPreserveOpenWork(expenseMessage, calendarMemory, expense.result.plan.proposals), true);
const stillOpen = deriveWorkingMemory(calendarSources);
assert.equal(stillOpen.clarification?.proposalId, "ask-1");
assert.equal(stillOpen.history.find((entry) => entry.proposalId === "ask-1")?.status, "awaiting_clarification");
assert.equal(stillOpen.history.find((entry) => entry.proposalId === "cal-1")?.status, "pending");

const continuation = routeChatIntent({
  message: "4:00 PM",
  conversation: calendarConversation,
  children,
  timezone,
  today,
});
assert.equal(continuation.result.plan.proposals.some((proposal) => proposal.type === "calendar_update"), true);
assert.equal(continuation.result.plan.proposals[0]?.date, "2026-10-23");
assert.equal(shouldPreserveOpenWork("4:00 PM", calendarMemory, continuation.result.plan.proposals), false);

const documentProposal = {
  id: "prop-doc",
  type: "log_document",
  key: "doc-key",
  title: "Ashley — Occupational Therapy Evaluation",
  description: "Occupational therapy evaluation for Ashley",
  category: "therapy",
  visibility: "parents_only",
  document_child_id: "child-ashley",
  document_child_name: "Ashley",
  attached_file_name: "ashley ot evaluation.png",
  attached_document_id: "doc-1",
  draft: "File Ashley — Occupational Therapy Evaluation.",
  requires_approval: true,
  depends_on: null,
};
const documentMemory = deriveWorkingMemory([
  {
    itemId: "item-doc",
    itemType: "document",
    proposals: [documentProposal],
  },
]);
assert.equal(documentMemory.focus?.proposalId, "prop-doc");
assert.equal(documentMemory.focus?.kind, "document");
assert.equal(documentMemory.focus?.attachmentId, "doc-1");
assert.equal(documentMemory.focus?.recordId, "doc-1");
assert.equal(documentMemory.focus?.fields.document_child_id, "child-ashley");

const follow = routeChatIntent({
  message: "This evaluation was completed on October 15. Please include that in the description.",
  conversation: {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: [
      {
        type: "log_document",
        text: "Occupational therapy evaluation for Ashley",
        document: {
          key: "doc-key",
          title: "Ashley — Occupational Therapy Evaluation",
          description: "Occupational therapy evaluation for Ashley",
          category: "therapy",
          visibility: "parents_only",
          childName: "Ashley",
          childId: "child-ashley",
          fileName: "ashley ot evaluation.png",
          documentId: "doc-1",
          requiresApproval: true,
          updatesExisting: false,
        },
      },
    ],
    memory: documentMemory,
  },
  children,
  documents: [
    {
      id: "doc-1",
      title: "Ashley — Occupational Therapy Evaluation",
      description: "Occupational therapy evaluation for Ashley",
      category: "therapy",
      fileName: "ashley ot evaluation.png",
      childIds: ["child-ashley"],
      createdAt: "2026-10-20T18:00:00Z",
      visibility: "parents_only",
      uploadedBy: "parent-1",
    },
    {
      id: "doc-other",
      title: "Ashley — Occupational Therapy Evaluation",
      description: "A different file with the same title",
      category: "therapy",
      fileName: "other.png",
      childIds: ["child-ashley"],
      createdAt: "2026-10-21T18:00:00Z",
      visibility: "parents_only",
      uploadedBy: "parent-1",
    },
  ],
  viewerId: "parent-1",
  viewerRole: "parent",
  timezone,
  today,
});
assert.equal(follow.control, "revise_document");
assert.equal(follow.revision?.document?.documentId, "doc-1");
assert.notEqual(follow.revision?.document?.documentId, "doc-other");
assert.equal(follow.revision?.document?.fileName, "ashley ot evaluation.png");
assert.equal(follow.result.plan.proposals.some((proposal) => proposal.type === "note_only"), false);

const retrieval = routeChatIntent({
  message: "Find Ashley's most recent occupational therapy evaluation.",
  children,
  documents: [
    {
      id: "doc-1",
      title: "Ashley — Occupational Therapy Evaluation",
      description: "Occupational therapy evaluation for Ashley",
      category: "therapy",
      fileName: "ashley ot evaluation.png",
      childIds: ["child-ashley"],
      createdAt: "2026-10-20T18:00:00Z",
      visibility: "parents_only",
      uploadedBy: "parent-1",
    },
  ],
  viewerId: "parent-1",
  viewerRole: "parent",
  timezone,
  today,
});
assert.equal(retrieval.handled, true);
assert.equal(retrieval.result.plan.proposals.length, 0);
assert.notEqual(retrieval.reply, "Got it — noted.");
assert.match(retrieval.reply, /\[\[doc:doc-1\|/);
assert.equal(
  deriveOpenItems([
    {
      id: "item-search",
      created_at: "2026-10-21T18:00:00Z",
      source_type: "chat",
      action_required: false,
      plan: retrieval.result.plan,
    },
  ]).length,
  0
);

const missed = settleParentChatPlan(
  {
    status: "no_action",
    proposals: [{ type: "note_only" }],
    reasoning: "No matching action route — note only.",
  },
  calendarMemory
);
assert.ok(missed);
assert.equal(missed.plan.proposals.length, 0);
assert.equal(missed.plan.status, "no_action");
assert.doesNotMatch(missed.reply, /noted|saved|sent|filed|logged/i);
assert.match(missed.reply, /didn't take an action/i);
assert.match(missed.reply, /What time is Ashley's dentist appointment/);
assert.equal(
  deriveOpenItems([
    {
      id: "item-miss",
      created_at: "2026-10-21T18:00:00Z",
      source_type: "chat",
      item_type: "needs_review",
      action_required: true,
      summary: "How was your weekend?",
      plan: missed.plan,
    },
  ]).length,
  0
);
assert.equal(
  settleParentChatPlan(
    { status: "ready", proposals: [{ type: "log_expense" }] },
    null
  ),
  null
);

const unrecognized = routeChatIntent({
  message: "How was your weekend?",
  timezone,
  today,
});
assert.equal(unrecognized.handled, false);
assert.equal(unrecognized.result.plan.proposals.length, 0);
assert.notEqual(unrecognized.reply, "Got it — noted.");
assert.equal(shouldPreserveOpenWork("How was your weekend?", calendarMemory, []), true);

const note = routeChatIntent({
  message: "Please make a note that Ashley has a dentist on Friday.",
  conversation: calendarConversation,
  children,
  timezone,
  today,
});
assert.equal(note.handled, true);
assert.deepEqual(
  note.result.plan.proposals.map((proposal) => proposal.type),
  ["note_only"]
);
assert.equal(note.result.plan.proposals.some((proposal) => proposal.type === "reply_coparent"), false);
assert.equal(note.result.plan.proposals.some((proposal) => proposal.type === "calendar_update"), false);
assert.match(note.reply, /saved that as a note/i);
assert.match(note.reply, /Nothing else was filed, logged, or sent/i);
assert.equal(
  shouldPreserveOpenWork(
    "Please make a note that Ashley has a dentist on Friday.",
    calendarMemory,
    note.result.plan.proposals
  ),
  true
);
assert.equal(
  deriveOpenItems([
    {
      id: "item-note",
      created_at: "2026-10-21T18:00:00Z",
      source_type: "chat",
      action_required: true,
      plan: note.result.plan,
    },
  ]).length,
  0
);

const revised = reviseProposal(
  [
    {
      id: "old-doc",
      type: "log_document",
      draft: "File Ashley — Occupational Therapy Evaluation.",
      title: "Ashley — Occupational Therapy Evaluation",
      attached_document_id: "doc-1",
      requires_approval: true,
      depends_on: null,
    },
  ],
  0,
  {
    type: "log_document",
    draft: "File Ashley — Occupational Therapy Evaluation.",
    title: "Ashley — Occupational Therapy Evaluation",
    description: "Completed October 15, 2026.",
    attached_document_id: "doc-1",
    requires_approval: true,
    depends_on: null,
  }
);
assert.ok(revised);
const supersededMemory = deriveWorkingMemory([
  { itemId: "item-doc", itemType: "document", proposals: revised.proposals },
]);
const oldVersion = supersededMemory.history.find((entry) => entry.proposalId === "old-doc");
assert.equal(oldVersion?.status, "superseded");
assert.equal(isActionableFocus(oldVersion), false);
assert.equal(supersededMemory.focus?.proposalId, revised.replacementId);
assert.equal(supersededMemory.focus?.attachmentId, "doc-1");
assert.equal(supersededMemory.focus?.recordId, "doc-1");
assert.equal(isActionableFocus(supersededMemory.focus), true);
const openAfterRevision = deriveOpenItems([
  {
    id: "item-doc",
    created_at: "2026-10-21T18:00:00Z",
    source_type: "chat",
    status: "pending",
    plan: { proposals: revised.proposals },
  },
]);
assert.equal(openAfterRevision.length, 1);
assert.equal(openAfterRevision[0]?.proposalIndex, revised.replacementIndex);

const identity = deriveWorkingMemory([
  {
    itemId: "item-open",
    itemType: "calendar_event",
    proposals: [
      {
        id: "prop-open",
        type: "calendar_update",
        title: "Dentist",
        draft: "Add Dentist.",
        requires_approval: true,
        depends_on: null,
      },
    ],
  },
  {
    itemId: "item-saved",
    itemType: "calendar_event",
    proposals: [
      {
        id: "prop-saved",
        type: "calendar_update",
        title: "Dentist",
        draft: "Dentist is on the calendar.",
        calendar_event_id: "evt-real",
        result_event_id: "evt-real",
        executed: true,
        requires_approval: true,
        depends_on: null,
      },
    ],
  },
]);
assert.equal(identity.focus?.proposalId, "prop-open");
assert.equal(identity.focus?.recordId, null);
assert.equal(identity.history.find((entry) => entry.proposalId === "prop-saved")?.recordId, "evt-real");
assert.notEqual(identity.focus?.recordId, "evt-real");

console.log("working-memory tests passed");
