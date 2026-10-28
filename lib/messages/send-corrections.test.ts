import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeDb } from "@/lib/messages/fake-admin";
import { announceSavedMessage, deliverParentMessage } from "@/lib/messages/deliver-parent-message";
import {
  EDIT_NOT_REVIEWED_MESSAGE,
  REVIEW_REQUIRED_MESSAGE,
  issueReviewReceipt,
  reviewGate,
  reviewGateFailure,
  verifyReviewReceipt,
  REVIEW_RECEIPT_TTL_MS,
} from "@/lib/messages/review-receipt";
import {
  originalForSend,
  requestEditReview,
  reviewCoversText,
  reviewProofForSend,
  type OutboundReview,
  type ReviewedDraft,
} from "@/lib/messages/outbound-review";
import { buildProposalSendRequest, sendRequestFields } from "@/lib/messages/proposal-send";
import { newSendAttemptId, nextSendAttempt, validSendAttemptId } from "@/lib/messages/send-attempt";
import { decideSendAttempt, insertOutgoingMessage } from "@/lib/messages/send-attempt-store";
import { messageNoticeHref, readMessageRef, withMessageRef } from "@/lib/messages/incoming-notice";
import { incomingNoticeCopy } from "@/lib/messages/parent-message-visibility";

type Admin = Parameters<typeof deliverParentMessage>[0];

const CASE = "case-1";
const ASHLEY = "user-ashley";
const KEVIN = "user-kevin";
const KEY = "test-secret-key";

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
  db.seed("conversations", [
    { id: "conv-to-kevin", case_id: CASE, subject: "Schedule", coparent_email: "kevin@example.com" },
    { id: "conv-to-ashley", case_id: CASE, subject: "Schedule", coparent_email: "ashley@example.com" },
  ]);
  return db;
}

function admin(db: FakeDb): Admin {
  return db as unknown as Admin;
}

function rows(db: FakeDb, table: string) {
  return db.table(table);
}

/** The Messages route in order: attempt check, review gate, insert, announce. */
async function approve(
  db: FakeDb,
  input: {
    sender: string;
    conversationId: string;
    attemptId: string;
    original: string;
    final: string;
    receipt: string | null;
    editAck?: boolean;
    readMessage?: Parameters<typeof announceSavedMessage>[1]["readMessage"];
    tasks?: Promise<unknown>[];
  }
) {
  const attempt = await decideSendAttempt(admin(db) as never, {
    senderId: input.sender,
    attemptId: input.attemptId,
    text: input.final,
  });
  if (attempt.kind === "conflict") return { status: 409, code: "send_attempt_conflict" } as const;
  if (attempt.kind === "duplicate") {
    await announceSavedMessage(admin(db), {
      caseId: CASE,
      senderId: input.sender,
      messageId: attempt.messageId,
      conversationId: attempt.conversationId,
      runInBackground: (task) => void input.tasks?.push(task),
      readMessage: input.readMessage,
    });
    return { status: 200, messageId: attempt.messageId, duplicate: true } as const;
  }
  const gate = reviewGate({
    receipt: input.receipt,
    unavailableAcknowledged: false,
    editUnreviewedAcknowledged: input.editAck === true,
    userId: input.sender,
    text: input.final,
    key: KEY,
  });
  if (!gate.ok) return { status: 409, ...reviewGateFailure(gate.reason) } as const;
  const saved = await insertOutgoingMessage(admin(db) as never, {
    row: {
      case_id: CASE,
      conversation_id: input.conversationId,
      direction: "outgoing",
      sender_id: input.sender,
      original_content: input.original,
      ai_rewritten_content: input.final,
    },
    senderId: input.sender,
    attemptId: input.attemptId,
    stored: attempt.stored,
    text: input.final,
  });
  if (!saved.ok) return { status: 500, message: saved.message } as const;
  if (saved.duplicate) return { status: 200, messageId: saved.messageId, duplicate: true } as const;
  const { announceIncomingMessage } = await import("@/lib/messages/deliver-parent-message");
  const { parentDirectory } = await import("@/lib/messages/case-parents");
  const directory = await parentDirectory(admin(db), CASE, input.sender);
  const receiver = directory.parents.find((parent) => parent.userId !== input.sender);
  await announceIncomingMessage(admin(db), {
    caseId: CASE,
    conversationId: input.conversationId,
    messageId: saved.messageId,
    recipientUserId: receiver!.userId,
    senderName: directory.senderName,
    runInBackground: (task) => void input.tasks?.push(task),
    readMessage: input.readMessage,
  });
  return { status: 200, messageId: saved.messageId, duplicate: false } as const;
}

const quietRead = async () => undefined;

async function main() {
  process.env.REVIEW_RECEIPT_SECRET = KEY;
  delete process.env.POSTMARK_SERVER_TOKEN;

  // ===== 1. REVIEW AFTER EDITING =====================================================================
  {
    const draft = "pick up is at 5. dont be late again.";
    const suggestion = "Pick-up is at 5. Please plan to arrive on time.";
    const suggestionReview: OutboundReview = { status: "suggestion", original: draft, suggestion };

    // The review covers the draft it read and the Sage version it offered, in exact text.
    assert.equal(reviewCoversText(suggestionReview, draft), true);
    assert.equal(reviewCoversText(suggestionReview, `  ${draft}\r\n`), true);
    assert.equal(reviewCoversText(suggestionReview, suggestion), true);
    assert.equal(reviewCoversText(suggestionReview, `${suggestion} Thanks.`), false);
    assert.equal(reviewCoversText(suggestionReview, "Pick-up is at 5."), false);
    assert.equal(reviewCoversText({ status: "no_change", original: draft }, suggestion), false);
    assert.equal(reviewCoversText(suggestionReview, "   "), false);

    for (const [parent, other] of [
      [ASHLEY, KEVIN],
      [KEVIN, ASHLEY],
    ] as const) {
      const receipt = issueReviewReceipt({ userId: parent, draft, suggestion, status: "reviewed", key: KEY })!;
      const check = (text: string, user = parent) => verifyReviewReceipt({ receipt, userId: user, text, key: KEY });

      assert.deepEqual(check(draft), { ok: true, status: "reviewed" });
      assert.deepEqual(check(suggestion), { ok: true, status: "reviewed" });
      // A small edit is different text. The review of the original is never a review of it.
      assert.deepEqual(check(`${suggestion} Thanks.`), { ok: false, reason: "not_covered" });
      assert.deepEqual(check(suggestion.replace("5", "6")), { ok: false, reason: "not_covered" });
      // The other parent cannot use this receipt, covered text or not.
      assert.deepEqual(check(draft, other), { ok: false, reason: "wrong_user" });
      assert.equal(JSON.stringify(receipt).includes("Pick-up"), false, "receipts hold hashes only");

      const edited = `${suggestion} Thanks.`;
      // The gate refuses edited text with the specific edit message.
      const refused = reviewGate({ receipt, unavailableAcknowledged: false, userId: parent, text: edited, key: KEY });
      assert.deepEqual(refused, { ok: false, reason: "not_covered" });
      if (!refused.ok) {
        assert.deepEqual(reviewGateFailure(refused.reason), { message: EDIT_NOT_REVIEWED_MESSAGE, code: "edit_not_reviewed" });
      }
      // The review-unavailable acknowledgement never covers edited text.
      assert.equal(
        reviewGate({ receipt, unavailableAcknowledged: true, userId: parent, text: edited, key: KEY }).ok,
        false
      );
      // An explicit acknowledgement that the edit was not reviewed is accepted and labelled.
      assert.deepEqual(
        reviewGate({ receipt, unavailableAcknowledged: false, editUnreviewedAcknowledged: true, userId: parent, text: edited, key: KEY }),
        { ok: true, status: "edited_unreviewed_acknowledged" }
      );
      // The acknowledgement cannot rescue another parent's receipt, an expired one, or a forged one.
      assert.equal(
        reviewGate({ receipt, unavailableAcknowledged: false, editUnreviewedAcknowledged: true, userId: other, text: edited, key: KEY }).ok,
        false
      );
      assert.equal(
        reviewGate({
          receipt,
          unavailableAcknowledged: false,
          editUnreviewedAcknowledged: true,
          userId: parent,
          text: edited,
          key: KEY,
          now: Date.now() + REVIEW_RECEIPT_TTL_MS + 5000,
        }).ok,
        false
      );
      assert.equal(
        reviewGate({
          receipt: `${receipt.slice(0, -3)}abc`,
          unavailableAcknowledged: false,
          editUnreviewedAcknowledged: true,
          userId: parent,
          text: edited,
          key: KEY,
        }).ok,
        false
      );
      // No receipt at all with only the edit acknowledgement still needs a review.
      const missing = reviewGate({ receipt: null, unavailableAcknowledged: false, editUnreviewedAcknowledged: true, userId: parent, text: edited, key: KEY });
      assert.deepEqual(missing, { ok: false, reason: "missing" });
      if (!missing.ok) {
        assert.deepEqual(reviewGateFailure(missing.reason), { message: REVIEW_REQUIRED_MESSAGE, code: "review_required" });
      }
      // Covered text needs no acknowledgement.
      assert.deepEqual(reviewGate({ receipt, unavailableAcknowledged: false, userId: parent, text: suggestion, key: KEY }), {
        ok: true,
        status: "reviewed",
      });
    }

    // Re-reviewing the edit: the new receipt covers the edit, and the first draft stays on record.
    const first: ReviewedDraft = { review: suggestionReview, receipt: issueReviewReceipt({ userId: ASHLEY, draft, suggestion, status: "reviewed", key: KEY }) };
    const edit1 = `${suggestion} Thanks.`;
    const edit2 = `${edit1} See you then.`;
    const calls: string[] = [];
    const fakeFetch = (async (_url: string, init?: { body?: string }) => {
      const text = (JSON.parse(String(init?.body)) as { draft: string }).draft;
      calls.push(text);
      return {
        ok: true,
        json: async () => ({
          review: { status: "no_change" },
          receipt: issueReviewReceipt({ userId: ASHLEY, draft: text, status: "reviewed", key: KEY }),
        }),
      };
    }) as unknown as typeof fetch;
    const second = await requestEditReview(first, edit1, fakeFetch);
    assert.deepEqual(calls, [edit1]);
    assert.equal(second.review.original, edit1);
    assert.equal(originalForSend(second), draft, "the parent's first draft is the recorded original");
    assert.equal(
      verifyReviewReceipt({ receipt: second.receipt, userId: ASHLEY, text: edit1, key: KEY }).ok,
      true
    );
    // The old receipt never covered the edit; the new one does not cover the next edit.
    assert.equal(verifyReviewReceipt({ receipt: first.receipt, userId: ASHLEY, text: edit1, key: KEY }).ok, false);
    assert.equal(verifyReviewReceipt({ receipt: second.receipt, userId: ASHLEY, text: edit2, key: KEY }).ok, false);
    const third = await requestEditReview(second, edit2, fakeFetch);
    assert.equal(originalForSend(third), draft);
    assert.equal(verifyReviewReceipt({ receipt: third.receipt, userId: ASHLEY, text: edit2, key: KEY }).ok, true);
    // A review that could not run for the edit gives no receipt, so it is not proof.
    const failingFetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    const failed = await requestEditReview(second, edit2, failingFetch);
    assert.equal(failed.receipt, null);
    assert.equal(failed.review.status, "unavailable");
    assert.deepEqual(reviewProofForSend(failed), { review_unavailable_ack: true });

    // Request fields carry the explicit acknowledgement only when the parent made it.
    assert.deepEqual(reviewProofForSend(second), { review_receipt: second.receipt });
    assert.deepEqual(reviewProofForSend(second, { editUnreviewedAck: true }), {
      review_receipt: second.receipt,
      edit_unreviewed_ack: true,
    });
    const card = sendRequestFields(buildProposalSendRequest({ proposalIndex: 1, finalText: edit1, reviewed: first, editUnreviewedAck: true }));
    assert.equal((card.reviewed_message as { edit_unreviewed_ack: boolean }).edit_unreviewed_ack, true);
    const plain = sendRequestFields(buildProposalSendRequest({ proposalIndex: 1, finalText: suggestion, reviewed: first }));
    assert.equal((plain.reviewed_message as { edit_unreviewed_ack: boolean }).edit_unreviewed_ack, false);

    // Through the approve flow: edited text without a new review or an acknowledgement saves nothing.
    for (const [sender, convo] of [
      [ASHLEY, "conv-to-kevin"],
      [KEVIN, "conv-to-ashley"],
    ] as const) {
      const db = household();
      const receipt = issueReviewReceipt({ userId: sender, draft, suggestion, status: "reviewed", key: KEY });
      const edited = `${suggestion} Thanks.`;
      const blocked = await approve(db, {
        sender,
        conversationId: convo,
        attemptId: newSendAttemptId(),
        original: draft,
        final: edited,
        receipt,
      });
      assert.equal(blocked.status, 409);
      assert.equal("code" in blocked ? blocked.code : "", "edit_not_reviewed");
      assert.equal(rows(db, "messages").length, 0);
      assert.equal(rows(db, "parent_notifications").length, 0);
      // The exact reviewed text sends.
      const ok = await approve(db, { sender, conversationId: convo, attemptId: newSendAttemptId(), original: draft, final: suggestion, receipt, readMessage: quietRead });
      assert.equal(ok.status, 200);
      // The acknowledged edit sends, and the message keeps the first draft as its original.
      const acknowledged = await approve(db, {
        sender,
        conversationId: convo,
        attemptId: newSendAttemptId(),
        original: draft,
        final: edited,
        receipt,
        editAck: true,
        readMessage: quietRead,
      });
      assert.equal(acknowledged.status, 200);
      assert.deepEqual(
        rows(db, "messages").map((row) => [row.original_content, row.ai_rewritten_content]),
        [
          [draft, suggestion],
          [draft, edited],
        ]
      );
    }
  }

  // ===== 2. MESSAGE IDEMPOTENCY ======================================================================
  {
    // The attempt id is stable for one approval of one final text and fresh for any other.
    let n = 0;
    const make = () => `attempt-id-${String(++n).padStart(8, "0")}`;
    const a = nextSendAttempt(null, "Hello there", make);
    assert.equal(nextSendAttempt(a, "  Hello there\r\n", make), a, "a retry of the same text keeps its attempt");
    const b = nextSendAttempt(a, "Hello there, friend", make);
    assert.notEqual(b.id, a.id, "different text is a different approval");
    assert.notEqual(nextSendAttempt(null, "Hello there", make).id, a.id, "a new approval of identical text is a new attempt");
    assert.notEqual(newSendAttemptId(), newSendAttemptId());
    assert.equal(validSendAttemptId(newSendAttemptId()) !== null, true);
    assert.equal(validSendAttemptId(""), null);
    assert.equal(validSendAttemptId("short"), null);
    assert.equal(validSendAttemptId("has spaces in the id value"), null);
    assert.equal(validSendAttemptId(undefined), null);

    for (const [sender, receiver, convo] of [
      [ASHLEY, KEVIN, "conv-to-kevin"],
      [KEVIN, ASHLEY, "conv-to-ashley"],
    ] as const) {
      const text = "Can we move pickup to 6 on Friday?";
      const receipt = issueReviewReceipt({ userId: sender, draft: text, status: "reviewed", key: KEY });
      const make2 = (attemptId: string) => ({ sender, conversationId: convo, attemptId, original: text, final: text, receipt, readMessage: quietRead });

      // A retry of the same attempt is one message and one notice.
      const db = household();
      db.uniqueKeys.messages = [["sender_id", "send_attempt_id"]];
      const attemptId = newSendAttemptId();
      const sentOnce = await approve(db, make2(attemptId));
      const retried = await approve(db, make2(attemptId));
      const retriedAgain = await approve(db, make2(attemptId));
      assert.equal(sentOnce.status, 200);
      assert.equal(sentOnce.status === 200 && sentOnce.duplicate, false);
      assert.equal(retried.status === 200 && retried.duplicate, true);
      assert.equal(retriedAgain.status === 200 && retriedAgain.duplicate, true);
      assert.equal(rows(db, "messages").length, 1);
      assert.equal(retried.status === 200 && retried.messageId, sentOnce.status === 200 && sentOnce.messageId);
      assert.equal(rows(db, "parent_notifications").length, 1);
      assert.equal(rows(db, "parent_notifications")[0].user_id, receiver);

      // Two separate approvals of identical text are two messages, sent seconds apart.
      const second = await approve(db, make2(newSendAttemptId()));
      assert.equal(second.status, 200);
      assert.equal(second.status === 200 && second.duplicate, false);
      assert.equal(rows(db, "messages").length, 2);
      assert.deepEqual(
        rows(db, "messages").map((row) => row.ai_rewritten_content),
        [text, text]
      );
      assert.equal(rows(db, "parent_notifications").length, 2);
      assert.notEqual(rows(db, "parent_notifications")[0].message, rows(db, "parent_notifications")[1].message);

      // The same attempt with other text is refused and saves nothing.
      const conflict = await approve(db, {
        ...make2(attemptId),
        final: `${text} Thanks.`,
        receipt: issueReviewReceipt({ userId: sender, draft: `${text} Thanks.`, status: "reviewed", key: KEY }),
      });
      assert.equal(conflict.status, 409);
      assert.equal("code" in conflict ? conflict.code : "", "send_attempt_conflict");
      assert.equal(rows(db, "messages").length, 2);

      // A parallel save of the same attempt lands on the unique index and returns the saved message.
      const racedId = newSendAttemptId();
      const winner = await insertOutgoingMessage(admin(db) as never, {
        row: { case_id: CASE, conversation_id: convo, direction: "outgoing", sender_id: sender, original_content: text, ai_rewritten_content: text },
        senderId: sender,
        attemptId: racedId,
        stored: true,
        text,
      });
      assert.equal(winner.ok && !winner.duplicate, true);
      const loser = await insertOutgoingMessage(admin(db) as never, {
        row: { case_id: CASE, conversation_id: convo, direction: "outgoing", sender_id: sender, original_content: text, ai_rewritten_content: text },
        senderId: sender,
        attemptId: racedId,
        stored: true,
        text,
      });
      assert.equal(loser.ok && loser.duplicate, true);
      assert.equal(rows(db, "messages").length, 3);

      // Before the migration is applied, sends still work, without idempotency.
      const early = household();
      early.missingColumns.messages = ["send_attempt_id"];
      const earlyId = newSendAttemptId();
      const first = await approve(early, make2(earlyId));
      assert.equal(first.status, 200);
      assert.equal(rows(early, "messages").length, 1);
      assert.equal("send_attempt_id" in rows(early, "messages")[0], false);
    }

    // Attempt ids belong to the sender: both parents may hold the same id without colliding.
    {
      const db = household();
      db.uniqueKeys.messages = [["sender_id", "send_attempt_id"]];
      const sharedId = newSendAttemptId();
      const textA = "From Ashley";
      const textK = "From Kevin";
      const fromAshley = await approve(db, {
        sender: ASHLEY, conversationId: "conv-to-kevin", attemptId: sharedId, original: textA, final: textA,
        receipt: issueReviewReceipt({ userId: ASHLEY, draft: textA, status: "reviewed", key: KEY }), readMessage: quietRead,
      });
      const fromKevin = await approve(db, {
        sender: KEVIN, conversationId: "conv-to-ashley", attemptId: sharedId, original: textK, final: textK,
        receipt: issueReviewReceipt({ userId: KEVIN, draft: textK, status: "reviewed", key: KEY }), readMessage: quietRead,
      });
      assert.equal(fromAshley.status, 200);
      assert.equal(fromKevin.status, 200);
      assert.equal(rows(db, "messages").length, 2);
      assert.deepEqual(rows(db, "parent_notifications").map((row) => row.user_id).sort(), [ASHLEY, KEVIN].sort());
    }

    // Sage proposal idempotency is intact for both parents, with no attempt id involved.
    for (const [sender, to] of [
      [ASHLEY, "kevin.reply@example.com"],
      [KEVIN, "ashley.reply@example.com"],
    ] as const) {
      const db = household();
      const tasks: Promise<unknown>[] = [];
      const send = () =>
        deliverParentMessage(admin(db), {
          caseId: CASE,
          senderId: sender,
          body: "Sage proposal text",
          recipientEmail: to,
          subject: "Schedule",
          proposalId: `prop-${sender}`,
          runInBackground: (task) => void tasks.push(task),
          readMessage: quietRead,
        });
      const one = await send();
      const two = await send();
      await Promise.all(tasks);
      assert.ok(one.ok && two.ok);
      if (one.ok && two.ok) {
        assert.equal(one.created, true);
        assert.equal(two.created, false);
        assert.equal(one.messageId, two.messageId);
      }
      assert.equal(rows(db, "messages").length, 1);
      assert.equal(rows(db, "parent_notifications").length, 1);
    }

    // The fixed-window text rule is gone.
    const route = readFileSync(join(process.cwd(), "app/api/messages/approve/route.ts"), "utf8");
    assert.equal(/DUPLICATE_SEND_WINDOW|duplicateSince/.test(route), false);
    assert.match(route, /decideSendAttempt\(/);
    assert.match(route, /insertOutgoingMessage\(/);
    assert.ok(route.indexOf("decideSendAttempt(") < route.indexOf("reviewGate("), "a retry is answered before the review gate");
    for (const file of [
      "components/messages/messages-split-view.tsx",
      "components/messages/compose-bar.tsx",
      "components/dashboard/dashboard-status-cards.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      assert.match(source, /send_attempt_id/, `${file} sends without an attempt id`);
      assert.match(source, /nextSendAttempt\(/, `${file} does not derive its attempt id`);
      assert.match(source, /onReviewEdit=/, `${file} lets edited text skip review`);
    }
    const cards = readFileSync(join(process.cwd(), "components/sage/proposal-card-list.tsx"), "utf8");
    assert.match(cards, /onReviewEdit=/);
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261028160000_messages_send_attempt.sql"), "utf8");
    assert.match(migration, /send_attempt_id/);
    assert.match(migration, /create unique index/i);
  }

  // ===== 3. DURABLE RECIPIENT NOTIFICATION ===========================================================
  {
    const noticeRef = (db: FakeDb, userId: string) =>
      rows(db, "parent_notifications").filter((row) => row.user_id === userId && row.type === "coparent_message");

    for (const [sender, receiver, to, name] of [
      [ASHLEY, KEVIN, "kevin.reply@example.com", "Ashley"],
      [KEVIN, ASHLEY, "ashley.reply@example.com", "Kevin"],
    ] as const) {
      // Sage's reading fails: the basic notice remains.
      {
        const db = household();
        const tasks: Promise<unknown>[] = [];
        const result = await deliverParentMessage(admin(db), {
          caseId: CASE,
          senderId: sender,
          body: "Please look at the schedule.",
          recipientEmail: to,
          subject: "Schedule",
          proposalId: `p-${sender}-fail`,
          runInBackground: (task) => void tasks.push(task),
          readMessage: async () => {
            throw new Error("model unavailable");
          },
        });
        await Promise.all(tasks);
        assert.ok(result.ok);
        const notices = noticeRef(db, receiver);
        assert.equal(notices.length, 1);
        assert.equal(notices[0].case_id, CASE);
        const parsed = readMessageRef(String(notices[0].message));
        assert.equal(parsed.messageId, result.ok ? result.messageId : "");
        assert.equal(parsed.text, incomingNoticeCopy(name));
        assert.equal(noticeRef(db, sender).length, 0, "the sender is never notified of their own message");
      }

      // Sage's reading never finishes: the notice is saved before the call returns.
      {
        const db = household();
        const result = await deliverParentMessage(admin(db), {
          caseId: CASE,
          senderId: sender,
          body: "Another note.",
          recipientEmail: to,
          subject: "Schedule",
          proposalId: `p-${sender}-hang`,
          runInBackground: () => undefined,
          readMessage: () => new Promise(() => undefined),
        });
        assert.ok(result.ok);
        assert.equal(noticeRef(db, receiver).length, 1);
        assert.equal(rows(db, "sage_journal_messages").length, 0);
      }

      // The first notification write fails once: the second attempt saves it.
      {
        const db = household();
        db.failInserts.parent_notifications = 1;
        const result = await deliverParentMessage(admin(db), {
          caseId: CASE,
          senderId: sender,
          body: "Third note.",
          recipientEmail: to,
          subject: "Schedule",
          proposalId: `p-${sender}-flaky`,
          runInBackground: () => undefined,
          readMessage: quietRead,
        });
        assert.ok(result.ok);
        assert.equal(noticeRef(db, receiver).length, 1);
      }

      // Both notification writes fail: the message is saved, and a retry restores the notice once.
      {
        const db = household();
        db.failInserts.parent_notifications = 2;
        const tasks: Promise<unknown>[] = [];
        const options = {
          caseId: CASE,
          senderId: sender,
          body: "Fourth note.",
          recipientEmail: to,
          subject: "Schedule",
          proposalId: `p-${sender}-down`,
          runInBackground: (task: Promise<unknown>) => void tasks.push(task),
          readMessage: quietRead,
        };
        const first = await deliverParentMessage(admin(db), options);
        assert.ok(first.ok);
        assert.equal(rows(db, "messages").length, 1);
        assert.equal(noticeRef(db, receiver).length, 0);
        const retry = await deliverParentMessage(admin(db), options);
        const again = await deliverParentMessage(admin(db), options);
        await Promise.all(tasks);
        assert.ok(retry.ok && again.ok);
        assert.equal(rows(db, "messages").length, 1);
        assert.equal(noticeRef(db, receiver).length, 1, "the retry restores the notice exactly once");
      }

      // The Messages-route retry path: a saved message with no notice gets one from announceSavedMessage.
      {
        const db = household();
        const convo = sender === ASHLEY ? "conv-to-kevin" : "conv-to-ashley";
        db.seed("messages", [
          { id: "saved-1", case_id: CASE, conversation_id: convo, direction: "outgoing", sender_id: sender, ai_rewritten_content: "Saved text" },
        ]);
        const tasks: Promise<unknown>[] = [];
        const announced = await announceSavedMessage(admin(db), {
          caseId: CASE,
          senderId: sender,
          messageId: "saved-1",
          conversationId: convo,
          runInBackground: (task) => void tasks.push(task),
          readMessage: quietRead,
        });
        assert.equal(announced?.createdNotice, true);
        const repeated = await announceSavedMessage(admin(db), {
          caseId: CASE,
          senderId: sender,
          messageId: "saved-1",
          conversationId: convo,
          runInBackground: (task) => void tasks.push(task),
          readMessage: quietRead,
        });
        await Promise.all(tasks);
        assert.equal(repeated?.createdNotice, false);
        assert.equal(repeated?.notified, true);
        assert.equal(noticeRef(db, receiver).length, 1);
        assert.equal(noticeRef(db, sender).length, 0);
      }

      // Sage's enrichment is added after the notice, and does not replace it.
      {
        const db = household();
        const tasks: Promise<unknown>[] = [];
        const result = await deliverParentMessage(admin(db), {
          caseId: CASE,
          senderId: sender,
          body: "Enriched note.",
          recipientEmail: to,
          subject: "Schedule",
          proposalId: `p-${sender}-enrich`,
          runInBackground: (task) => void tasks.push(task),
          readMessage: async (messageId, _failed, options) => {
            db.seed("sage_journal_messages", [
              { user_id: options?.recipientUserId, role: "sage", source_message_id: messageId, content: "Sage briefing" },
            ]);
          },
        });
        await Promise.all(tasks);
        assert.ok(result.ok);
        assert.equal(noticeRef(db, receiver).length, 1);
        assert.equal(rows(db, "sage_journal_messages").length, 1);
      }
    }

    // The reference round-trips and is hidden from the reader.
    const stored = withMessageRef("Ashley sent you a message. It is saved in Messages.", "msg-123");
    assert.deepEqual(readMessageRef(stored), { text: "Ashley sent you a message. It is saved in Messages.", messageId: "msg-123" });
    assert.deepEqual(readMessageRef("An older notice"), { text: "An older notice", messageId: null });
    assert.equal(messageNoticeHref("conv-9"), "/messages?conversation_id=conv-9");
    assert.equal(messageNoticeHref(null), null);
    assert.equal(withMessageRef("x", "bad id with spaces"), "x");

    // Structural: the notice is written before Sage's reading, and the route reads the reference.
    const deliver = readFileSync(join(process.cwd(), "lib/messages/deliver-parent-message.ts"), "utf8");
    const announceBody = deliver.slice(deliver.indexOf("export async function announceIncomingMessage"));
    assert.ok(announceBody.indexOf("ensureIncomingNotice(") < announceBody.indexOf("sageHeardAboutMessage("));
    const notifications = readFileSync(join(process.cwd(), "app/api/notifications/route.ts"), "utf8");
    assert.match(notifications, /readMessageRef/);
  }

  console.log("send-corrections tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
