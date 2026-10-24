import assert from "node:assert/strict";
import {
  chooseSharedConversation,
  incomingNoticeCopy,
  parentDeliveryKind,
  parentDeliveryLabel,
  parentProposalStatusMark,
  presentMessageForViewer,
  resolveCaseRecipient,
  unassignedParentRepair,
} from "@/lib/messages/parent-message-visibility";
import { deliveryEvidence } from "@/lib/record/record-present";

const ashley = {
  userId: "parent-ashley",
  emails: ["ashley@example.com", "ashley.reply@example.com"],
};
const kevin = {
  userId: "parent-kevin",
  emails: ["kevin@example.com", "kevin.reply@example.com"],
};
const parents = [ashley, kevin];

function main() {
  assert.deepEqual(
    resolveCaseRecipient({
      senderId: ashley.userId,
      recipientEmail: " Kevin.Reply@example.com ",
      parents,
    }),
    { userId: kevin.userId }
  );
  assert.deepEqual(
    resolveCaseRecipient({
      senderId: kevin.userId,
      recipientEmail: "ashley@example.com",
      parents,
    }),
    { userId: ashley.userId }
  );
  assert.equal(
    "error" in
      resolveCaseRecipient({
        senderId: ashley.userId,
        recipientEmail: "stranger@example.com",
        parents,
      }),
    true
  );
  assert.match(
    (
      resolveCaseRecipient({
        senderId: ashley.userId,
        recipientEmail: "ashley.reply@example.com",
        parents,
      }) as { error: string }
    ).error,
    /belongs to you/i
  );
  assert.match(
    (
      resolveCaseRecipient({
        senderId: ashley.userId,
        recipientEmail: "other-case@example.com",
        parents,
      }) as { error: string }
    ).error,
    /not a parent on this case/i
  );

  const threadFromKevinInbound = chooseSharedConversation({
    conversations: [
      { id: "conv-kevin-sent", coparentEmail: "kevin.reply@example.com", subject: "Schedule" },
    ],
    recipientEmail: "kevin.reply@example.com",
    senderEmails: ashley.emails,
    subject: "Re: Schedule",
  });
  assert.equal(threadFromKevinInbound, "conv-kevin-sent");

  const threadFromAshleyInbound = chooseSharedConversation({
    conversations: [
      { id: "conv-ashley-sent", coparentEmail: "ashley.reply@example.com", subject: "Schedule" },
    ],
    recipientEmail: "kevin@example.com",
    senderEmails: ashley.emails,
    subject: "Something else",
  });
  assert.equal(threadFromAshleyInbound, "conv-ashley-sent");

  assert.equal(
    chooseSharedConversation({
      conversations: [{ id: "other", coparentEmail: "someone@example.com", subject: "Schedule" }],
      recipientEmail: kevin.emails[0],
      senderEmails: ashley.emails,
    }),
    null
  );

  const saved = {
    sender_id: ashley.userId,
    direction: "outgoing",
    delivery_status: "sent",
    delivered_at: null,
  };
  assert.deepEqual(presentMessageForViewer(saved, ashley.userId), {
    show: true,
    direction: "outgoing",
  });
  assert.deepEqual(presentMessageForViewer(saved, kevin.userId), {
    show: true,
    direction: "incoming",
  });
  assert.equal(
    presentMessageForViewer(
      { sender_id: ashley.userId, direction: "outgoing", delivery_status: "delivered", delivered_at: "2026-10-23T00:00:00Z" },
      kevin.userId
    ).direction,
    "incoming"
  );
  assert.equal(
    presentMessageForViewer(
      { sender_id: null, direction: "incoming", delivery_status: "pending", delivered_at: null },
      kevin.userId
    ).show,
    false
  );
  assert.equal(
    presentMessageForViewer(
      { sender_id: null, direction: "incoming", delivery_status: "buffered", delivered_at: null },
      kevin.userId
    ).show,
    false
  );

  const kevinSent = {
    sender_id: kevin.userId,
    direction: "outgoing",
    delivery_status: "sent",
    delivered_at: null,
  };
  assert.equal(presentMessageForViewer(kevinSent, ashley.userId).direction, "incoming");
  assert.equal(presentMessageForViewer(kevinSent, kevin.userId).direction, "outgoing");
  assert.match(incomingNoticeCopy("Kevin"), /Kevin sent you a message/);
  assert.match(incomingNoticeCopy("Kevin"), /Messages/);
  assert.doesNotMatch(incomingNoticeCopy("Kevin"), /appointment|private/i);

  assert.equal(parentDeliveryKind({ deliveryStatus: "sent", deliveredAt: null }), "saved");
  assert.equal(parentDeliveryLabel("saved"), "Saved in Messages");
  assert.equal(parentProposalStatusMark({ deliveryStatus: "sent" }), "✓ saved in Messages");
  assert.equal(
    parentDeliveryKind({ deliveryStatus: "email_accepted", deliveredAt: null }),
    "email_accepted"
  );
  assert.equal(parentDeliveryLabel("email_accepted"), "Email accepted");
  assert.equal(
    parentProposalStatusMark({ deliveryStatus: "email_accepted", deliveredAt: null }),
    "✓ email accepted"
  );
  assert.notEqual(
    parentProposalStatusMark({ deliveryStatus: "email_accepted" }),
    "✓ delivered"
  );
  assert.equal(parentDeliveryKind({ deliveryStatus: "delivered", deliveredAt: null }), "saved");
  assert.equal(
    parentDeliveryKind({ deliveryStatus: "delivered", deliveredAt: "2026-10-23T18:00:00.000Z" }),
    "delivered"
  );
  assert.equal(parentDeliveryLabel("delivered"), "Delivered");
  const evidenceBase = {
    id: "msg-1",
    created_at: "2026-10-23T18:00:00.000Z",
    direction: "outgoing",
    sender_id: ashley.userId,
    sender_external_email: null,
    original_content: "Ashley has an appointment.",
    conversation_id: null,
    current_status: "sent",
    has_attachments: false,
  };
  assert.deepEqual(
    deliveryEvidence(
      { ...evidenceBase, delivery_status: "sent", delivered_at: null },
      "America/Denver"
    ),
    ["Saved in Messages"]
  );
  assert.deepEqual(
    deliveryEvidence(
      { ...evidenceBase, delivery_status: "email_accepted", delivered_at: null },
      "America/Denver"
    ),
    ["Email accepted"]
  );
  const deliveredLine = deliveryEvidence(
    {
      ...evidenceBase,
      delivery_status: "delivered",
      delivered_at: "2026-10-23T18:00:00.000Z",
    },
    "America/Denver"
  );
  assert.match(deliveredLine[0] ?? "", /^Delivered /);
  assert.equal(
    presentMessageForViewer(
      {
        sender_id: ashley.userId,
        direction: "outgoing",
        delivery_status: "email_accepted",
        delivered_at: null,
      },
      kevin.userId
    ).show,
    true
  );

  const thread = [{ id: "conv-shared", caseId: "case-1", coparentEmail: "kevin.reply@example.com" }];
  const parentSend = {
    caseId: "case-1",
    senderId: ashley.userId,
    recipientEmail: "kevin@example.com",
    direction: "outgoing",
  };
  assert.deepEqual(
    unassignedParentRepair({
      message: parentSend,
      caseId: "case-1",
      parents,
      conversations: thread,
    }),
    { conversationId: "conv-shared", recipientUserId: kevin.userId }
  );
  assert.equal(
    unassignedParentRepair({
      message: { ...parentSend, recipientEmail: null },
      caseId: "case-1",
      parents,
      conversations: thread,
    }),
    null
  );
  assert.equal(
    unassignedParentRepair({
      message: { ...parentSend, recipientEmail: "  " },
      caseId: "case-1",
      parents,
      conversations: thread,
    }),
    null
  );
  for (const intakeBranch of ["self", "private", "forwarded", "third_party", "coparent"]) {
    assert.equal(
      unassignedParentRepair({
        message: { ...parentSend, intakeBranch },
        caseId: "case-1",
        parents,
        conversations: thread,
      }),
      null,
      intakeBranch
    );
  }
  assert.equal(
    unassignedParentRepair({
      message: { ...parentSend, senderExternalEmail: "clinic@example.com" },
      caseId: "case-1",
      parents,
      conversations: thread,
    }),
    null
  );
  assert.equal(
    unassignedParentRepair({
      message: { ...parentSend, caseId: "case-2" },
      caseId: "case-1",
      parents,
      conversations: thread,
    }),
    null
  );
  assert.equal(
    unassignedParentRepair({
      message: parentSend,
      caseId: "case-1",
      parents,
      conversations: [{ id: "conv-other", caseId: "case-2", coparentEmail: "kevin@example.com" }],
    }),
    null
  );
  assert.equal(
    unassignedParentRepair({
      message: parentSend,
      caseId: "case-1",
      parents,
      conversations: [],
    }),
    null
  );
  assert.equal(
    unassignedParentRepair({
      message: parentSend,
      caseId: "case-1",
      parents,
      conversations: [
        thread[0],
        { id: "conv-second", caseId: "case-1", coparentEmail: "ashley.reply@example.com" },
      ],
    }),
    null
  );
  assert.equal(
    unassignedParentRepair({
      message: { ...parentSend, recipientEmail: "ashley@example.com" },
      caseId: "case-1",
      parents,
      conversations: thread,
    }),
    null
  );
  assert.equal(
    unassignedParentRepair({
      message: { ...parentSend, direction: "incoming" },
      caseId: "case-1",
      parents,
      conversations: thread,
    }),
    null
  );
  assert.equal(
    unassignedParentRepair({
      message: { ...parentSend, senderId: "parent-other" },
      caseId: "case-1",
      parents,
      conversations: thread,
    }),
    null
  );

  console.log("parent message visibility tests passed");
}

main();
