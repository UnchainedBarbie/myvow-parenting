import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeDb } from "@/lib/messages/fake-admin";
import {
  announceIncomingMessage,
  deliverParentMessage,
} from "@/lib/messages/deliver-parent-message";
import { receivingAddress, resolveReceivingParent } from "@/lib/messages/receiving-parent";
import { resolveCaseReceiver } from "@/lib/sage/process-inbox-item";
import {
  issueReviewReceipt,
  reviewGate,
  verifyReviewReceipt,
  REVIEW_RECEIPT_TTL_MS,
} from "@/lib/messages/review-receipt";
import {
  ATTACHMENT_NOT_SHAREABLE_CODE,
  attachmentIntent,
  attachmentOutcomeLabel,
  attachmentPreflight,
  pendingAttachmentNote,
} from "@/lib/messages/send-safety";
import {
  buildProposalSendRequest,
  isAttachmentBlock,
  isSendableMessageProposal,
  proposalMessageText,
  sendRequestFields,
} from "@/lib/messages/proposal-send";
import { failedReview, reviewProofForSend, type ReviewedDraft } from "@/lib/messages/outbound-review";
import { buildIncomingContext } from "@/lib/sage/incoming-context";
import { getServiceRoleClient } from "@/lib/supabase/server";

type Admin = Parameters<typeof deliverParentMessage>[0];

const CASE = "case-1";
const ASHLEY = "user-ashley";
const KEVIN = "user-kevin";
const KEY = "test-secret-key";

const ashley = { userId: ASHLEY, emails: ["ashley@example.com", "ashley.reply@example.com"] };
const kevin = { userId: KEVIN, emails: ["kevin@example.com", "kevin.reply@example.com"] };

function household(): FakeDb {
  const db = new FakeDb();
  db.seed("cases", [{ id: CASE, ingest_email: "case-1@ingest.example.com" }]);
  db.seed("case_members", [
    { id: "m-ashley", case_id: CASE, user_id: ASHLEY, role: "parent", is_primary: true, display_name: "Ashley" },
    { id: "m-kevin", case_id: CASE, user_id: KEVIN, role: "parent", is_primary: false, display_name: "Kevin" },
  ]);
  db.seed("case_member_emails", [
    { case_id: CASE, case_member_id: "m-ashley", email: "ashley.reply@example.com" },
    { case_id: CASE, case_member_id: "m-kevin", email: "kevin.reply@example.com" },
  ]);
  db.seed("users", [
    { id: ASHLEY, email: "ashley@example.com", full_name: "Ashley Example" },
    { id: KEVIN, email: "kevin@example.com", full_name: "Kevin Example" },
  ]);
  return db;
}

function admin(db: FakeDb): Admin {
  return db as unknown as Admin;
}

function seedDocument(db: FakeDb, over: Record<string, unknown> = {}) {
  db.seed("documents", [
    {
      id: "doc-1",
      case_id: CASE,
      uploaded_by: ASHLEY,
      visibility: "parents_only",
      status: "active",
      file_name: "Pediatrician listing.xlsx",
      deleted_at: null,
      ...over,
    },
  ]);
}

/** Collects the background Sage reading so a test can wait for it. */
function harness() {
  const tasks: Promise<unknown>[] = [];
  const read: string[] = [];
  return {
    runInBackground: (task: Promise<unknown>) => void tasks.push(task),
    readMessage: async (messageId: string, _failed?: unknown, options?: { recipientUserId?: string | null }) => {
      read.push(`${messageId}:${options?.recipientUserId ?? ""}`);
    },
    settle: async () => {
      await Promise.all(tasks);
    },
    read,
  };
}

async function send(
  db: FakeDb,
  h: ReturnType<typeof harness>,
  input: {
    senderId: string;
    to: string;
    body?: string;
    proposalId?: string | null;
    attachment?: ReturnType<typeof attachmentIntent> | null;
    ack?: boolean;
  }
) {
  return deliverParentMessage(admin(db), {
    caseId: CASE,
    senderId: input.senderId,
    body: input.body ?? "Can you review the list I attached?",
    recipientEmail: input.to,
    subject: "Pediatrician",
    proposalId: input.proposalId ?? null,
    attachment: input.attachment ?? null,
    acknowledgeAttachmentOmission: input.ack,
    runInBackground: h.runInBackground,
    readMessage: h.readMessage,
  });
}

function rows(db: FakeDb, table: string) {
  return db.table(table);
}

async function main() {
  delete process.env.POSTMARK_SERVER_TOKEN;
  process.env.REVIEW_RECEIPT_SECRET = KEY;

  // --- Receiving parent: the addressee decides, never the primary account ---------------------
  {
    const parents = [ashley, kevin];
    assert.deepEqual(
      resolveReceivingParent({ senderId: ASHLEY, recipientEmails: ["kevin.reply@example.com"], parents }),
      { ok: true, userId: KEVIN, basis: "address" }
    );
    assert.deepEqual(
      resolveReceivingParent({ senderId: KEVIN, recipientEmails: ["ashley@example.com"], parents }),
      { ok: true, userId: ASHLEY, basis: "address" }
    );
    // The primary account sends: the other parent receives, even with no address on the message.
    assert.deepEqual(resolveReceivingParent({ senderId: ASHLEY, recipientEmails: [], parents }), {
      ok: true,
      userId: KEVIN,
      basis: "only_other_parent",
    });
    // The non-primary account sends: the primary receives.
    assert.deepEqual(resolveReceivingParent({ senderId: KEVIN, recipientEmails: [], parents }), {
      ok: true,
      userId: ASHLEY,
      basis: "only_other_parent",
    });
    // A conversation address that is the sender's own never routes the message back to the sender.
    assert.deepEqual(
      resolveReceivingParent({ senderId: ASHLEY, recipientEmails: ["ashley@example.com"], parents }),
      { ok: true, userId: KEVIN, basis: "only_other_parent" }
    );
    // Two other parents and no address: the receiver is not guessed.
    const third = { userId: "user-third", emails: ["third@example.com"] };
    const ambiguous = resolveReceivingParent({ senderId: ASHLEY, recipientEmails: [], parents: [ashley, kevin, third] });
    assert.equal(ambiguous.ok, false);
    assert.deepEqual(
      resolveReceivingParent({ senderId: ASHLEY, recipientEmails: ["third@example.com"], parents: [ashley, kevin, third] }),
      { ok: true, userId: "user-third", basis: "address" }
    );
    // A sender without an account on the case: the single registered parent receives.
    assert.deepEqual(
      resolveReceivingParent({ senderId: null, recipientEmails: [], parents: [ashley] }),
      { ok: true, userId: ASHLEY, basis: "only_other_parent" }
    );
    assert.equal(resolveReceivingParent({ senderId: ASHLEY, recipientEmails: [], parents: [ashley] }).ok, false);
  }

  // --- Email goes to the receiving parent's address ------------------------------------------
  {
    // The conversation stored the sender's own address: use the receiver's address instead.
    assert.equal(
      receivingAddress({ conversationEmail: "ashley@example.com", receiver: kevin, sender: ashley }),
      "kevin@example.com"
    );
    assert.equal(
      receivingAddress({ conversationEmail: "Kevin.Reply@example.com", receiver: kevin, sender: ashley }),
      "Kevin.Reply@example.com"
    );
    assert.equal(receivingAddress({ conversationEmail: null, receiver: kevin, sender: ashley }), "kevin@example.com");
    assert.equal(receivingAddress({ conversationEmail: "x@example.com", receiver: null, sender: ashley }), "x@example.com");
  }

  // --- Review receipts -----------------------------------------------------------------------
  {
    const draft = "Can you look at the list?";
    const receipt = issueReviewReceipt({ userId: ASHLEY, draft, status: "reviewed", key: KEY });
    assert.ok(receipt);
    assert.deepEqual(verifyReviewReceipt({ receipt, userId: ASHLEY, text: draft, key: KEY }), { ok: true, status: "reviewed" });
    assert.deepEqual(verifyReviewReceipt({ receipt, userId: ASHLEY, text: `  ${draft}\n`, key: KEY }), {
      ok: true,
      status: "reviewed",
    });
    assert.deepEqual(verifyReviewReceipt({ receipt, userId: KEVIN, text: draft, key: KEY }), { ok: false, reason: "wrong_user" });
    assert.deepEqual(verifyReviewReceipt({ receipt, userId: ASHLEY, text: "Another draft", key: KEY }), {
      ok: false,
      reason: "not_covered",
    });
    assert.deepEqual(
      verifyReviewReceipt({ receipt, userId: ASHLEY, text: draft, key: KEY, now: Date.now() + REVIEW_RECEIPT_TTL_MS + 5000 }),
      { ok: false, reason: "expired" }
    );
    const forged = `${receipt!.slice(0, -3)}abc`;
    assert.deepEqual(verifyReviewReceipt({ receipt: forged, userId: ASHLEY, text: draft, key: KEY }), { ok: false, reason: "invalid" });
    assert.deepEqual(verifyReviewReceipt({ receipt: "", userId: ASHLEY, text: draft, key: KEY }), { ok: false, reason: "missing" });
    assert.deepEqual(verifyReviewReceipt({ receipt, userId: ASHLEY, text: draft, key: "other-key" }), { ok: false, reason: "invalid" });

    // The gate: a send needs a receipt, or an explicit acknowledgement that the review did not run.
    assert.equal(reviewGate({ receipt: null, unavailableAcknowledged: false, userId: ASHLEY, text: draft, key: KEY }).ok, false);
    assert.deepEqual(reviewGate({ receipt: null, unavailableAcknowledged: true, userId: ASHLEY, text: draft, key: KEY }), {
      ok: true,
      status: "unavailable_acknowledged",
    });
    // An acknowledgement never rescues a receipt that belongs to someone else or to another draft.
    assert.equal(reviewGate({ receipt, unavailableAcknowledged: true, userId: KEVIN, text: draft, key: KEY }).ok, false);
    assert.equal(reviewGate({ receipt, unavailableAcknowledged: true, userId: ASHLEY, text: "Edited", key: KEY }).ok, false);
    const unavailable = issueReviewReceipt({ userId: ASHLEY, draft, status: "review_unavailable", key: KEY });
    assert.deepEqual(reviewGate({ receipt: unavailable, unavailableAcknowledged: false, userId: ASHLEY, text: draft, key: KEY }), {
      ok: true,
      status: "review_unavailable",
    });
  }

  // --- Sage card send request: exact text and proof -----------------------------------------
  {
    const reviewed: ReviewedDraft = {
      review: { status: "suggestion", original: "Look at the list", suggestion: "Could you look at the list?" },
      receipt: "r1.token.sig",
    };
    const request = buildProposalSendRequest({
      proposalIndex: 2,
      finalText: "Could you look at the list?",
      reviewed,
    });
    assert.deepEqual(sendRequestFields(request), {
      reviewed_message: {
        proposal_index: 2,
        text: "Could you look at the list?",
        receipt: "r1.token.sig",
        unavailable_ack: false,
        edit_unreviewed_ack: false,
      },
    });
    const failed: ReviewedDraft = { review: failedReview("Look at the list"), receipt: null };
    assert.deepEqual(reviewProofForSend(failed), { review_unavailable_ack: true });
    assert.deepEqual(reviewProofForSend(reviewed), { review_receipt: "r1.token.sig" });
    // A review that did not fail never produces an acknowledgement without a receipt.
    assert.deepEqual(reviewProofForSend({ review: { status: "no_change", original: "Hi" }, receipt: null }), {});
    assert.deepEqual(sendRequestFields(undefined), {});
    assert.equal(
      sendRequestFields(buildProposalSendRequest({ proposalIndex: 0, finalText: "x", reviewed, acknowledgeAttachmentOmission: true }))
        .acknowledge_attachment_omission,
      true
    );
    assert.equal(proposalMessageText({ revised_text: "  Revised ", draft: "Draft" }), "Revised");
    assert.equal(proposalMessageText({ revised_text: " ", draft: " Draft " }), "Draft");
    assert.equal(isSendableMessageProposal({ type: "reply_coparent", recipient_email: "a@example.com" }), true);
    assert.equal(isSendableMessageProposal({ type: "reply_coparent", recipient_email: "" }), false);
    assert.equal(isSendableMessageProposal({ type: "reply_coparent", recipient_email: "a@example.com", executed: true }), false);
    assert.equal(isSendableMessageProposal({ type: "log_expense", recipient_email: "a@example.com" }), false);
    assert.equal(isAttachmentBlock({ ok: false, error: "x", code: ATTACHMENT_NOT_SHAREABLE_CODE }), true);
    assert.equal(isAttachmentBlock({ ok: false, error: "x" }), false);
  }

  // --- Attachment wording: MyVow scope is stated plainly -------------------------------------
  {
    const note = pendingAttachmentNote("Pediatrician listing.xlsx");
    assert.match(note, /shared inside MyVow/i);
    assert.match(note, /not attached to the email/i);
    const sent = attachmentOutcomeLabel({ status: "shared_in_myvow", documentId: "doc-1", fileName: "Pediatrician listing.xlsx" });
    assert.match(sent ?? "", /Shared in MyVow/);
    assert.match(sent ?? "", /email carries the message text only/i);
    assert.equal(attachmentOutcomeLabel({ status: "none" }), null);
    assert.match(
      attachmentOutcomeLabel({ status: "omitted_acknowledged", fileName: "a.pdf", reason: "The recipient is not allowed to open this file." }) ?? "",
      /Sent without the file/
    );
    assert.match(
      attachmentOutcomeLabel({ status: "share_failed", fileName: "a.pdf", reason: "x" }) ?? "",
      /file was not shared/
    );
  }

  // --- Attachment preflight ------------------------------------------------------------------
  {
    const intent = attachmentIntent({ attached_document_id: "doc-1", attached_file_name: "a.pdf" });
    assert.equal(intent.expected, true);
    assert.equal(attachmentIntent({}).expected, false);
    assert.equal(attachmentIntent({ attached_file_name: "a.pdf" }).expected, true);
    assert.equal(attachmentIntent({ attached_file_url: "https://example.com/a.pdf" }).expected, true);
    assert.deepEqual(
      attachmentPreflight({ intent: attachmentIntent({}), eligibility: null, acknowledgedOmission: false }),
      { action: "send_without_file" }
    );
    assert.equal(
      attachmentPreflight({ intent, eligibility: { link: true, fileName: "a.pdf", reason: null }, acknowledgedOmission: false }).action,
      "send_with_file"
    );
    assert.equal(
      attachmentPreflight({ intent, eligibility: { link: false, fileName: "a.pdf", reason: "No." }, acknowledgedOmission: false }).action,
      "block"
    );
    assert.equal(
      attachmentPreflight({ intent, eligibility: { link: false, fileName: "a.pdf", reason: "No." }, acknowledgedOmission: true }).action,
      "send_without_file_acknowledged"
    );
    // A file named on the card with no saved document cannot travel, and is never dropped silently.
    assert.equal(
      attachmentPreflight({ intent: attachmentIntent({ attached_file_name: "a.pdf" }), eligibility: null, acknowledgedOmission: false }).action,
      "block"
    );
  }

  // --- Incoming context: a shared row reaches the receiver, with the approved text -----------
  {
    const base = {
      id: "m1",
      case_id: CASE,
      conversation_id: "c1",
      sender_id: KEVIN,
      direction: "outgoing",
      original_content: "first draft Kevin never sent",
      ai_rewritten_content: "Kevin's approved message",
      created_at: "2026-10-23T10:00:00Z",
    };
    const common = {
      subject: "Pediatrician",
      recipientRole: "parent",
      thread: [] as never[],
      documents: [] as never[],
      children: [] as string[],
      authority: [] as never[],
    };
    const forAshley = buildIncomingContext({ ...common, message: base, recipientId: ASHLEY });
    assert.ok(forAshley);
    assert.equal(forAshley?.text, "Kevin's approved message");
    assert.equal(buildIncomingContext({ ...common, message: base, recipientId: KEVIN }), null);
    // The reverse direction reaches the other parent.
    const reverse = buildIncomingContext({
      ...common,
      message: { ...base, sender_id: ASHLEY, ai_rewritten_content: "Ashley's approved message" },
      recipientId: KEVIN,
    });
    assert.equal(reverse?.text, "Ashley's approved message");
    // An outgoing row with no sender cannot be attributed to a person.
    assert.equal(buildIncomingContext({ ...common, message: { ...base, sender_id: null }, recipientId: ASHLEY }), null);
  }

  // --- Database: receiving parent resolved from the case --------------------------------------
  {
    const db = household();
    db.seed("messages", [
      { id: "msg-from-kevin", case_id: CASE, sender_id: KEVIN, recipient_email: null },
      { id: "msg-from-ashley", case_id: CASE, sender_id: ASHLEY, recipient_email: "kevin.reply@example.com" },
      { id: "msg-external", case_id: CASE, sender_id: null, recipient_email: null },
    ]);
    const client = db as unknown as Parameters<typeof resolveCaseReceiver>[0];
    assert.equal(await resolveCaseReceiver(client, { caseId: CASE, senderId: KEVIN, recipientEmails: [] }), ASHLEY);
    assert.equal(
      await resolveCaseReceiver(client, { caseId: CASE, senderId: ASHLEY, recipientEmails: ["kevin.reply@example.com"] }),
      KEVIN
    );
    assert.equal(await resolveCaseReceiver(client, { caseId: CASE, senderId: ASHLEY, recipientEmails: [] }), KEVIN);
    // Two registered parents and an external sender with no address: no guess, no primary fallback.
    const external = await resolveCaseReceiver(client, { caseId: CASE, senderId: null, recipientEmails: [] });
    assert.equal(typeof external, "object");
    // The addressed parent is verified against the case and never the sender.
    assert.deepEqual(
      await resolveCaseReceiver(client, { caseId: CASE, senderId: ASHLEY, recipientEmails: [], explicitRecipientId: ASHLEY }),
      { error: "The sender cannot be the receiving parent." }
    );
    assert.deepEqual(
      await resolveCaseReceiver(client, { caseId: CASE, senderId: ASHLEY, recipientEmails: [], explicitRecipientId: "stranger" }),
      { error: "The addressed parent is not on this case." }
    );
  }

  // --- Sage send, Ashley (primary) to Kevin ---------------------------------------------------
  {
    const db = household();
    const h = harness();
    const body = "we need to pick a new pediatrician for the children. can you review the list and provide feedback?";
    const result = await send(db, h, { senderId: ASHLEY, to: "kevin.reply@example.com", body, proposalId: "prop-1" });
    assert.ok(result.ok);
    if (!result.ok) throw new Error("send failed");
    await h.settle();
    assert.equal(result.recipientUserId, KEVIN);
    assert.equal(result.created, true);
    const message = rows(db, "messages")[0];
    assert.equal(message.original_content, body);
    assert.equal(message.ai_rewritten_content, body);
    assert.equal(message.sender_id, ASHLEY);
    assert.equal(message.sage_proposal_id, "prop-1");
    assert.equal(message.recipient_email, "kevin.reply@example.com");

    // Only Kevin hears about it, in Kevin's own session for this conversation.
    const notices = rows(db, "parent_notifications");
    assert.equal(notices.length, 1);
    assert.equal(notices[0].user_id, KEVIN);
    assert.equal(notices[0].type, "coparent_message");
    assert.deepEqual(h.read, [`${message.id}:${KEVIN}`]);
    const sessions = rows(db, "sage_sessions");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].user_id, KEVIN);
    assert.equal(sessions[0].conversation_id, message.conversation_id);
    assert.equal(sessions[0].session_type, "private");
    const journal = rows(db, "sage_journal_messages");
    assert.equal(journal.length, 1);
    assert.equal(journal[0].user_id, KEVIN);
    assert.equal(journal[0].session_id, sessions[0].id);
    assert.equal(journal[0].source_message_id, message.id);
    assert.equal(JSON.stringify(journal).includes(ASHLEY), false);
    assert.equal(rows(db, "message_documents").length, 0);
    assert.deepEqual(result.attachment, { status: "none" });

    // Retrying the same proposal changes nothing and notifies nobody again.
    const retry = await send(db, h, { senderId: ASHLEY, to: "kevin.reply@example.com", body, proposalId: "prop-1" });
    await h.settle();
    assert.ok(retry.ok);
    if (retry.ok) {
      assert.equal(retry.created, false);
      assert.equal(retry.messageId, result.messageId);
    }
    assert.equal(rows(db, "messages").length, 1);
    assert.equal(rows(db, "parent_notifications").length, 1);
    assert.equal(rows(db, "sage_journal_messages").length, 1);
    assert.equal(rows(db, "sage_sessions").length, 1);
    assert.equal(h.read.length, 1);
  }

  // --- Sage send, Kevin (non-primary) to Ashley (primary) -------------------------------------
  {
    const db = household();
    const h = harness();
    const result = await send(db, h, { senderId: KEVIN, to: "ashley@example.com", body: "Kevin's note", proposalId: "prop-k" });
    await h.settle();
    assert.ok(result.ok);
    const notices = rows(db, "parent_notifications");
    assert.equal(notices.length, 1);
    assert.equal(notices[0].user_id, ASHLEY);
    assert.deepEqual(
      rows(db, "sage_sessions").map((row) => row.user_id),
      [ASHLEY]
    );
    assert.deepEqual(
      rows(db, "sage_journal_messages").map((row) => row.user_id),
      [ASHLEY]
    );
    assert.equal(h.read[0].endsWith(`:${ASHLEY}`), true);
  }

  // --- Sage already read the message: the plain notice is skipped, no duplicate ---------------
  {
    const db = household();
    const h = harness();
    const result = await send(db, h, { senderId: ASHLEY, to: "kevin@example.com", body: "Hello", proposalId: "prop-s" });
    assert.ok(result.ok);
    await h.settle();
    const before = rows(db, "sage_journal_messages").length;
    const again = await announceIncomingMessage(admin(db), {
      caseId: CASE,
      conversationId: String(rows(db, "messages")[0].conversation_id),
      messageId: result.ok ? result.messageId : "",
      recipientUserId: KEVIN,
      senderName: "Ashley",
      readMessage: h.readMessage,
    });
    assert.equal(again.startedReading, false);
    assert.equal(again.createdNotice, false);
    assert.equal(again.notified, true);
    assert.equal(rows(db, "sage_journal_messages").length, before);
    assert.equal(rows(db, "parent_notifications").length, 1);
  }

  // --- Sage's own briefing replaces the plain notice ------------------------------------------
  {
    const db = household();
    const tasks: Promise<unknown>[] = [];
    const result = await deliverParentMessage(admin(db), {
      caseId: CASE,
      senderId: ASHLEY,
      body: "Please look at the schedule.",
      recipientEmail: "kevin@example.com",
      subject: "Schedule",
      proposalId: "prop-b",
      runInBackground: (task) => void tasks.push(task),
      readMessage: async (messageId, _failed, options) => {
        db.seed("sage_journal_messages", [
          { user_id: options?.recipientUserId, role: "sage", source_message_id: messageId, content: "Sage briefing" },
        ]);
      },
    });
    assert.ok(result.ok);
    await Promise.all(tasks);
    const journal = rows(db, "sage_journal_messages");
    assert.equal(journal.length, 1);
    assert.equal(journal[0].content, "Sage briefing");
    assert.equal(rows(db, "sage_sessions").length, 0);
  }

  // --- Attachments through Sage send ----------------------------------------------------------
  {
    // Authorized: the file is linked and described as shared inside MyVow.
    const db = household();
    seedDocument(db);
    const h = harness();
    const result = await send(db, h, {
      senderId: ASHLEY,
      to: "kevin.reply@example.com",
      proposalId: "prop-a",
      attachment: attachmentIntent({ attached_document_id: "doc-1", attached_file_name: "Pediatrician listing.xlsx" }),
    });
    await h.settle();
    assert.ok(result.ok);
    if (!result.ok) throw new Error("send failed");
    assert.deepEqual(result.attachment, {
      status: "shared_in_myvow",
      documentId: "doc-1",
      fileName: "Pediatrician listing.xlsx",
    });
    assert.deepEqual(rows(db, "message_documents").map((row) => [row.message_id, row.document_id]), [[result.messageId, "doc-1"]]);
    assert.equal(rows(db, "messages")[0].has_attachments, true);
    assert.equal(rows(db, "conversation_attachments").length, 1);
    assert.match(attachmentOutcomeLabel(result.attachment) ?? "", /Shared in MyVow/);
  }
  {
    // The recipient's address on file differs from the account email: the file still travels.
    const db = household();
    seedDocument(db);
    const h = harness();
    const result = await send(db, h, {
      senderId: ASHLEY,
      to: "kevin.reply@example.com",
      proposalId: "prop-alias",
      attachment: attachmentIntent({ attached_document_id: "doc-1" }),
    });
    assert.ok(result.ok);
    assert.equal(rows(db, "message_documents").length, 1);
  }
  {
    // A file the recipient cannot open blocks the send. Nothing is saved, nobody is notified.
    const db = household();
    seedDocument(db, { visibility: "private" });
    const h = harness();
    const blocked = await send(db, h, {
      senderId: ASHLEY,
      to: "kevin.reply@example.com",
      proposalId: "prop-blocked",
      attachment: attachmentIntent({ attached_document_id: "doc-1", attached_file_name: "Pediatrician listing.xlsx" }),
    });
    await h.settle();
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.equal(blocked.status, 409);
      assert.equal(blocked.code, ATTACHMENT_NOT_SHAREABLE_CODE);
      assert.match(blocked.message, /Nothing was sent/);
      assert.match(blocked.message, /without the file/);
    }
    assert.equal(rows(db, "messages").length, 0);
    assert.equal(rows(db, "conversations").length, 0);
    assert.equal(rows(db, "parent_notifications").length, 0);
    assert.equal(rows(db, "message_documents").length, 0);

    // The parent acknowledges the omission: the text goes out, the omission is recorded.
    const acknowledged = await send(db, h, {
      senderId: ASHLEY,
      to: "kevin.reply@example.com",
      proposalId: "prop-blocked",
      attachment: attachmentIntent({ attached_document_id: "doc-1", attached_file_name: "Pediatrician listing.xlsx" }),
      ack: true,
    });
    await h.settle();
    assert.ok(acknowledged.ok);
    if (acknowledged.ok) {
      assert.equal(acknowledged.attachment.status, "omitted_acknowledged");
      assert.match(attachmentOutcomeLabel(acknowledged.attachment) ?? "", /Sent without the file/);
    }
    assert.equal(rows(db, "messages").length, 1);
    assert.equal(rows(db, "message_documents").length, 0);
    assert.equal(rows(db, "parent_notifications").length, 1);
  }
  {
    // A document uploaded by the other parent is not the sender's to share.
    const db = household();
    seedDocument(db, { uploaded_by: KEVIN });
    const h = harness();
    const blocked = await send(db, h, {
      senderId: ASHLEY,
      to: "kevin@example.com",
      attachment: attachmentIntent({ attached_document_id: "doc-1" }),
    });
    assert.equal(blocked.ok, false);
    // A document from another case is refused too.
    const other = household();
    seedDocument(other, { case_id: "case-2" });
    const refused = await send(other, h, {
      senderId: ASHLEY,
      to: "kevin@example.com",
      attachment: attachmentIntent({ attached_document_id: "doc-1" }),
    });
    assert.equal(refused.ok, false);
    // A missing or deleted document is never skipped silently.
    const gone = household();
    const missing = await send(gone, h, {
      senderId: ASHLEY,
      to: "kevin@example.com",
      attachment: attachmentIntent({ attached_document_id: "doc-404", attached_file_name: "x.pdf" }),
    });
    assert.equal(missing.ok, false);
    const deleted = household();
    seedDocument(deleted, { deleted_at: "2026-10-01T00:00:00Z" });
    const removed = await send(deleted, h, {
      senderId: ASHLEY,
      to: "kevin@example.com",
      attachment: attachmentIntent({ attached_document_id: "doc-1" }),
    });
    assert.equal(removed.ok, false);
    // A card that names a file with no saved document is blocked.
    const nameOnly = await send(household(), h, {
      senderId: ASHLEY,
      to: "kevin@example.com",
      attachment: attachmentIntent({ attached_file_name: "Pediatrician listing.xlsx" }),
    });
    assert.equal(nameOnly.ok, false);
  }
  {
    // Kevin shares his own document with Ashley.
    const db = household();
    seedDocument(db, { uploaded_by: KEVIN });
    const h = harness();
    const result = await send(db, h, {
      senderId: KEVIN,
      to: "ashley@example.com",
      proposalId: "prop-kd",
      attachment: attachmentIntent({ attached_document_id: "doc-1", attached_file_name: "Pediatrician listing.xlsx" }),
    });
    await h.settle();
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.attachment.status, "shared_in_myvow");
    assert.equal(rows(db, "parent_notifications")[0].user_id, ASHLEY);
  }

  // --- Authorization --------------------------------------------------------------------------
  {
    const db = household();
    const h = harness();
    const stranger = await send(db, h, { senderId: "user-stranger", to: "kevin@example.com" });
    assert.equal(stranger.ok, false);
    if (!stranger.ok) assert.equal(stranger.status, 403);
    const toSelf = await send(db, h, { senderId: ASHLEY, to: "ashley@example.com" });
    assert.equal(toSelf.ok, false);
    assert.equal(rows(db, "messages").length, 0);
    assert.equal(rows(db, "parent_notifications").length, 0);
  }

  // --- Announcement without a conversation still reaches the receiver's list -------------------
  {
    const db = household();
    const result = await announceIncomingMessage(admin(db), {
      caseId: CASE,
      conversationId: null,
      messageId: "msg-x",
      recipientUserId: KEVIN,
      senderName: "Ashley",
    });
    assert.equal(result.createdNotice, true);
    assert.equal(result.notified, true);
    assert.equal(rows(db, "parent_notifications")[0].user_id, KEVIN);
    assert.equal(rows(db, "sage_sessions").length, 0);
  }

  // --- Every path that sends to the co-parent carries review proof --------------------------------
  {
    const root = process.cwd();
    const scan = (dir: string, found: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) scan(full, found);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) found.push(full);
      }
      return found;
    };
    const files = [...scan(join(root, "components")), ...scan(join(root, "app")), ...scan(join(root, "lib"))];
    const approveCallers = files.filter((file) => readFileSync(file, "utf8").includes('fetch("/api/messages/approve"'));
    assert.ok(approveCallers.length >= 3, "expected the Messages, compose bar, and reminder senders");
    for (const file of approveCallers) {
      assert.match(readFileSync(file, "utf8"), /reviewProofForSend/, `${file} sends without review proof`);
    }
    const approveRoute = readFileSync(join(root, "app/api/messages/approve/route.ts"), "utf8");
    assert.match(approveRoute, /reviewGate\(/);
    assert.match(approveRoute, /announceIncomingMessage\(/);
    const sageRoute = readFileSync(join(root, "app/api/sage-inbox/route.ts"), "utf8");
    assert.match(sageRoute, /reviewGate\(/);
    assert.match(sageRoute, /deliverParentMessage\(/);
    // Only the shared delivery function and the Messages route create outgoing co-parent rows.
    const inserters = files.filter((file) => /direction:\s*"outgoing"/.test(readFileSync(file, "utf8")) && /\.insert\(/.test(readFileSync(file, "utf8")));
    for (const file of inserters) {
      const allowed = /deliver-parent-message|messages[\\/]approve|app[\\/]api[\\/]messages|ingest/.test(file);
      if (!allowed) console.warn(`review: ${file} writes outgoing rows`);
    }
  }

  // The service-role factory is referenced so the import path used by the routes is type-checked.
  assert.equal(typeof getServiceRoleClient, "function");
  console.log("communication-safety tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
