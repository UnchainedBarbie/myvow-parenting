import assert from "node:assert/strict";
import {
  cancelPendingMessages,
  revisePendingCalendar,
  routeChatIntent,
  selfForwardResult,
  type KnownCoparent,
} from "@/lib/sage/chat-intent";
import { knownCoparentsFromRows } from "@/lib/sage/known-coparents";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import {
  confirmedDeliveryFields,
  messageSendDecision,
  parentMessageFields,
} from "@/lib/messages/deliver-parent-message";
import { classifyCommunication } from "@/lib/reports/communication-record";
import { reviseProposal } from "@/lib/sage/proposal-lifecycle";

const today = new Date("2026-10-21T18:00:00Z");
const kevin: KnownCoparent = { name: "Kevin", email: "kevin@example.com" };
const ashleyContext: ConversationContext = {
  thread_subject: "Ashley OT",
  event: {
    subject: "OT appointment",
    child: "Ashley",
    date: "2026-10-20",
    time: "4:30 PM",
  },
  open_proposals: [
    { type: "calendar_update", text: "Add to calendar: Ashley, OT appointment." },
    { type: "reply_coparent", text: "Ashley has an OT appointment." },
  ],
};

function types(message: string, extra?: Parameters<typeof routeChatIntent>[0]) {
  const routed = routeChatIntent({
    message,
    coparents: [kevin],
    timezone: "America/Denver",
    today,
    ...extra,
  });
  return routed.result.plan.proposals.map((p) => p.type);
}

const calendar = routeChatIntent({
  message: "Ashley needs to be at school at 6 pm tomorrow.",
  coparents: [kevin],
  timezone: "America/Denver",
  today,
});
assert.deepEqual(
  calendar.result.plan.proposals.map((p) => p.type),
  ["calendar_update"]
);
assert.match(calendar.reply, /notify Kevin/i);
assert.equal(calendar.result.plan.proposals[0].date, "2026-10-22");
assert.doesNotMatch(calendar.result.plan.proposals[0].draft, /Kevin/);

const explicit = routeChatIntent({
  message: "Kevin needs to know about Ashley's appointment.",
  coparents: [kevin],
  timezone: "America/Denver",
  today,
});
const messageCard = explicit.result.plan.proposals.find((p) => p.type === "reply_coparent");
assert.ok(messageCard);
assert.equal(messageCard.recipient_name, "Kevin");
assert.equal(messageCard.recipient_email, "kevin@example.com");
assert.doesNotMatch(messageCard.draft, /Kevin/);
assert.equal(explicit.control, "none");

const followUp = routeChatIntent({
  message: "Can you let him know?",
  coparents: [kevin],
  conversation: ashleyContext,
  timezone: "America/Denver",
  today,
});
const followCard = followUp.result.plan.proposals.find((p) => p.type === "reply_coparent");
assert.ok(followCard);
assert.equal(followCard.recipient_email, "kevin@example.com");
assert.match(followCard.draft, /Ashley/);
assert.match(followCard.draft, /OT appointment/);
assert.doesNotMatch(followCard.draft, /Kevin/);

const advice = routeChatIntent({
  message: "What should I say to Kevin?",
  coparents: [kevin],
  timezone: "America/Denver",
  today,
});
assert.ok(advice.result.plan.proposals.every((p) => p.type === "note_only"));
assert.match(advice.reply, /won't send/i);

const unpaid = routeChatIntent({
  message: "Kevin still hasn't paid me for Ashley's appointment.",
  coparents: [kevin],
  timezone: "America/Denver",
  today,
});
assert.ok(unpaid.result.plan.proposals.every((p) => p.type !== "reply_coparent"));
assert.match(unpaid.reply, /log the expense|draft a reminder/i);

const both = routeChatIntent({
  message: "Add Ashley's appointment and let Kevin know.",
  coparents: [kevin],
  conversation: ashleyContext,
  timezone: "America/Denver",
  today,
});
assert.deepEqual(
  both.result.plan.proposals.map((p) => p.type).sort(),
  ["calendar_update", "reply_coparent"]
);

const ambiguous = routeChatIntent({
  message: "Can you let him know?",
  coparents: [kevin, { name: "Alex", email: "alex@example.com" }],
  conversation: ashleyContext,
  timezone: "America/Denver",
  today,
});
assert.ok(ambiguous.result.plan.proposals.every((p) => p.type !== "reply_coparent"));
assert.match(ambiguous.reply, /won't guess|Who should/i);

const missingChannel = routeChatIntent({
  message: "Let Kevin know about Ashley's appointment.",
  coparents: [{ name: "Kevin", email: null }],
  timezone: "America/Denver",
  today,
});
assert.ok(missingChannel.result.plan.proposals.every((p) => p.type !== "reply_coparent"));
assert.match(missingChannel.reply, /delivery email/i);

const pending = [
  {
    type: "reply_coparent",
    draft: "Ashley has an appointment.",
    recipient_name: "Kevin",
    recipient_email: "kevin@example.com",
    depends_on: null,
    requires_approval: true,
  },
];
const edited = reviseProposal(pending, 0, {
  revised_text: "Ashley has an appointment on Thursday.",
});
assert.ok(edited);
assert.equal(edited.proposals[edited.replacementIndex].revised_text, "Ashley has an appointment on Thursday.");
assert.equal(edited.proposals[edited.replacementIndex].executed, undefined);
assert.equal(edited.proposals[edited.replacementIndex].result_message_id, undefined);
assert.equal(edited.proposals[edited.replacementIndex].approved, undefined);

const canceled = cancelPendingMessages(pending, "2026-10-21T18:00:00.000Z");
assert.equal(canceled.canceled, 1);
assert.equal((canceled.proposals[0] as { status?: string }).status, "canceled");

const correction = routeChatIntent({
  message: "Actually, make that Thursday.",
  coparents: [kevin],
  conversation: {
    ...ashleyContext,
    open_proposals: [{ type: "calendar_update", text: "Add to calendar: Ashley, OT appointment." }],
  },
  timezone: "America/Denver",
  today,
});
assert.equal(correction.control, "revise_pending");
assert.equal(correction.revision?.date, "2026-10-22");
assert.ok(correction.result.plan.proposals.every((p) => p.type === "note_only"));
const moved = revisePendingCalendar(
  [
    {
      type: "calendar_update",
      draft: "Add to calendar: Ashley, OT appointment, Tue, Oct 20.",
      date: "2026-10-20",
      depends_on: null,
      requires_approval: true,
    },
  ],
  correction.revision!
);
assert.equal(moved.changed, true);
const replacement = moved.proposals.find(
  (p) =>
    p &&
    typeof p === "object" &&
    (p as { type?: string; status?: string }).type === "calendar_update" &&
    (p as { status?: string }).status !== "superseded"
) as { date?: string };
assert.equal(replacement.date, "2026-10-22");

const held = selfForwardResult(
  "Please add Ashley's OT to the calendar Tuesday at 4:30 and send it to Kevin.",
  ["ot-note.pdf"]
);
assert.ok(held.result.plan.proposals.every((p) => p.type === "note_only"));
assert.match(held.reply, /privately/i);
assert.match(held.reply, /ot-note\.pdf/);

const fileIt = routeChatIntent({
  message: "Save the email I forwarded as a document.",
  coparents: [kevin],
  timezone: "America/Denver",
  today,
});
assert.deepEqual(types("Save the email I forwarded as a document."), ["log_document"]);
assert.ok(fileIt.result.plan.proposals.every((p) => p.type !== "reply_coparent"));

const fields = parentMessageFields({
  caseId: "case-1",
  senderId: "parent-1",
  conversationId: "conv-1",
  body: "Ashley has an appointment.",
  recipientEmail: "kevin@example.com",
});
assert.equal(fields.direction, "outgoing");
assert.equal(fields.current_status, "sent");
assert.equal(fields.delivery_status, "sent");
assert.equal(fields.delivered_at, null);
assert.equal(fields.recipient_email, "kevin@example.com");
assert.equal(fields.sage_proposal_id, undefined);
assert.equal(
  parentMessageFields({
    caseId: "case-1",
    senderId: "parent-1",
    conversationId: "conv-1",
    body: "Ashley has an appointment.",
    recipientEmail: "kevin@example.com",
    proposalId: " proposal-9 ",
  }).sage_proposal_id,
  "proposal-9"
);
assert.equal(fields.original_content, "Ashley has an appointment.");
assert.equal(
  classifyCommunication({
    status: String(fields.current_status),
    deliveryStatus: String(fields.delivery_status),
    deliveredAt: null,
    senderIsParent: true,
    selfForward: false,
    sageOrJournal: false,
  }).include,
  true
);
const delivered = confirmedDeliveryFields("<msg-1@myvow.in>", "2026-10-21T19:00:00.000Z");
assert.equal(delivered.delivery_status, "delivered");
assert.equal(
  classifyCommunication({
    status: "sent",
    deliveryStatus: "pending",
    deliveredAt: null,
    senderIsParent: true,
    selfForward: false,
    sageOrJournal: false,
  }).include,
  false
);

assert.equal(messageSendDecision({ draft: "Ashley has an appointment." }), "send");
assert.equal(
  messageSendDecision({ executed: true, result_message_id: "msg-1" }),
  "already_sent"
);
assert.equal(
  messageSendDecision({ result_message_id: "msg-1" }),
  "already_sent"
);
assert.equal(
  messageSendDecision({ send_claim_at: "2026-10-21T18:00:30.000Z" }, Date.parse("2026-10-21T18:00:40.000Z")),
  "in_progress"
);
assert.equal(
  messageSendDecision({ send_claim_at: "2026-10-21T18:00:00.000Z" }, Date.parse("2026-10-21T18:02:00.000Z")),
  "send"
);

for (const message of [
  "can you let coparent know",
  "let my co-parent know",
  "please tell the other parent",
  "let co-parent know",
]) {
  const routed = routeChatIntent({
    message,
    coparents: [kevin],
    conversation: ashleyContext,
    timezone: "America/Denver",
    today,
  });
  const card = routed.result.plan.proposals.find((p) => p.type === "reply_coparent");
  assert.ok(card, message);
  assert.equal(card.recipient_name, "Kevin");
  assert.equal(card.recipient_email, "kevin@example.com");
  assert.match(card.draft, /Ashley/);
  assert.match(card.draft, /OT appointment/);
  assert.doesNotMatch(card.draft, /coparent|co-parent/i);
  assert.doesNotMatch(routed.reply, /don't have coparent/i);
  assert.equal(routed.result.plan.proposals.some((p) => p.type === "calendar_update"), false);
}

const roleAmbiguous = routeChatIntent({
  message: "can you let coparent know",
  coparents: [kevin, { name: "Alex", email: "alex@example.com" }],
  conversation: ashleyContext,
  timezone: "America/Denver",
  today,
});
assert.ok(roleAmbiguous.result.plan.proposals.every((p) => p.type !== "reply_coparent"));
assert.match(roleAmbiguous.reply, /won't guess/i);

const roleMissing = routeChatIntent({
  message: "can you let coparent know",
  coparents: [],
  conversation: ashleyContext,
  timezone: "America/Denver",
  today,
});
assert.ok(roleMissing.result.plan.proposals.every((p) => p.type !== "reply_coparent"));
assert.match(roleMissing.reply, /don't have a co-parent on this case/i);
assert.doesNotMatch(roleMissing.reply, /don't have coparent/i);

const roleNoEmail = routeChatIntent({
  message: "let my co-parent know",
  coparents: [{ name: "Kevin", email: null }],
  conversation: ashleyContext,
  timezone: "America/Denver",
  today,
});
assert.ok(roleNoEmail.result.plan.proposals.every((p) => p.type !== "reply_coparent"));
assert.match(roleNoEmail.reply, /delivery email/i);

const owner = { id: "member-owner", user_id: "owner-1", display_name: "Alex", invitation_status: "connected" };

const pendingParent = knownCoparentsFromRows(
  [
    owner,
    {
      id: "member-pending",
      user_id: null,
      display_name: "Kevin",
      external_email: "kevin@example.com",
      invitation_status: "invited",
    },
    { id: "member-child", user_id: null, child_id: "child-1", display_name: "Ashley", external_email: "ashley@school.test" },
    { id: "member-empty", user_id: null, invitation_status: "not_invited" },
  ],
  [],
  [{ case_member_id: "member-pending", email: "kevin@example.com", is_reply: true }],
  "owner-1"
);
assert.deepEqual(pendingParent, [{ name: "Kevin", email: "kevin@example.com" }]);

const neverJoined = knownCoparentsFromRows(
  [owner, { id: "member-pending", user_id: null, display_name: "Kevin", invitation_status: "invited" }],
  [{ id: "unlinked-login", full_name: "Someone Else", email: "other@example.com" }],
  [{ case_member_id: "member-pending", email: "kevin@example.com", is_reply: true }],
  "owner-1"
);
assert.deepEqual(neverJoined, [{ name: "Kevin", email: "kevin@example.com" }]);

const active = knownCoparentsFromRows(
  [
    owner,
    { id: "member-active", user_id: "parent-2", invitation_status: "connected" },
  ],
  [{ id: "parent-2", full_name: "Kevin", email: "kevin@example.com" }],
  [{ case_member_id: "member-active", email: "kevin@example.com", is_reply: true }],
  "owner-1"
);
assert.deepEqual(active, [{ name: "Kevin", email: "kevin@example.com" }]);

const none = knownCoparentsFromRows(
  [owner],
  [],
  [{ case_member_id: "member-owner", email: "alex@example.com", is_reply: true }],
  "owner-1"
);
assert.deepEqual(none, []);

const several = knownCoparentsFromRows(
  [
    owner,
    { id: "member-kevin", user_id: null, display_name: "Kevin", invitation_status: "invited" },
    { id: "member-alex", user_id: null, display_name: "Alex Parent", invitation_status: "invited" },
  ],
  [],
  [
    { case_member_id: "member-kevin", email: "kevin@example.com", is_reply: true },
    { case_member_id: "member-alex", email: "alex.parent@example.com", is_reply: true },
  ],
  "owner-1"
);
assert.deepEqual(several, [
  { name: "Kevin", email: "kevin@example.com" },
  { name: "Alex Parent", email: "alex.parent@example.com" },
]);

const missingEmail = knownCoparentsFromRows(
  [owner, { id: "member-pending", user_id: null, display_name: "Kevin", invitation_status: "invited" }],
  [],
  [],
  "owner-1"
);
assert.deepEqual(missingEmail, [{ name: "Kevin", email: null }]);

const inboundOnly = knownCoparentsFromRows([owner], [], [], "owner-1");
assert.deepEqual(inboundOnly, []);

const pendingNotice = routeChatIntent({
  message: "let my co-parent know",
  coparents: pendingParent,
  conversation: ashleyContext,
  timezone: "America/Denver",
  today,
});
const pendingCard = pendingNotice.result.plan.proposals.find((p) => p.type === "reply_coparent");
assert.ok(pendingCard);
assert.equal(pendingCard.recipient_name, "Kevin");
assert.equal(pendingCard.recipient_email, "kevin@example.com");
assert.match(pendingCard.draft, /Ashley/);

const severalNotice = routeChatIntent({
  message: "can you let coparent know",
  coparents: several,
  conversation: ashleyContext,
  timezone: "America/Denver",
  today,
});
assert.ok(severalNotice.result.plan.proposals.every((p) => p.type !== "reply_coparent"));
assert.match(severalNotice.reply, /won't guess/i);

const missingNotice = routeChatIntent({
  message: "let my co-parent know",
  coparents: missingEmail,
  conversation: ashleyContext,
  timezone: "America/Denver",
  today,
});
assert.ok(missingNotice.result.plan.proposals.every((p) => p.type !== "reply_coparent"));
assert.match(missingNotice.reply, /delivery email/i);

console.log("chat-intent tests passed");
