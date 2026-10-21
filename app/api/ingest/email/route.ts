import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { authorizeInboundIntake } from "@/lib/messages/authorize-inbound-intake";
import { ingestMessage } from "@/lib/messages/ingest-message";
import {
  findOrCreateSelfSession,
  runSelfEmailComposer,
} from "@/lib/messages/process-self-inbound";
import { recordEmailIntake } from "@/lib/messages/record-email-intake";
import { resolveInboundSender } from "@/lib/messages/resolve-inbound-sender";
import { resolveIntakeCase } from "@/lib/messages/resolve-intake-case";
import {
  processInboundMessageForSage,
  resolveVisibleTo,
} from "@/lib/sage/process-inbox-item";

export const runtime = "nodejs";
/** Sage runs after the response. */
export const maxDuration = 60;

const DOCUMENTS_BUCKET = "documents";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];


function mailboxList(value: string | null | undefined, ingestAddress: string | null): string | null {
  if (!value) return null;
  const ingest = ingestAddress?.trim().toLowerCase() ?? "";
  const found = value
    .split(",")
    .map((part) => extractEmailFromAddress(part))
    .filter((email): email is string => Boolean(email))
    .filter((email) => email !== ingest);
  const unique = [...new Set(found)];
  return unique.length > 0 ? unique.join(", ") : null;
}

function extractEmailFromAddress(value: string | undefined | null): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/<([^>]+)>/);
  const email = match ? match[1].trim() : trimmed;
  return email ? email.toLowerCase() : null;
}

type PostmarkAttachment = {
  Name?: string;
  Content?: string;
  ContentType?: string;
  ContentLength?: number;
};

type PostmarkHeader = {
  Name: string;
  Value: string;
};

type PostmarkPayload = {
  To?: string | null;
  Cc?: string | null;
  From?: string | null;
  Subject?: string | null;
  TextBody?: string | null;
  HtmlBody?: string | null;
  MessageID?: string | null;
  StrippedTextReply?: string | null;
  Headers?: PostmarkHeader[];
  Attachments?: PostmarkAttachment[];
};

type ExtractedPostmarkThread = {
  messageId: string | null;
  messageIdSource: "Message-ID" | "MessageID" | null;
  inReplyTo: string | null;
  references: string[];
  bodyText: string;
};

function headerValue(
  headers: PostmarkHeader[] | undefined,
  name: string
): string | null {
  if (!Array.isArray(headers)) return null;
  const want = name.toLowerCase();
  const found = headers.find(
    (h) => typeof h?.Name === "string" && h.Name.toLowerCase() === want
  );
  if (typeof found?.Value !== "string") return null;
  const trimmed = found.Value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractPostmarkThread(payload: PostmarkPayload): ExtractedPostmarkThread {
  const headerMessageId = headerValue(payload.Headers, "Message-ID");
  const topLevelMessageId =
    typeof payload.MessageID === "string" && payload.MessageID.trim()
      ? payload.MessageID.trim()
      : null;
  const messageId = headerMessageId ?? topLevelMessageId;
  const messageIdSource: ExtractedPostmarkThread["messageIdSource"] = headerMessageId
    ? "Message-ID"
    : topLevelMessageId
      ? "MessageID"
      : null;
  const inReplyTo = headerValue(payload.Headers, "In-Reply-To");
  const referencesRaw = headerValue(payload.Headers, "References");
  const references = referencesRaw ? referencesRaw.split(/\s+/).filter(Boolean) : [];
  const stripped =
    typeof payload.StrippedTextReply === "string"
      ? payload.StrippedTextReply.trim()
      : "";
  const textBody = typeof payload.TextBody === "string" ? payload.TextBody : "";
  const bodyText = stripped.length > 0 ? stripped : textBody;
  return { messageId, messageIdSource, inReplyTo, references, bodyText };
}

function titleFromFilename(filename: string): string {
  const base = filename.trim();
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot).trim() : base;
  return stem || base || "attachment";
}

const LEADING_REPLY_PREFIX = /^(?:re|fw|fwd)\s*:\s*/i;

/** Strip leading reply/forward prefixes, trim, and collapse whitespace. */
function normalizeConversationSubject(raw: string): string {
  let s = raw.trim().replace(/\s+/g, " ");
  let prev = "";
  while (s.length > 0 && s !== prev) {
    prev = s;
    s = s.replace(LEADING_REPLY_PREFIX, "").trim().replace(/\s+/g, " ");
  }
  return s.toLowerCase();
}

function threadIdCandidates(thread: ExtractedPostmarkThread): string[] {
  const ids: string[] = [];
  if (thread.inReplyTo) ids.push(thread.inReplyTo);
  for (const id of thread.references) {
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

type ConversationStampRow = {
  id: string;
  email_thread_id: string | null;
  coparent_email: string | null;
};

function logConvMatch(
  step: "thread" | "subject" | "create",
  conversationId: string | null,
  created: boolean,
  threadSubject?: "accepted" | "rejected"
): void {
  const decision = threadSubject ? ` thread_subject=${threadSubject}` : "";
  console.log(
    `[conv-match] step=${step} conversation_id=${conversationId ?? "none"} created=${created}${decision}`
  );
}

function subjectsMatch(inboundSubject: string, conversationSubject: string | null): boolean {
  return (
    normalizeConversationSubject(inboundSubject) ===
    normalizeConversationSubject(conversationSubject ?? "")
  );
}

/**
 * Reply address for the co-parent relative to the account owner.
 * The is_reply row on a case member whose user_id is not the resolved recipient.
 * Null when that address is missing or more than one member qualifies.
 */
async function coparentReplyEmail(
  admin: ReturnType<typeof getServiceRoleClient>,
  caseId: string,
  recipientUserId: string | null
): Promise<string | null> {
  if (!recipientUserId) return null;

  const { data: members, error: memberErr } = await admin
    .from("case_members")
    .select("id, user_id")
    .eq("case_id", caseId);
  if (memberErr) {
    console.error(`[conv-match] coparent_email lookup failed: ${memberErr.message}`);
    return null;
  }

  const coparentMemberIds = ((members ?? []) as { id?: string; user_id?: string | null }[])
    .filter((member) => member.id && member.user_id !== recipientUserId)
    .map((member) => member.id as string);
  if (coparentMemberIds.length === 0) return null;

  const { data, error } = await admin
    .from("case_member_emails")
    .select("email")
    .eq("case_id", caseId)
    .eq("is_reply", true)
    .in("case_member_id", coparentMemberIds);
  if (error) {
    console.error(`[conv-match] coparent_email lookup failed: ${error.message}`);
    return null;
  }

  const emails = ((data ?? []) as { email?: string | null }[])
    .map((row) => (row.email ?? "").trim())
    .filter((email) => email.length > 0);
  return emails.length === 1 ? emails[0] : null;
}

async function stampMatchedConversation(
  admin: ReturnType<typeof getServiceRoleClient>,
  row: ConversationStampRow,
  thread: ExtractedPostmarkThread,
  coparentEmail: string | null
): Promise<void> {
  const patch: {
    updated_at: string;
    email_thread_id?: string;
    coparent_email?: string;
  } = {
    updated_at: new Date().toISOString(),
  };
  if (!(row.email_thread_id ?? "").trim() && thread.messageId) {
    patch.email_thread_id = thread.messageId;
  }
  if (!(row.coparent_email ?? "").trim() && coparentEmail) {
    patch.coparent_email = coparentEmail;
  }
  const { error } = await admin.from("conversations").update(patch).eq("id", row.id);
  if (error) {
    console.error(
      `[conv-match] conversation_id=${row.id} stamp_failed=${error.message}`
    );
  }
}

/**
 * Resolve the conversation for an inbound email, or create one.
 * Does not write a messages row.
 */
async function resolveOrCreateConversation(
  caseId: string,
  thread: ExtractedPostmarkThread,
  subject: string
): Promise<string | null> {
  try {
    const admin = getServiceRoleClient();
    const visibleTo = await resolveVisibleTo(caseId);
    const recipientUserId = typeof visibleTo === "string" ? visibleTo : null;
    const coparentEmail = await coparentReplyEmail(admin, caseId, recipientUserId);
    const candidates = threadIdCandidates(thread);
    let threadSubjectRejected = false;

    if (candidates.length > 0) {
      const { data: byThread, error: threadErr } = await admin
        .from("conversations")
        .select("id, subject, email_thread_id, coparent_email")
        .eq("case_id", caseId)
        .in("email_thread_id", candidates)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (threadErr) {
        console.error(`[conv-match] step=thread error=${threadErr.message}`);
        return null;
      }

      const threadRow = (byThread ?? [])[0] as
        | (ConversationStampRow & { subject?: string | null })
        | undefined;
      if (threadRow?.id) {
        if (subjectsMatch(subject, threadRow.subject ?? null)) {
          await stampMatchedConversation(admin, threadRow, thread, coparentEmail);
          logConvMatch("thread", threadRow.id, false, "accepted");
          return threadRow.id;
        }
        logConvMatch("thread", threadRow.id, false, "rejected");
        threadSubjectRejected = true;
      }

      if (!threadSubjectRejected) {
        const { data: byMessage, error: msgErr } = await admin
          .from("messages")
          .select("conversation_id")
          .eq("case_id", caseId)
          .in("email_message_id", candidates)
          .not("conversation_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1);

        if (msgErr) {
          console.error(`[conv-match] step=thread error=${msgErr.message}`);
          return null;
        }

        const messageConversationId = (
          (byMessage ?? [])[0] as { conversation_id?: string | null } | undefined
        )?.conversation_id;

        if (messageConversationId) {
          const { data: conv, error: convErr } = await admin
            .from("conversations")
            .select("id, subject, email_thread_id, coparent_email")
            .eq("id", messageConversationId)
            .eq("case_id", caseId)
            .maybeSingle();
          if (convErr) {
            console.error(`[conv-match] step=thread error=${convErr.message}`);
            return null;
          }
          if (conv?.id) {
            const matched = conv as ConversationStampRow & { subject?: string | null };
            if (subjectsMatch(subject, matched.subject ?? null)) {
              await stampMatchedConversation(admin, matched, thread, coparentEmail);
              logConvMatch("thread", matched.id, false, "accepted");
              return matched.id;
            }
            logConvMatch("thread", matched.id, false, "rejected");
          }
        }
      }
    }

    const normalized = normalizeConversationSubject(subject);
    if (normalized) {
      const { data: convs, error: subjErr } = await admin
        .from("conversations")
        .select("id, subject, email_thread_id, coparent_email, updated_at")
        .eq("case_id", caseId)
        .order("updated_at", { ascending: false });
      if (subjErr) {
        console.error(`[conv-match] step=subject error=${subjErr.message}`);
        return null;
      }
      const hit = (
        (convs ?? []) as {
          id: string;
          subject: string | null;
          email_thread_id: string | null;
          coparent_email: string | null;
        }[]
      ).find((c) => normalizeConversationSubject(c.subject ?? "") === normalized);
      if (hit) {
        await stampMatchedConversation(admin, hit, thread, coparentEmail);
        logConvMatch("subject", hit.id, false);
        return hit.id;
      }
    }

    const trimmedSubject = subject.trim();
    const createdSubject = trimmedSubject.length > 0 ? trimmedSubject : "(no subject)";
    if (typeof visibleTo !== "string") {
      console.error(
        `[conv-match] step=create conversation_id=none created=false error=${visibleTo.error}`
      );
      return null;
    }

    const { data: created, error: createErr } = await admin
      .from("conversations")
      .insert({
        case_id: caseId,
        subject: createdSubject,
        topic: "General",
        category: "General",
        created_by: visibleTo,
        coparent_email: coparentEmail,
        email_thread_id: thread.messageId,
        child_id: null,
      })
      .select("id")
      .single();

    if (createErr || !created) {
      console.error(
        `[conv-match] step=create conversation_id=none created=false error=${createErr?.message ?? "insert failed"}`
      );
      return null;
    }
    const createdId = (created as { id: string }).id;
    logConvMatch("create", createdId, true);
    return createdId;
  } catch (e) {
    const message = e instanceof Error ? e.message : "resolveOrCreateConversation failed";
    console.error(`[conv-match] error=${message}`);
    return null;
  }
}

async function storePendingDocuments(opts: {
  admin: ReturnType<typeof getServiceRoleClient>;
  caseId: string;
  uploadedBy: string;
  emailIntakeId: string;
  subject: string;
  attachments: PostmarkAttachment[];
}): Promise<{ id: string; storagePath: string; filename: string }[]> {
  const { admin, caseId, uploadedBy, emailIntakeId, subject, attachments } = opts;
  const created: { id: string; storagePath: string; filename: string }[] = [];
  const usedPaths = new Set<string>();
  const description = subject.trim() || "";
  for (const att of attachments) {
    const filename = (att.Name ?? "attachment").toString().slice(0, 255);
    const contentType = (att.ContentType ?? "application/octet-stream").toString();

    if (!ALLOWED_ATTACHMENT_TYPES.includes(contentType)) {
      console.log(`[ingest-attach] skipped type=${contentType} file=${filename}`);
      continue;
    }
    if (!att.Content || typeof att.Content !== "string") {
      console.error(`[ingest-attach] no content file=${filename}`);
      continue;
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(att.Content, "base64");
    } catch (e) {
      console.error("[ingest-attach] failed to decode base64:", e);
      continue;
    }
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      console.error(`[ingest-attach] too large file=${filename}`);
      continue;
    }

    try {
      const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
      let timestamp = Date.now();
      let storagePath = `${caseId}/${uploadedBy}/${timestamp}-${safeName}`;
      while (usedPaths.has(storagePath)) {
        timestamp += 1;
        storagePath = `${caseId}/${uploadedBy}/${timestamp}-${safeName}`;
      }
      usedPaths.add(storagePath);

      const { error: uploadError } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, buf, { contentType, upsert: false });
      if (uploadError) {
        console.error(`[ingest-attach] upload failed file=${filename}`, uploadError);
        continue;
      }

      const { data: doc, error: docErr } = await admin
        .from("documents")
        .insert({
          case_id: caseId,
          uploaded_by: uploadedBy,
          title: titleFromFilename(filename),
          file_name: filename,
          file_size_bytes: buf.length,
          mime_type: contentType,
          storage_path: storagePath,
          category: "other",
          description: description || filename,
          content_hash: "pending",
          visibility: "parents_only",
          ai_processed: false,
          email_intake_id: emailIntakeId,
          status: "pending",
        })
        .select("id")
        .single();
      if (docErr || !doc) {
        console.error(
          `[ingest-attach] documents insert failed file=${filename}`,
          docErr?.message ?? "insert failed"
        );
        continue;
      }
      created.push({
        id: (doc as { id: string }).id,
        storagePath,
        filename,
      });
    } catch (e) {
      console.error("[ingest-attach] error:", e);
    }
  }
  return created;
}

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.POSTMARK_WEBHOOK_SECRET;
    const authHeader = req.headers.get("authorization") ?? "";
    const webhookSecretHeader = req.headers.get("x-webhook-secret") ?? "";

    if (secret) {
      const expectedBearer = `Bearer ${secret}`;
      const valid =
        authHeader === secret ||
        authHeader === expectedBearer ||
        webhookSecretHeader === secret;
      if (!valid) {
        console.error("[ingest/email] Invalid Postmark webhook signature/secret");
        return NextResponse.json({ ok: true });
      }
    }

    const body = (await req.json().catch(() => null)) as PostmarkPayload | null;

    if (!body) {
      console.error("[ingest/email] Failed to parse JSON body");
      return NextResponse.json({ ok: true });
    }

    const extracted = extractPostmarkThread(body);

    const toAddress = extractEmailFromAddress(body.To);
    const fromEmail = extractEmailFromAddress(body.From);
    const subject = (body.Subject ?? "").toString().slice(0, 512);

    if (!toAddress) {
      console.error("[ingest/email] Missing or invalid To address in webhook payload");
      return NextResponse.json({ ok: true });
    }

    const admin = getServiceRoleClient();
    const intakeCase = await resolveIntakeCase(toAddress);
    if (intakeCase && "error" in intakeCase) {
      console.error("[ingest/email] Error looking up case by ingest_email:", intakeCase.error);
      return NextResponse.json({ ok: true });
    }
    if (!intakeCase) {
      return NextResponse.json({ ok: true });
    }
    const caseId = intakeCase.caseId;

    let sender;
    try {
      sender = await resolveInboundSender(caseId, body.From);
      console.log(
        `[sender-id] from=${sender.fromEmail ?? "null"} matched=${sender.isKnownCaseMember} case_member_id=${sender.caseMemberId ?? "null"} user_id=${sender.userId ?? "null"}`
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "lookup failed";
      console.error(`[sender-id] lookup failed: ${message}`);
      return NextResponse.json({ ok: true });
    }

    const visibleTo = await resolveVisibleTo(caseId);
    if (typeof visibleTo !== "string") {
      console.error(`[sender-id] unresolved recipient error=${visibleTo.error}`);
      return NextResponse.json({ ok: true });
    }

    const decision = authorizeInboundIntake(sender, visibleTo);
    if (!decision.authorized) {
      console.log(`[sender-id] dropped from=${sender.fromEmail ?? "null"}`);
      return NextResponse.json({ ok: true });
    }

    const recorded = await recordEmailIntake(admin, {
      caseId,
      caseMemberId: decision.caseMemberId,
      fromEmail: decision.fromEmail,
      subject,
      messageId: extracted.messageId,
      inReplyTo: extracted.inReplyTo,
      referencesHeader: extracted.references.length > 0 ? extracted.references.join(" ") : null,
      branch: decision.branch,
      submittedByUserId: decision.branch === "self" ? visibleTo : decision.userId,
    });
    if ("error" in recorded) {
      console.error(`[sender-id] intake failed: ${recorded.error}`);
      return NextResponse.json({ ok: true });
    }
    if ("duplicate" in recorded) {
      console.log(`[sender-id] duplicate message_id=${extracted.messageId ?? "null"}`);
      return NextResponse.json({ ok: true });
    }

    const attachments = Array.isArray(body.Attachments) ? body.Attachments : [];

    if (decision.branch === "self") {
      const sessionId = await findOrCreateSelfSession(admin, {
        caseId,
        userId: visibleTo,
        subject,
        thread: extracted,
      });
      if (!sessionId) {
        return NextResponse.json({ ok: true });
      }
      const { error: linkSessionErr } = await admin
        .from("email_intake")
        .update({ sage_session_id: sessionId })
        .eq("id", recorded.id);
      if (linkSessionErr) {
        console.error(`[sender-id] intake session link failed: ${linkSessionErr.message}`);
      }
      const createdDocuments = await storePendingDocuments({
        admin,
        caseId,
        uploadedBy: visibleTo,
        emailIntakeId: recorded.id,
        subject,
        attachments,
      });
      await runSelfEmailComposer({
        admin,
        caseId,
        userId: visibleTo,
        intakeId: recorded.id,
        sessionId,
        bodyText: extracted.bodyText,
        documents: createdDocuments.map((doc) => ({ id: doc.id, filename: doc.filename })),
      });
      return NextResponse.json({ ok: true });
    }

    const conversationId = await resolveOrCreateConversation(
      caseId,
      extracted,
      subject
    );
    const createdDocuments: {
      id: string;
      storagePath: string;
      filename: string;
    }[] = [];
    let createdMessageId: string | null = null;

    if (!conversationId) {
      console.error("[msg-ingest] skipped: no conversation");
      if (attachments.length > 0) {
        console.log("[ingest-attach] skipped no conversation");
      }
    } else {
      let recipientUserId: string | null = null;
      if (attachments.length > 0) {
        const attachmentRecipient = await resolveVisibleTo(caseId);
        if (typeof attachmentRecipient !== "string") {
          console.error(
            `[ingest-attach] skipped no recipient error=${attachmentRecipient.error}`
          );
        } else {
          recipientUserId = attachmentRecipient;
        }
      }

      if (recipientUserId) {
        createdDocuments.push(
          ...(await storePendingDocuments({
            admin,
            caseId,
            uploadedBy: recipientUserId,
            emailIntakeId: recorded.id,
            subject,
            attachments,
          }))
        );
      }

      try {
        const headerTo = headerValue(body.Headers, "To") ?? body.To;
        const headerCc = headerValue(body.Headers, "Cc") ?? body.Cc;
        const ingested = await ingestMessage({
          case_id: caseId,
          original_content: extracted.bodyText,
          conversation_id: conversationId,
          sender_id: decision.userId,
          sender_external_email: fromEmail,
          recipient_email: mailboxList(headerTo, toAddress),
          recipient_cc: mailboxList(headerCc, toAddress),
          email_message_id: extracted.messageId,
          has_attachments: createdDocuments.length > 0,
        });
        console.log(
          `[msg-ingest] message_id=${ingested.message_id} created=${ingested.created} delivery_status=${ingested.delivery_status}`
        );
        if (ingested.created) createdMessageId = ingested.message_id;
      } catch (err) {
        console.error(
          "[msg-ingest]",
          err instanceof Error ? err.message : err
        );
      }

      if (createdDocuments.length > 0 && !createdMessageId) {
        console.error(
          `[ingest-attach] orphaned document_ids=${createdDocuments
            .map((doc) => doc.id)
            .join(",")}`
        );
      }

      if (createdMessageId) {
        for (const doc of createdDocuments) {
          const { error: linkErr } = await admin.from("message_documents").insert({
            message_id: createdMessageId,
            document_id: doc.id,
          });
          if (linkErr) {
            console.error(
              `[ingest-attach] message_documents insert failed document_id=${doc.id}`,
              linkErr.message
            );
            continue;
          }
          console.log(
            `[ingest-attach] document_id=${doc.id} path=${doc.storagePath} file=${doc.filename}`
          );
        }

        waitUntil(
          (async () => {
            try {
              await processInboundMessageForSage(createdMessageId);
            } catch (e) {
              console.error("[msg-sage]", e);
            }
          })()
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[ingest/email] Unhandled error:", e);
    return NextResponse.json({ ok: true });
  }
}
