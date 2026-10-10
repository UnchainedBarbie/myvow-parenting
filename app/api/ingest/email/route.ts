import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { ingestMessage } from "@/lib/messages/ingest-message";
import {
  processInboundMessageForSage,
  resolveVisibleTo,
} from "@/lib/sage/process-inbox-item";

export const runtime = "nodejs";
/** Sage runs after the response. */
export const maxDuration = 60;

const BUCKET = "inbox";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];


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
  created: boolean
): void {
  console.log(
    `[conv-match] step=${step} conversation_id=${conversationId ?? "none"} created=${created}`
  );
}

async function stampMatchedConversation(
  admin: ReturnType<typeof getServiceRoleClient>,
  row: ConversationStampRow,
  thread: ExtractedPostmarkThread,
  from: string | null
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
  if (!(row.coparent_email ?? "").trim() && from) {
    patch.coparent_email = from;
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
  from: string | null,
  subject: string
): Promise<string | null> {
  try {
    const admin = getServiceRoleClient();
    const candidates = threadIdCandidates(thread);

    if (candidates.length > 0) {
      const { data: byThread, error: threadErr } = await admin
        .from("conversations")
        .select("id, email_thread_id, coparent_email")
        .eq("case_id", caseId)
        .in("email_thread_id", candidates)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (threadErr) {
        console.error(`[conv-match] step=thread error=${threadErr.message}`);
        return null;
      }

      const threadRow = (byThread ?? [])[0] as ConversationStampRow | undefined;
      if (threadRow?.id) {
        await stampMatchedConversation(admin, threadRow, thread, from);
        logConvMatch("thread", threadRow.id, false);
        return threadRow.id;
      }

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
          .select("id, email_thread_id, coparent_email")
          .eq("id", messageConversationId)
          .eq("case_id", caseId)
          .maybeSingle();
        if (convErr) {
          console.error(`[conv-match] step=thread error=${convErr.message}`);
          return null;
        }
        if (conv?.id) {
          await stampMatchedConversation(
            admin,
            conv as ConversationStampRow,
            thread,
            from
          );
          logConvMatch("thread", conv.id as string, false);
          return conv.id as string;
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
        await stampMatchedConversation(admin, hit, thread, from);
        logConvMatch("subject", hit.id, false);
        return hit.id;
      }
    }

    const trimmedSubject = subject.trim();
    const createdSubject = trimmedSubject.length > 0 ? trimmedSubject : "(no subject)";
    const visibleTo = await resolveVisibleTo(caseId);
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
        coparent_email: from,
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

    const raw = body as unknown as Record<string, unknown>;
    const extracted = extractPostmarkThread(body);
    console.log("[postmark-raw] keys", Object.keys(raw));
    console.log("[postmark-raw] Headers", raw.Headers ?? null);
    console.log("[postmark-raw] extracted", {
      messageId: extracted.messageId,
      messageIdSource: extracted.messageIdSource,
      inReplyTo: extracted.inReplyTo,
      references: extracted.references,
      bodyTextSource:
        typeof body.StrippedTextReply === "string" &&
        body.StrippedTextReply.trim().length > 0
          ? "StrippedTextReply"
          : "TextBody",
      bodyTextLength: extracted.bodyText.length,
    });

    const toAddress = extractEmailFromAddress(body.To);
    const fromEmail = extractEmailFromAddress(body.From);
    const subject = (body.Subject ?? "").toString().slice(0, 512);

    if (!toAddress) {
      console.error("[ingest/email] Missing or invalid To address in webhook payload");
      return NextResponse.json({ ok: true });
    }

    const admin = getServiceRoleClient();
    const { data: caseRow, error: caseError } = await admin
      .from("cases")
      .select("id")
      .eq("ingest_email", toAddress)
      .limit(1)
      .maybeSingle();

    if (caseError) {
      console.error("[ingest/email] Error looking up case by ingest_email:", caseError);
      return NextResponse.json({ ok: true });
    }

    if (!caseRow?.id) {
      return NextResponse.json({ ok: true });
    }

    const caseId = caseRow.id as string;
    const conversationId = await resolveOrCreateConversation(
      caseId,
      extracted,
      fromEmail,
      subject
    );
    const attachments = Array.isArray(body.Attachments) ? body.Attachments : [];
    let createdMessageId: string | null = null;

    if (conversationId) {
      try {
        const ingested = await ingestMessage({
          case_id: caseId,
          original_content: extracted.bodyText,
          conversation_id: conversationId,
          sender_external_email: fromEmail,
          email_message_id: extracted.messageId,
          has_attachments: attachments.length > 0,
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
    } else {
      console.error("[msg-ingest] skipped: no conversation");
    }

    await ensureInboxBucket(admin);

    for (const att of attachments) {
      try {
        const filename = (att.Name ?? "attachment").toString().slice(0, 255);
        const contentType = (att.ContentType ?? "application/octet-stream").toString();

        if (!ALLOWED_ATTACHMENT_TYPES.includes(contentType)) {
          console.log(
            `[ingest-attach] skipped type=${contentType} file=${filename}`
          );
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

        const timestamp = Date.now();
        const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
        const storagePath = `${caseId}/email/${timestamp}-${safeName}`;

        const { error: uploadError } = await admin.storage
          .from(BUCKET)
          .upload(storagePath, buf, { contentType, upsert: false });
        if (uploadError) {
          console.error("[ingest-attach] upload failed:", uploadError);
          continue;
        }

        console.log(`[ingest-attach] path=${storagePath} file=${filename}`);
      } catch (e) {
        console.error("[ingest-attach] error:", e);
      }
    }

    if (createdMessageId) {
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

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[ingest/email] Unhandled error:", e);
    return NextResponse.json({ ok: true });
  }
}
