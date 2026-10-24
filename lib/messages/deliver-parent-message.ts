import { ServerClient, Message, Header } from "postmark";
import type { getServiceRoleClient } from "@/lib/supabase/server";
import { messageAttachmentDecision } from "@/lib/sage/attachment-role";
import { estimateIntensity } from "@/lib/sage/intensity";
import {
  chooseSharedConversation,
  incomingNoticeCopy,
  resolveCaseRecipient,
  unassignedParentRepair,
  type CaseParentAddress,
  type RepairConversation,
} from "@/lib/messages/parent-message-visibility";

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

type ParentDirectory = {
  parents: (CaseParentAddress & { name: string })[];
  senderEmails: string[];
  senderName: string;
};

async function parentDirectory(admin: Admin, caseId: string, senderId: string): Promise<ParentDirectory> {
  const { data: members } = await admin
    .from("case_members")
    .select("id, user_id, role, display_name, external_email, invited_email, invited_name")
    .eq("case_id", caseId)
    .eq("role", "parent");
  const rows = (members ?? []) as {
    id?: string | null;
    user_id?: string | null;
    display_name?: string | null;
    external_email?: string | null;
    invited_email?: string | null;
    invited_name?: string | null;
  }[];
  const memberIds = rows.map((row) => (row.id ?? "").trim()).filter(Boolean);
  const userIds = rows.map((row) => (row.user_id ?? "").trim()).filter(Boolean);
  const registered = memberIds.length
    ? (
        await admin
          .from("case_member_emails")
          .select("case_member_id, email")
          .eq("case_id", caseId)
          .in("case_member_id", memberIds)
      ).data
    : [];
  const users = userIds.length
    ? (await admin.from("users").select("id, email, full_name").in("id", userIds)).data
    : [];
  const emailByMember = new Map<string, string[]>();
  for (const row of (registered ?? []) as { case_member_id?: string | null; email?: string | null }[]) {
    const memberId = (row.case_member_id ?? "").trim();
    const email = (row.email ?? "").trim();
    if (!memberId || !email) continue;
    const list = emailByMember.get(memberId) ?? [];
    list.push(email);
    emailByMember.set(memberId, list);
  }
  const userById = new Map(
    ((users ?? []) as { id?: string; email?: string | null; full_name?: string | null }[]).map((user) => [
      (user.id ?? "").trim(),
      user,
    ])
  );
  const parents = rows
    .map((row) => {
      const userId = (row.user_id ?? "").trim();
      if (!userId) return null;
      const user = userById.get(userId);
      const emails = [
        ...(emailByMember.get((row.id ?? "").trim()) ?? []),
        row.external_email ?? "",
        row.invited_email ?? "",
        user?.email ?? "",
      ].filter((email) => email.trim());
      const name =
        (row.display_name ?? "").trim() ||
        (row.invited_name ?? "").trim() ||
        (user?.full_name ?? "").trim() ||
        "Your co-parent";
      return { userId, emails, name };
    })
    .filter((parent): parent is CaseParentAddress & { name: string } => Boolean(parent));
  const sender = parents.find((parent) => parent.userId === senderId);
  return {
    parents,
    senderEmails: sender?.emails ?? [],
    senderName: sender?.name ?? "Your co-parent",
  };
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
): Promise<{ id: string; deliveryStatus: "sent" | "email_accepted" | "delivered" } | null> {
  const { data, error } = await admin
    .from("messages")
    .select("id, delivery_status")
    .eq("case_id", caseId)
    .eq("sage_proposal_id", proposalId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) {
    if (/sage_proposal_id/i.test(error.message ?? "")) return null;
    return null;
  }
  const row = ((data ?? []) as { id?: string; delivery_status?: string | null }[])[0];
  if (!row?.id) return null;
  return {
    id: row.id,
    deliveryStatus:
      row.delivery_status === "email_accepted"
        ? "email_accepted"
        : row.delivery_status === "delivered"
          ? "delivered"
          : "sent",
  };
}

async function notifyRecipient(
  admin: Admin,
  input: { caseId: string; recipientUserId: string; senderName: string; messageId: string }
): Promise<void> {
  const { error } = await admin.from("parent_notifications").insert({
    case_id: input.caseId,
    user_id: input.recipientUserId,
    type: "coparent_message",
    title: "New message",
    message: incomingNoticeCopy(input.senderName),
    priority: "normal",
  });
  if (error) console.error("[deliver-parent-message] notification:", error.message);

  const existing = await admin
    .from("sage_journal_messages")
    .select("id")
    .eq("user_id", input.recipientUserId)
    .eq("source_message_id", input.messageId)
    .limit(1);
  if (existing.error) {
    if (/source_message_id/i.test(existing.error.message ?? "")) return;
    console.error("[deliver-parent-message] sage lookup:", existing.error.message);
    return;
  }
  if ((existing.data ?? []).length > 0) return;

  const sessions = await admin
    .from("sage_sessions")
    .select("id")
    .eq("user_id", input.recipientUserId)
    .order("updated_at", { ascending: false })
    .limit(1);
  let sessionId = ((sessions.data ?? []) as { id?: string }[])[0]?.id ?? "";
  if (!sessionId) {
    const created = await admin
      .from("sage_sessions")
      .insert({
        user_id: input.recipientUserId,
        session_type: "private",
        title: "Messages",
        category: "general",
      })
      .select("id")
      .single();
    sessionId = (created.data as { id?: string } | null)?.id ?? "";
    if (!sessionId) {
      console.error("[deliver-parent-message] sage session:", created.error?.message ?? "missing session");
      return;
    }
  }
  const journal = await admin.from("sage_journal_messages").insert({
    user_id: input.recipientUserId,
    role: "sage",
    session_id: sessionId,
    source_message_id: input.messageId,
    content: incomingNoticeCopy(input.senderName),
  });
  if (journal.error && /source_message_id/i.test(journal.error.message ?? "")) {
    await admin.from("sage_journal_messages").insert({
      user_id: input.recipientUserId,
      role: "sage",
      session_id: sessionId,
      content: incomingNoticeCopy(input.senderName),
    });
  } else if (journal.error) {
    console.error("[deliver-parent-message] sage journal:", journal.error.message);
  } else {
    await admin.from("sage_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);
  }
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
    await notifyRecipient(admin, {
      caseId,
      recipientUserId: repair.recipientUserId,
      senderName: directory.senderName,
      messageId,
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
    attachmentDocumentId?: string | null;
  }
): Promise<
  | { ok: true; messageId: string; deliveryStatus: "sent" | "email_accepted" | "delivered"; recipientEmail: string }
  | { ok: false; status: number; message: string }
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
      return {
        ok: true,
        messageId: existing.id,
        deliveryStatus: existing.deliveryStatus,
        recipientEmail,
      };
    }
  }

  const directory = await parentDirectory(admin, input.caseId, input.senderId);
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
  await linkApprovedAttachment(admin, {
    messageId,
    caseId: input.caseId,
    senderId: input.senderId,
    recipientEmail,
    documentId: input.attachmentDocumentId ?? null,
    conversationId: conversation.id,
  });
  await notifyRecipient(admin, {
    caseId: input.caseId,
    recipientUserId: recipient.userId,
    senderName: directory.senderName,
    messageId,
  });
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

  return { ok: true, messageId, deliveryStatus, recipientEmail };
}

async function linkApprovedAttachment(
  admin: Admin,
  input: {
    messageId: string;
    caseId: string;
    senderId: string;
    recipientEmail: string;
    documentId: string | null;
    conversationId: string | null;
  }
): Promise<void> {
  const documentId = (input.documentId ?? "").trim();
  if (!documentId) return;
  const { data: doc } = await admin
    .from("documents")
    .select("id, case_id, uploaded_by, visibility, status, file_name, deleted_at")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || (doc as { deleted_at?: string | null }).deleted_at) return;
  const row = doc as {
    case_id?: string | null;
    uploaded_by?: string | null;
    visibility?: string | null;
    status?: string | null;
    file_name?: string | null;
  };
  const { data: members } = await admin
    .from("case_members")
    .select("user_id, role")
    .eq("case_id", input.caseId)
    .eq("role", "parent");
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  const memberIds = ((members ?? []) as { user_id?: string | null; role?: string | null }[])
    .map((member) => (member.user_id ?? "").trim())
    .filter((id) => id && id !== input.senderId);
  const users = memberIds.length
    ? (
        await admin.from("users").select("id, email").in("id", memberIds)
      ).data
    : [];
  const recipient = ((users ?? []) as { id?: string; email?: string | null }[]).find(
    (user) => (user.email ?? "").trim().toLowerCase() === recipientEmail
  );
  const member = ((members ?? []) as { user_id?: string | null; role?: string | null }[]).find(
    (item) => (item.user_id ?? "").trim() === (recipient?.id ?? "")
  );
  const decision = messageAttachmentDecision({
    documentCaseId: row.case_id ?? "",
    messageCaseId: input.caseId,
    uploadedBy: row.uploaded_by ?? "",
    senderId: input.senderId,
    visibility: row.visibility ?? null,
    status: row.status ?? null,
    fileName: row.file_name ?? "",
    recipientUserId: recipient?.id ?? null,
    recipientRole: member?.role ?? null,
    recipientOnCase: Boolean(recipient?.id),
  });
  if (!decision.link) return;
  const { error } = await admin.from("message_documents").insert({
    message_id: input.messageId,
    document_id: documentId,
  });
  if (error) {
    console.error("[deliver-parent-message] message_documents", error.message);
    return;
  }
  await admin.from("messages").update({ has_attachments: true }).eq("id", input.messageId);
  if (input.conversationId) {
    await admin.from("conversation_attachments").insert({
      conversation_id: input.conversationId,
      attachment_id: documentId,
      attachment_type: "document",
      created_by: input.senderId,
    });
  }
}
