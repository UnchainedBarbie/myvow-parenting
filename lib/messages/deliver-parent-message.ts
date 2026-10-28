import { ServerClient, Message, Header } from "postmark";
import type { getServiceRoleClient } from "@/lib/supabase/server";
import { messageAttachmentDecision } from "@/lib/sage/attachment-role";
import { estimateIntensity } from "@/lib/sage/intensity";
import {
  chooseSharedConversation,
  incomingNoticeCopy,
  resolveCaseRecipient,
  unassignedParentRepair,
  type RepairConversation,
} from "@/lib/messages/parent-message-visibility";
import { parentDirectory, type ParentDirectory } from "@/lib/messages/case-parents";
import { messageRefPattern, withMessageRef } from "@/lib/messages/incoming-notice";
import { resolveReceivingParent } from "@/lib/messages/receiving-parent";
import {
  ATTACHMENT_NOT_SHAREABLE_CODE,
  attachmentBlockedMessage,
  attachmentPreflight,
  type AttachmentIntent,
  type AttachmentOutcome,
} from "@/lib/messages/send-safety";
import { ensureConversationSession, processInboundMessageForSage } from "@/lib/sage/process-inbox-item";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type SendProposal = {
  executed?: boolean;
  result_message_id?: string | null;
  send_claim_at?: string | null;
  draft?: string | null;
  revised_text?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  subject?: string | null;
};

export function messageSendDecision(
  proposal: SendProposal,
  now = Date.now()
): "send" | "already_sent" | "in_progress" {
  if (proposal.executed === true) return "already_sent";
  if ((proposal.result_message_id ?? "").trim()) return "already_sent";
  const claim = (proposal.send_claim_at ?? "").trim();
  if (claim) {
    const at = Date.parse(claim);
    if (Number.isFinite(at) && now - at < 60_000) return "in_progress";
  }
  return "send";
}

export function approvedMessageBody(proposal: SendProposal): string {
  const revised = (proposal.revised_text ?? "").trim();
  const draft = (proposal.draft ?? "").trim();
  return revised || draft;
}

/** Fields stored for a parent-to-parent send. Delivery is not marked confirmed here. */
export function parentMessageFields(input: {
  caseId: string;
  senderId: string;
  conversationId: string | null;
  body: string;
  recipientEmail: string;
  proposalId?: string | null;
}): Record<string, unknown> {
  const intensity = estimateIntensity(input.body);
  const proposalId = (input.proposalId ?? "").trim();
  return {
    case_id: input.caseId,
    conversation_id: input.conversationId,
    direction: "outgoing",
    sender_id: input.senderId,
    original_content: input.body,
    ai_rewritten_content: input.body,
    ai_rewritten: false,
    current_status: "sent",
    delivery_status: "sent",
    delivered_at: null,
    recipient_email: input.recipientEmail,
    intensity_score: intensity.score,
    intensity_flag: intensity.flag,
    is_emergency: false,
    ...(proposalId ? { sage_proposal_id: proposalId } : {}),
  };
}

/** Postmark accepted the send. This is not mailbox delivery, so delivered_at stays empty. */
export function acceptedEmailFields(emailMessageId: string): Record<string, unknown> {
  return {
    delivery_status: "email_accepted",
    delivered_at: null,
    email_message_id: emailMessageId,
  };
}

async function sendingPaused(admin: Admin, userId: string): Promise<string | null> {
  const { data } = await admin
    .from("cool_off")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .gt("ends_at", new Date().toISOString())
    .maybeSingle();
  if (data) {
    return "Sending is paused while you take a break. It will be available again when your break ends.";
  }
  return null;
}

async function conversationForParents(
  admin: Admin,
  input: {
    caseId: string;
    senderId: string;
    recipientEmail: string;
    senderEmails: string[];
    subject?: string | null;
  }
): Promise<{ id: string; subject: string; emailThreadId: string | null } | { error: string }> {
  const { data } = await admin
    .from("conversations")
    .select("id, subject, coparent_email, email_thread_id, updated_at")
    .eq("case_id", input.caseId)
    .order("updated_at", { ascending: false });
  const rows = (data ?? []) as {
    id?: string;
    subject?: string | null;
    coparent_email?: string | null;
    email_thread_id?: string | null;
  }[];
  const existingId = chooseSharedConversation({
    conversations: rows
      .filter((row) => row.id)
      .map((row) => ({
        id: row.id as string,
        coparentEmail: row.coparent_email ?? null,
        subject: row.subject ?? null,
      })),
    recipientEmail: input.recipientEmail,
    senderEmails: input.senderEmails,
    subject: input.subject,
  });
  const existing = rows.find((row) => row.id === existingId);
  if (existing?.id) {
    return {
      id: existing.id,
      subject: (existing.subject ?? "").trim(),
      emailThreadId: existing.email_thread_id ?? null,
    };
  }
  const subject = (input.subject ?? "").trim() || "Message";
  const created = await admin
    .from("conversations")
    .insert({
      case_id: input.caseId,
      subject,
      topic: "General",
      category: "General",
      created_by: input.senderId,
      coparent_email: input.recipientEmail.trim(),
      child_id: null,
    })
    .select("id, subject, email_thread_id")
    .single();
  if (created.error || !created.data) {
    return { error: created.error?.message ?? "The conversation could not be saved." };
  }
  const row = created.data as { id: string; subject?: string | null; email_thread_id?: string | null };
  return { id: row.id, subject: (row.subject ?? "").trim(), emailThreadId: row.email_thread_id ?? null };
}

async function savedProposalMessage(
  admin: Admin,
  caseId: string,
  proposalId: string
): Promise<{
  id: string;
  conversationId: string | null;
  deliveryStatus: "sent" | "email_accepted" | "delivered";
} | null> {
  const { data, error } = await admin
    .from("messages")
    .select("id, delivery_status, conversation_id")
    .eq("case_id", caseId)
    .eq("sage_proposal_id", proposalId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) {
    if (/sage_proposal_id/i.test(error.message ?? "")) return null;
    return null;
  }
  const row = ((data ?? []) as { id?: string; delivery_status?: string | null; conversation_id?: string | null }[])[0];
  if (!row?.id) return null;
  return {
    id: row.id,
    conversationId: (row.conversation_id ?? "").trim() || null,
    deliveryStatus:
      row.delivery_status === "email_accepted"
        ? "email_accepted"
        : row.delivery_status === "delivered"
          ? "delivered"
          : "sent",
  };
}

/** True when this parent's Sage already has a row for the message. Null when that cannot be told. */
async function sageHeardAboutMessage(admin: Admin, userId: string, messageId: string): Promise<boolean | null> {
  const found = await admin
    .from("sage_journal_messages")
    .select("id")
    .eq("user_id", userId)
    .eq("source_message_id", messageId)
    .limit(1);
  if (found.error) {
    if (!/source_message_id/i.test(found.error.message ?? "")) {
      console.error("[deliver-parent-message] sage lookup:", found.error.message);
    }
    return null;
  }
  return (found.data ?? []).length > 0;
}

/**
 * The receiving parent's Sage session for this conversation gets one plain notice.
 * It is that parent's own session, so the sender's private Sage conversations stay out of reach.
 */
async function noteIncomingInConversationSession(
  admin: Admin,
  input: { recipientUserId: string; conversationId: string; senderName: string; messageId: string }
): Promise<void> {
  const { data: conversation } = await admin
    .from("conversations")
    .select("subject")
    .eq("id", input.conversationId)
    .maybeSingle();
  const subject = ((conversation as { subject?: string | null } | null)?.subject ?? "").trim() || "(no subject)";
  const session = await ensureConversationSession(admin, {
    userId: input.recipientUserId,
    conversationId: input.conversationId,
    title: subject,
  });
  if (!session.id) {
    console.error("[deliver-parent-message] sage session:", session.error ?? "missing session");
    return;
  }
  const content = incomingNoticeCopy(input.senderName);
  const journal = await admin.from("sage_journal_messages").insert({
    user_id: input.recipientUserId,
    role: "sage",
    session_id: session.id,
    source_message_id: input.messageId,
    content,
  });
  if (journal.error && /source_message_id/i.test(journal.error.message ?? "")) {
    await admin
      .from("sage_journal_messages")
      .insert({ user_id: input.recipientUserId, role: "sage", session_id: session.id, content });
  } else if (journal.error) {
    console.error("[deliver-parent-message] sage journal:", journal.error.message);
    return;
  }
  await admin.from("sage_sessions").update({ updated_at: new Date().toISOString() }).eq("id", session.id);
}

export type AnnounceResult = {
  /** The receiving parent has a notice for this message, whether it was added now or earlier. */
  notified: boolean;
  /** This call added the notice. */
  createdNotice: boolean;
  /** This call started Sage's reading. */
  startedReading: boolean;
};

/**
 * The basic notice, saved before any AI work. It is found by its message reference, so a retry
 * returns the existing notice. One more attempt covers a momentary database error.
 */
async function ensureIncomingNotice(
  admin: Admin,
  input: { caseId: string; messageId: string; recipientUserId: string; senderName: string }
): Promise<{ notified: boolean; created: boolean }> {
  const pattern = messageRefPattern(input.messageId);
  if (!pattern) return { notified: false, created: false };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await admin
      .from("parent_notifications")
      .select("id")
      .eq("user_id", input.recipientUserId)
      .eq("type", "coparent_message")
      .like("message", pattern)
      .limit(1);
    if (!existing.error && ((existing.data ?? []) as unknown[]).length > 0) {
      return { notified: true, created: false };
    }
    const inserted = await admin.from("parent_notifications").insert({
      case_id: input.caseId,
      user_id: input.recipientUserId,
      type: "coparent_message",
      title: "New message",
      message: withMessageRef(incomingNoticeCopy(input.senderName), input.messageId),
      priority: "normal",
    });
    if (!inserted.error) return { notified: true, created: true };
    console.error(`[deliver-parent-message] notification attempt ${attempt + 1}:`, inserted.error.message);
  }
  console.error(`[deliver-parent-message] notification_failed message_id=${input.messageId}`);
  return { notified: false, created: false };
}

/**
 * One incoming-message announcement for the receiving parent, shared by every send path.
 *  1. The basic notice in the receiving parent's own list. It is saved first and stands on its own.
 *  2. Sage reads the message for that parent through the same inbound pipeline email uses.
 *  3. A plain notice in that parent's conversation session when Sage had nothing to add.
 * Safe to call again for the same message. The notice is never added twice, and a reading that
 * did not finish is attempted again. A failed or interrupted reading never removes the notice.
 */
export async function announceIncomingMessage(
  admin: Admin,
  input: {
    caseId: string;
    conversationId: string | null;
    messageId: string;
    recipientUserId: string;
    senderName: string;
    /** Runs the Sage reading after the response is sent. Omit to wait for it. */
    runInBackground?: (task: Promise<unknown>) => void;
    /** Test seam for the Sage reading. */
    readMessage?: typeof processInboundMessageForSage;
  }
): Promise<AnnounceResult> {
  const notice = await ensureIncomingNotice(admin, input);
  const base = { notified: notice.notified, createdNotice: notice.created };

  const heard = await sageHeardAboutMessage(admin, input.recipientUserId, input.messageId);
  const conversationId = (input.conversationId ?? "").trim();
  if (heard === true || !conversationId) return { ...base, startedReading: false };

  const read = input.readMessage ?? processInboundMessageForSage;
  const task = (async () => {
    try {
      await read(input.messageId, [], { recipientUserId: input.recipientUserId });
    } catch (readError) {
      console.error("[deliver-parent-message] sage reading:", readError);
    }
    try {
      const heardNow = await sageHeardAboutMessage(admin, input.recipientUserId, input.messageId);
      if (heardNow === false) {
        await noteIncomingInConversationSession(admin, {
          recipientUserId: input.recipientUserId,
          conversationId,
          senderName: input.senderName,
          messageId: input.messageId,
        });
      }
    } catch (noteError) {
      // The basic notice is already saved. The session note is an addition.
      console.error("[deliver-parent-message] session note:", noteError);
    }
  })();
  if (input.runInBackground) input.runInBackground(task);
  else await task;
  return { ...base, startedReading: true };
}

/**
 * Announce a message that is already saved. Used when a send is retried, so a message saved by an
 * attempt that stopped before its notice was written still reaches the receiving parent.
 * The receiving parent comes from the case, not from the primary account.
 */
export async function announceSavedMessage(
  admin: Admin,
  input: {
    caseId: string;
    senderId: string;
    messageId: string;
    conversationId: string | null;
    runInBackground?: (task: Promise<unknown>) => void;
    readMessage?: typeof processInboundMessageForSage;
  }
): Promise<AnnounceResult | null> {
  const conversationId = (input.conversationId ?? "").trim();
  const directory = await parentDirectory(admin, input.caseId, input.senderId);
  let conversationEmail: string | null = null;
  if (conversationId) {
    const { data } = await admin
      .from("conversations")
      .select("coparent_email")
      .eq("id", conversationId)
      .eq("case_id", input.caseId)
      .maybeSingle();
    conversationEmail = (data as { coparent_email?: string | null } | null)?.coparent_email ?? null;
  }
  const receiver = resolveReceivingParent({
    senderId: input.senderId,
    recipientEmails: [conversationEmail],
    parents: directory.parents,
  });
  if (!receiver.ok) {
    console.error(`[deliver-parent-message] no receiving parent message_id=${input.messageId}: ${receiver.error}`);
    return null;
  }
  return announceIncomingMessage(admin, {
    caseId: input.caseId,
    conversationId: conversationId || null,
    messageId: input.messageId,
    recipientUserId: receiver.userId,
    senderName: directory.senderName,
    runInBackground: input.runInBackground,
    readMessage: input.readMessage,
  });
}

type UnassignedRow = {
  id?: string;
  sender_id?: string | null;
  recipient_email?: string | null;
  sender_external_email?: string | null;
  email_message_id?: string | null;
};

/** Attach an already-saved parent send only when the shared thread is already unambiguous. */
export async function linkUnassignedParentMessages(admin: Admin, caseId: string): Promise<void> {
  const listed = await admin
    .from("messages")
    .select("id, sender_id, recipient_email, sender_external_email, email_message_id")
    .eq("case_id", caseId)
    .is("conversation_id", null)
    .eq("direction", "outgoing")
    .not("sender_id", "is", null);
  let rows = (listed.data ?? []) as UnassignedRow[];
  if (listed.error) {
    const message = listed.error.message ?? "";
    if (/recipient_email/i.test(message)) return;
    if (!/sender_external_email|email_message_id/i.test(message)) return;
    const slim = await admin
      .from("messages")
      .select("id, sender_id, recipient_email")
      .eq("case_id", caseId)
      .is("conversation_id", null)
      .eq("direction", "outgoing")
      .not("sender_id", "is", null);
    if (slim.error || !slim.data?.length) return;
    rows = slim.data as UnassignedRow[];
  }
  if (!rows.length) return;

  const conversations = await admin
    .from("conversations")
    .select("id, case_id, coparent_email")
    .eq("case_id", caseId);
  if (conversations.error) return;
  const shared: RepairConversation[] = ((conversations.data ?? []) as {
    id?: string;
    case_id?: string | null;
    coparent_email?: string | null;
  }[])
    .filter((row) => (row.id ?? "").trim())
    .map((row) => ({
      id: (row.id ?? "").trim(),
      caseId: (row.case_id ?? caseId).trim(),
      coparentEmail: row.coparent_email ?? null,
    }));

  const emailIds = [
    ...new Set(rows.map((row) => (row.email_message_id ?? "").trim()).filter(Boolean)),
  ];
  const intakeBranch = new Map<string, string>();
  if (emailIds.length > 0) {
    const intake = await admin
      .from("email_intake")
      .select("message_id, branch")
      .eq("case_id", caseId)
      .in("message_id", emailIds);
    if (intake.error) {
      rows = rows.filter((row) => !(row.email_message_id ?? "").trim());
    } else {
      for (const row of (intake.data ?? []) as { message_id?: string | null; branch?: string | null }[]) {
        const id = (row.message_id ?? "").trim();
        if (id) intakeBranch.set(id, (row.branch ?? "").trim());
      }
    }
  }

  const directories = new Map<string, ParentDirectory>();
  for (const raw of rows) {
    const messageId = (raw.id ?? "").trim();
    const senderId = (raw.sender_id ?? "").trim();
    if (!messageId || !senderId) continue;
    let directory = directories.get(senderId);
    if (!directory) {
      directory = await parentDirectory(admin, caseId, senderId);
      directories.set(senderId, directory);
    }
    const emailMessageId = (raw.email_message_id ?? "").trim();
    const repair = unassignedParentRepair({
      message: {
        caseId,
        senderId,
        recipientEmail: raw.recipient_email ?? null,
        direction: "outgoing",
        senderExternalEmail: raw.sender_external_email ?? null,
        intakeBranch: emailMessageId ? intakeBranch.get(emailMessageId) ?? null : null,
      },
      caseId,
      parents: directory.parents,
      conversations: shared,
    });
    if (!repair) continue;
    const linked = await admin
      .from("messages")
      .update({ conversation_id: repair.conversationId })
      .eq("id", messageId)
      .eq("case_id", caseId)
      .is("conversation_id", null)
      .select("id");
    if (linked.error || !(linked.data ?? []).length) continue;
    await announceIncomingMessage(admin, {
      caseId,
      conversationId: repair.conversationId,
      messageId,
      recipientUserId: repair.recipientUserId,
      senderName: directory.senderName,
    });
  }
}

export async function deliverParentMessage(
  admin: Admin,
  input: {
    caseId: string;
    senderId: string;
    body: string;
    recipientEmail: string;
    subject?: string | null;
    proposalId?: string | null;
    /** The file the parent expects to share with this message. */
    attachment?: AttachmentIntent | null;
    /** The parent chose to send without a file that cannot be shared. */
    acknowledgeAttachmentOmission?: boolean;
    runInBackground?: (task: Promise<unknown>) => void;
    /** Test seam for the Sage reading of the new message. */
    readMessage?: typeof processInboundMessageForSage;
  }
): Promise<
  | {
      ok: true;
      messageId: string;
      deliveryStatus: "sent" | "email_accepted" | "delivered";
      recipientEmail: string;
      recipientUserId: string | null;
      /** False when this call found the message already saved. */
      created: boolean;
      attachment: AttachmentOutcome;
    }
  | { ok: false; status: number; message: string; code?: string }
> {
  const body = input.body.trim();
  const recipientEmail = input.recipientEmail.trim();
  if (!body) return { ok: false, status: 400, message: "The message is empty." };
  if (!recipientEmail) {
    return { ok: false, status: 400, message: "Add a recipient email before sending." };
  }
  const paused = await sendingPaused(admin, input.senderId);
  if (paused) return { ok: false, status: 403, message: paused };

  const proposalId = (input.proposalId ?? "").trim();
  if (proposalId) {
    const existing = await savedProposalMessage(admin, input.caseId, proposalId);
    if (existing) {
      // The saved message may predate its notice if the first attempt stopped early. Announcing is idempotent.
      try {
        await announceSavedMessage(admin, {
          caseId: input.caseId,
          senderId: input.senderId,
          messageId: existing.id,
          conversationId: existing.conversationId,
          runInBackground: input.runInBackground,
          readMessage: input.readMessage,
        });
      } catch (error) {
        console.error("[deliver-parent-message] announce on retry:", error);
      }
      return {
        ok: true,
        messageId: existing.id,
        deliveryStatus: existing.deliveryStatus,
        recipientEmail,
        recipientUserId: null,
        created: false,
        attachment: await savedAttachmentOutcome(admin, existing.id, input.attachment ?? null),
      };
    }
  }

  const directory = await parentDirectory(admin, input.caseId, input.senderId);
  if (!directory.parents.some((parent) => parent.userId === input.senderId)) {
    return { ok: false, status: 403, message: "You are not a parent on this case." };
  }
  const recipient = resolveCaseRecipient({
    senderId: input.senderId,
    recipientEmail,
    parents: directory.parents,
  });
  if ("error" in recipient) return { ok: false, status: 403, message: recipient.error };
  const recipientParent = directory.parents.find((parent) => parent.userId === recipient.userId);
  if (!recipientParent) {
    return { ok: false, status: 403, message: "That address is not a parent on this case." };
  }

  const intent = input.attachment ?? { expected: false, documentId: null, fileName: null };
  const preflight = attachmentPreflight({
    intent,
    eligibility: intent.documentId
      ? await attachmentEligibility(admin, {
          documentId: intent.documentId,
          caseId: input.caseId,
          senderId: input.senderId,
          recipientUserId: recipient.userId,
        })
      : null,
    acknowledgedOmission: input.acknowledgeAttachmentOmission === true,
  });
  if (preflight.action === "block") {
    return {
      ok: false,
      status: 409,
      code: ATTACHMENT_NOT_SHAREABLE_CODE,
      message: attachmentBlockedMessage({ fileName: preflight.fileName, reason: preflight.reason }),
    };
  }

  const conversation = await conversationForParents(admin, {
    caseId: input.caseId,
    senderId: input.senderId,
    recipientEmail,
    senderEmails: directory.senderEmails,
    subject: input.subject,
  });
  if ("error" in conversation) {
    return { ok: false, status: 500, message: conversation.error };
  }
  const fields = parentMessageFields({
    caseId: input.caseId,
    senderId: input.senderId,
    conversationId: conversation.id,
    body,
    recipientEmail,
    proposalId: input.proposalId,
  });

  let inserted = await admin.from("messages").insert(fields).select("id").single();
  for (let attempt = 0; attempt < 2 && inserted.error; attempt += 1) {
    const message = inserted.error.message ?? "";
    if (/sage_proposal_id/.test(message) && "sage_proposal_id" in fields) {
      delete fields.sage_proposal_id;
    } else if (/recipient_email/.test(message) && "recipient_email" in fields) {
      delete fields.recipient_email;
    } else {
      break;
    }
    inserted = await admin.from("messages").insert(fields).select("id").single();
  }
  if (inserted.error || !inserted.data) {
    return {
      ok: false,
      status: 500,
      message: inserted.error?.message ?? "The message could not be saved.",
    };
  }
  const messageId = (inserted.data as { id: string }).id;
  let attachment: AttachmentOutcome = { status: "none" };
  if (preflight.action === "send_with_file") {
    const linked = await linkMessageAttachment(admin, {
      messageId,
      documentId: preflight.documentId,
      senderId: input.senderId,
      conversationId: conversation.id,
    });
    attachment = linked.ok
      ? { status: "shared_in_myvow", documentId: preflight.documentId, fileName: preflight.fileName }
      : { status: "share_failed", fileName: preflight.fileName, reason: linked.reason };
  } else if (preflight.action === "send_without_file_acknowledged") {
    attachment = { status: "omitted_acknowledged", fileName: preflight.fileName, reason: preflight.reason };
  }
  try {
    await announceIncomingMessage(admin, {
      caseId: input.caseId,
      conversationId: conversation.id,
      messageId,
      recipientUserId: recipient.userId,
      senderName: directory.senderName,
      runInBackground: input.runInBackground,
      readMessage: input.readMessage,
    });
  } catch (error) {
    // The message is saved. A retry announces it again.
    console.error("[deliver-parent-message] announce:", error);
  }
  let deliveryStatus: "sent" | "email_accepted" | "delivered" = "sent";

  const { data: caseRow } = await admin
    .from("cases")
    .select("ingest_email")
    .eq("id", input.caseId)
    .maybeSingle();
  const ingestEmail = ((caseRow as { ingest_email?: string | null } | null)?.ingest_email ?? "").trim();
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (token && ingestEmail && conversation) {
    const emailMessageId = `<msg-${messageId}@myvow.in>`;
    const subject =
      (input.subject ?? "").trim() ||
      (conversation.emailThreadId ? `Re: ${conversation.subject}` : conversation.subject) ||
      "Message";
    const headers: { Name: string; Value: string }[] = [
      { Name: "Message-ID", Value: emailMessageId },
    ];
    if (conversation.emailThreadId) {
      headers.push({ Name: "In-Reply-To", Value: conversation.emailThreadId });
      headers.push({ Name: "References", Value: conversation.emailThreadId });
    }
    try {
      const client = new ServerClient(token);
      const email = new Message(
        ingestEmail,
        subject,
        undefined,
        body,
        recipientEmail,
        undefined,
        undefined,
        ingestEmail,
        undefined,
        undefined,
        undefined,
        headers.map((header) => new Header(header.Name, header.Value)),
        undefined,
        undefined
      );
      await client.sendEmail(email);
      await admin.from("messages").update(acceptedEmailFields(emailMessageId)).eq("id", messageId);
      if (!conversation.emailThreadId) {
        await admin
          .from("conversations")
          .update({ email_thread_id: emailMessageId })
          .eq("id", conversation.id);
      }
      deliveryStatus = "email_accepted";
    } catch (error) {
      console.error("[deliver-parent-message] Postmark send failed:", error);
    }
  }

  return {
    ok: true,
    messageId,
    deliveryStatus,
    recipientEmail,
    recipientUserId: recipient.userId,
    created: true,
    attachment,
  };
}

/**
 * Can this document travel with a message from the sender to the resolved recipient?
 * The recipient is the parent the address resolved to, so any address on file works.
 * Null means the document could not be found.
 */
async function attachmentEligibility(
  admin: Admin,
  input: { documentId: string; caseId: string; senderId: string; recipientUserId: string }
): Promise<{ link: boolean; fileName: string; reason: string | null } | null> {
  const { data: doc } = await admin
    .from("documents")
    .select("id, case_id, uploaded_by, visibility, status, file_name, deleted_at")
    .eq("id", input.documentId)
    .maybeSingle();
  if (!doc) return { link: false, fileName: "", reason: "The file could not be found." };
  const row = doc as {
    case_id?: string | null;
    uploaded_by?: string | null;
    visibility?: string | null;
    status?: string | null;
    file_name?: string | null;
    deleted_at?: string | null;
  };
  if (row.deleted_at) {
    return { link: false, fileName: (row.file_name ?? "").trim(), reason: "That file is no longer available." };
  }
  const { data: member } = await admin
    .from("case_members")
    .select("user_id, role")
    .eq("case_id", input.caseId)
    .eq("user_id", input.recipientUserId)
    .maybeSingle();
  const recipientRole = ((member as { role?: string | null } | null)?.role ?? "").trim() || null;
  return messageAttachmentDecision({
    documentCaseId: row.case_id ?? "",
    messageCaseId: input.caseId,
    uploadedBy: row.uploaded_by ?? "",
    senderId: input.senderId,
    visibility: row.visibility ?? null,
    status: row.status ?? null,
    fileName: row.file_name ?? "",
    recipientUserId: input.recipientUserId,
    recipientRole,
    recipientOnCase: Boolean(member),
  });
}

async function linkMessageAttachment(
  admin: Admin,
  input: { messageId: string; documentId: string; senderId: string; conversationId: string | null }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await admin.from("message_documents").insert({
    message_id: input.messageId,
    document_id: input.documentId,
  });
  if (error) {
    console.error("[deliver-parent-message] message_documents", error.message);
    return { ok: false, reason: "The file could not be linked to the message." };
  }
  await admin.from("messages").update({ has_attachments: true }).eq("id", input.messageId);
  if (input.conversationId) {
    await admin.from("conversation_attachments").insert({
      conversation_id: input.conversationId,
      attachment_id: input.documentId,
      attachment_type: "document",
      created_by: input.senderId,
    });
  }
  return { ok: true };
}

/** A message found already saved reports the file it actually carries. */
async function savedAttachmentOutcome(
  admin: Admin,
  messageId: string,
  intent: AttachmentIntent | null
): Promise<AttachmentOutcome> {
  const { data } = await admin.from("message_documents").select("document_id").eq("message_id", messageId).limit(1);
  const documentId = ((data ?? []) as { document_id?: string }[])[0]?.document_id ?? "";
  if (documentId) {
    return { status: "shared_in_myvow", documentId, fileName: intent?.fileName ?? "attachment" };
  }
  return { status: "none" };
}
