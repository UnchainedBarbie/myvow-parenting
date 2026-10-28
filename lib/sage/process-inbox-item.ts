/**
 * Email adapter — runs Observation Builder + shared processObservation on a stored
 * inbox_items row and writes a sage_items row.
 *
 * Ingest schedules this after the webhook response via waitUntil(); it is safe to
 * call twice on the same inbox item (existing sage_items for the source win).
 */

import { extractPdfText } from "@/lib/pdf-extract";
import {
  sageReadsAttachment,
  type AttachmentNotice,
} from "@/lib/messages/inbound-attachment";
import { correctIntakeProposals, correctIntakeText } from "@/lib/sage/intake-facts";
import { getServiceRoleClient } from "@/lib/supabase/server";
import {
  buildObservation,
  type RawItem,
} from "@/lib/sage/observation-builder";
import { processObservation } from "@/lib/sage/process-observation";
import { loadIncomingContext } from "@/lib/sage/incoming-context";
import { parentDirectory } from "@/lib/messages/case-parents";
import { resolveReceivingParent } from "@/lib/messages/receiving-parent";
import {
  inboundNarration,
  readIncomingCommunication,
  readingNeedsAttention,
} from "@/lib/sage/communication-reading";
import type { Plan } from "@/lib/sage/planner";
import type { SupabaseClient } from "@supabase/supabase-js";

const INBOX_BUCKET = "inbox";
const DOCUMENTS_BUCKET = "documents";
const PDF_TYPE = "application/pdf";

export type InboxItemRow = {
  id: string;
  case_id: string;
  source_type: string | null;
  source_email_from: string | null;
  source_email_body: string | null;
  source_email_subject: string | null;
  coparent_email: string | null;
  created_at: string | null;
  raw_content: unknown;
  ai_description: string | null;
  file_name: string | null;
  file_path: string | null;
  mime_type: string | null;
  sage_item_id?: string | null;
};

export type InboxExtractResult = {
  text: string;
  attachments: { filename: string; text?: string }[];
};

const QUOTED_REPLY_HEADER = /^On .+\s+wrote:\s*$/i;

function isTrivialText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const letters = t.replace(/[^a-zA-Z]/g, "");
  return letters.length < 3;
}

/** Remove quoted-reply headers, ">" lines, and trailing signature/quote blocks. */
export function stripEmailQuoteCruft(raw: string): string {
  if (!raw.trim()) return "";

  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  let sawContent = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (sawContent) {
      if (/^--\s*$/.test(trimmed)) break;
      if (/^_{3,}$/.test(trimmed)) break;
      if (/^Sent from my (iPhone|iPad|Android)/i.test(trimmed)) break;
      if (/^-+\s*Original Message\s*-+$/i.test(trimmed)) break;
      if (/^Begin forwarded message:?$/i.test(trimmed)) break;
    }

    if (QUOTED_REPLY_HEADER.test(trimmed)) break;

    if (trimmed.startsWith(">")) continue;

    if (trimmed) sawContent = true;
    kept.push(line);
  }

  return kept.join("\n").trim();
}

function readRawBody(row: InboxItemRow): string {
  const fromColumn = (row.source_email_body ?? "").trim();
  if (fromColumn) return fromColumn;

  const raw = row.raw_content;
  if (raw && typeof raw === "object" && raw !== null) {
    const text = (raw as { text?: string }).text;
    if (typeof text === "string" && text.trim()) return text.trim();
  }

  return "";
}

function readStoredAttachmentText(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  for (const key of ["extracted_text", "attachment_text", "pdf_text"]) {
    const val = record[key];
    if (typeof val === "string" && val.trim().length > 50) return val.trim();
  }
  return null;
}

async function resolveAttachmentText(
  row: InboxItemRow,
  admin: SupabaseClient
): Promise<{ filename: string; text: string } | null> {
  const filename = (row.file_name ?? "").trim();
  if (!filename) return null;

  const fromRaw = readStoredAttachmentText(row.raw_content);
  if (fromRaw) return { filename, text: fromRaw };

  const filePath = (row.file_path ?? "").trim();
  const mime = (row.mime_type ?? "").trim().toLowerCase();
  const isPdf =
    mime === PDF_TYPE || filename.toLowerCase().endsWith(".pdf");

  if (filePath && isPdf) {
    try {
      const { data, error } = await admin.storage.from(INBOX_BUCKET).download(filePath);
      if (!error && data) {
        const buf = Buffer.from(await data.arrayBuffer());
        const extracted = await extractPdfText(buf);
        if (extracted.trim().length > 0) {
          return { filename, text: extracted.trim() };
        }
      }
    } catch (e) {
      console.error("[process-inbox-item] attachment PDF re-extract failed:", e);
    }
  }

  const description = (row.ai_description ?? "").trim();
  if (description) return { filename, text: description };

  return null;
}

function formatAttachmentBlock(attachment: { filename: string; text: string }): string {
  return `[Attachment: ${attachment.filename}]\n${attachment.text}`;
}

/**
 * Build combined message text and attachment metadata for Understanding.
 * Strips email quote cruft from the body; re-extracts PDF text from storage when needed.
 */
export async function extractInboxText(
  row: InboxItemRow,
  admin: SupabaseClient
): Promise<InboxExtractResult> {
  const strippedBody = stripEmailQuoteCruft(readRawBody(row));
  const usableBody = isTrivialText(strippedBody) ? "" : strippedBody;

  const attachment = await resolveAttachmentText(row, admin);
  const attachments: { filename: string; text?: string }[] = attachment
    ? [{ filename: attachment.filename, text: attachment.text }]
    : [];

  const parts: string[] = [];
  if (usableBody) parts.push(usableBody);
  if (attachment?.text) parts.push(formatAttachmentBlock(attachment));

  if (parts.length > 0) {
    return { text: parts.join("\n\n"), attachments };
  }

  const subject = (row.source_email_subject ?? "").trim();
  const description = (row.ai_description ?? "").trim();
  if (subject && description) {
    return { text: `Subject: ${subject}\n\n${description}`, attachments };
  }
  if (subject) return { text: subject, attachments };
  if (description) return { text: description, attachments };

  return { text: "", attachments };
}

export async function resolveVisibleTo(
  caseId: string
): Promise<string | { error: string }> {
  const admin = getServiceRoleClient();
  const { data: members, error } = await admin
    .from("case_members")
    .select("user_id, is_primary")
    .eq("case_id", caseId)
    .not("user_id", "is", null);

  if (error) {
    return { error: `Failed to load case members: ${error.message}` };
  }

  const rows = (members ?? []) as { user_id: string; is_primary: boolean | null }[];
  if (rows.length === 0) {
    return { error: "No case member with a user account found for this case" };
  }

  const primaryMembers = rows.filter((m) => m.is_primary === true);
  if (primaryMembers.length === 1) {
    return primaryMembers[0].user_id;
  }
  if (primaryMembers.length > 1) {
    return {
      error: "Multiple primary case members; cannot determine visible_to unambiguously",
    };
  }

  if (rows.length === 1) {
    return rows[0].user_id;
  }

  return {
    error: "No primary case member; multiple members — cannot determine visible_to unambiguously",
  };
}

async function findSageItemForSource(
  admin: SupabaseClient,
  sourceType: string,
  sourceId: string
): Promise<string | null> {
  const { data } = await admin
    .from("sage_items")
    .select("id")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  return /sage_items_source_idx|duplicate key/i.test(error.message ?? "");
}

export async function processInboxItem(
  inboxItemId: string
): Promise<{ sage_item_id: string } | { error: string }> {
  try {
    const admin = getServiceRoleClient();

    const { data: row, error: fetchError } = await admin
      .from("inbox_items")
      .select(
        "id, case_id, source_type, source_email_from, source_email_body, source_email_subject, coparent_email, created_at, raw_content, ai_description, file_name, file_path, mime_type"
      )
      .eq("id", inboxItemId)
      .maybeSingle();

    if (fetchError) {
      console.error("[process-inbox-item] fetch failed:", fetchError);
      return { error: fetchError.message };
    }
    if (!row) {
      return { error: `inbox_items row not found: ${inboxItemId}` };
    }

    const inboxRow = row as InboxItemRow;
    const sourceType = (inboxRow.source_type ?? "email").trim() || "email";

    const existingId = await findSageItemForSource(admin, sourceType, inboxItemId);
    if (existingId) return { sage_item_id: existingId };

    const extracted = await extractInboxText(inboxRow, admin);
    if (!extracted.text) {
      return {
        error:
          "inbox_items row has no usable email body, attachment text, or subject/description",
      };
    }

    const sender =
      (inboxRow.source_email_from ?? inboxRow.coparent_email ?? "Co-Parent").trim() ||
      "Co-Parent";

    const rawItem: RawItem = {
      id: inboxRow.id,
      reply_to_id: null,
      from: sender,
      timestamp: inboxRow.created_at ?? new Date().toISOString(),
      text: extracted.text,
      source: sourceType,
      attachments: extracted.attachments.length > 0 ? extracted.attachments : undefined,
    };

    const observation = buildObservation(inboxRow.id, [rawItem]);

    const visibleTo = await resolveVisibleTo(inboxRow.case_id);
    if (typeof visibleTo !== "string") {
      return visibleTo;
    }

    const processed = await processObservation(observation, {
      case_id: inboxRow.case_id,
      timezone: "America/Denver",
      source_type: "email",
      source_id: inboxItemId,
      sender,
      plan_sender: "Co-Parent",
    });

    const { intent, entities } = processed.interpretation;
    const { child_ids, resolved_dates, plan: itemPlan } = processed;

    const { data: sageRow, error: insertError } = await admin
      .from("sage_items")
      .insert({
        case_id: inboxRow.case_id,
        source_type: sourceType,
        source_id: inboxItemId,
        visible_to: visibleTo,
        item_type: intent.item_type,
        domain: intent.domain,
        summary: intent.summary,
        evidence_excerpt: intent.evidence_excerpt,
        tool_name: intent.tool_name,
        action_required: intent.action_required,
        action_type: intent.action_type,
        urgency: intent.urgency,
        confidence: intent.confidence,
        tool_input: {
          ...entities,
          resolved_dates,
          ...(processed.expense_category
            ? { expense_category: processed.expense_category }
            : {}),
        },
        child_ids,
        plan: itemPlan,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !sageRow) {
      if (isUniqueViolation(insertError)) {
        const racedId = await findSageItemForSource(admin, sourceType, inboxItemId);
        if (racedId) return { sage_item_id: racedId };
      }
      console.error("[process-inbox-item] sage_items insert failed:", insertError);
      return { error: insertError?.message ?? "Failed to insert sage_items row" };
    }

    return { sage_item_id: (sageRow as { id: string }).id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "processInboxItem failed";
    console.error("[process-inbox-item]", e);
    return { error: message };
  }
}

/** Ingest waitUntil() path: mark processing state, run Sage, persist sage_item_id. */
export async function processInboxItemForIngest(inboxItemId: string): Promise<void> {
  const admin = getServiceRoleClient();
  try {
    const { data: current } = await admin
      .from("inbox_items")
      .select("id, status, sage_item_id")
      .eq("id", inboxItemId)
      .maybeSingle();
    const row = current as
      | { id: string; status?: string | null; sage_item_id?: string | null }
      | null;
    if (row?.status === "saged" && row.sage_item_id) {
      console.log(
        `[ingest-sage] inbox_item_id=${inboxItemId} sage_item_id=${row.sage_item_id} already saged`
      );
      return;
    }

    await admin.from("inbox_items").update({ status: "processing" }).eq("id", inboxItemId);

    const result = await processInboxItem(inboxItemId);
    if ("sage_item_id" in result) {
      const { error: sagedErr } = await admin
        .from("inbox_items")
        .update({ status: "saged", sage_item_id: result.sage_item_id })
        .eq("id", inboxItemId);
      if (sagedErr) {
        await admin.from("inbox_items").update({ status: "saged" }).eq("id", inboxItemId);
        console.error(
          `[ingest-sage] inbox_item_id=${inboxItemId} sage_item_id=${result.sage_item_id} link failed: ${sagedErr.message}`
        );
      } else {
        console.log(
          `[ingest-sage] inbox_item_id=${inboxItemId} sage_item_id=${result.sage_item_id}`
        );
      }
      return;
    }

    await admin.from("inbox_items").update({ status: "sage_failed" }).eq("id", inboxItemId);
    console.error(`[ingest-sage] inbox_item_id=${inboxItemId} error=${result.error}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "processInboxItemForIngest failed";
    console.error(`[ingest-sage] inbox_item_id=${inboxItemId} error=${message}`);
    await admin.from("inbox_items").update({ status: "sage_failed" }).eq("id", inboxItemId);
  }
}

function needsAttention(plan: Plan): boolean {
  if (plan.status === "no_action") return false;
  return plan.proposals.some((p) => p.type !== "note_only");
}

function asSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Inbound summaries say "your co-parent"; Sage's narration uses the Co-Parent label. */
function coparentLabel(text: string): string {
  return text
    .replace(/\byour\s+co-parent\b/gi, "Co-Parent")
    .replace(/\bco-parent\b/gi, "Co-Parent");
}

/**
 * Sage speaking to the parent. Never the outbound draft: reply_coparent and the
 * clarification this path asks Co-Parent are the parent's message to send.
 */
function hasOutboundDraft(plan: Plan): boolean {
  return plan.proposals.some((p) => {
    const status = ((p as { status?: string }).status ?? "").toLowerCase();
    if (status === "dismissed" || status === "superseded") return false;
    return p.type === "reply_coparent" || p.type === "ask_clarification";
  });
}

function narrationFor(plan: Plan, summary: string): string {
  const about = asSentence(coparentLabel(summary));
  const topic = about || "Co-Parent sent a message.";
  if (hasOutboundDraft(plan)) {
    return `${topic} A reply is ready for you to review.`;
  }
  return about || "Co-Parent sent something that needs a look.";
}

function logMsgSage(messageId: string, detail: string): void {
  console.log(`[msg-sage] message_id=${messageId} ${detail}`);
}

async function findActiveConversationSession(
  admin: SupabaseClient,
  userId: string,
  conversationId: string
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await admin
    .from("sage_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .or("archived.is.null,archived.eq.false")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return { id: null, error: error.message };
  const id = ((data ?? [])[0] as { id?: string } | undefined)?.id ?? null;
  return { id };
}

/**
 * The receiving parent's private Sage session for one conversation. Created once per parent and
 * conversation. Each parent has their own session, so one parent's Sage never reads the other's.
 */
export async function ensureConversationSession(
  admin: SupabaseClient,
  input: { userId: string; conversationId: string; title: string }
): Promise<{ id: string | null; error?: string }> {
  const active = await findActiveConversationSession(admin, input.userId, input.conversationId);
  if (active.error) return { id: null, error: `session_lookup_failed error=${active.error}` };
  if (active.id) return { id: active.id };

  const { data: created, error } = await admin
    .from("sage_sessions")
    .insert({
      user_id: input.userId,
      session_type: "private",
      conversation_id: input.conversationId,
      title: input.title,
      category: "general",
    })
    .select("id")
    .single();
  if (!error && created) return { id: (created as { id: string }).id };
  if (isUniqueViolation(error)) {
    const raced = await findActiveConversationSession(admin, input.userId, input.conversationId);
    if (raced.error || !raced.id) {
      return { id: null, error: `session_race error=${raced.error ?? "active session not found"}` };
    }
    return { id: raced.id };
  }
  return { id: null, error: `session_create_failed error=${error?.message ?? "insert failed"}` };
}

async function loadMessagePdfAttachments(
  admin: SupabaseClient,
  messageId: string
): Promise<{
  extracted: { filename: string; text: string }[];
  unreadable: string[];
}> {
  const { data: links, error: linkErr } = await admin
    .from("message_documents")
    .select("document_id")
    .eq("message_id", messageId);
  if (linkErr) {
    console.error("[msg-sage] message_documents load failed:", linkErr.message);
    return { extracted: [], unreadable: [] };
  }

  const ids = (links ?? [])
    .map((row) => (row as { document_id?: string }).document_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.length === 0) {
    console.log(`[msg-sage] message_documents empty message_id=${messageId}`);
    return { extracted: [], unreadable: [] };
  }

  const { data: docs, error: docErr } = await admin
    .from("documents")
    .select("id, file_name, storage_path, mime_type")
    .in("id", ids);
  if (docErr) {
    console.error("[msg-sage] documents load failed:", docErr.message);
    return { extracted: [], unreadable: [] };
  }

  const docRows = docs ?? [];
  if (docRows.length === 0) {
    console.log(`[msg-sage] documents empty ids=${ids.join(",")}`);
    return { extracted: [], unreadable: [] };
  }

  const extracted: { filename: string; text: string }[] = [];
  const unreadable: string[] = [];
  for (const row of docRows) {
    const doc = row as {
      id?: string | null;
      file_name?: string | null;
      storage_path?: string | null;
      mime_type?: string | null;
    };
    const documentId = (doc.id ?? "").trim() || "none";
    const filename = (doc.file_name ?? "").trim();
    const filePath = (doc.storage_path ?? "").trim();
    const mime = (doc.mime_type ?? "").trim().toLowerCase();
    const readable = sageReadsAttachment(filename, mime);
    if (!filename || !filePath) {
      console.log(
        `[msg-sage] attachment skipped document_id=${documentId} reason=${!filename ? "missing_filename" : "missing_storage_path"}`
      );
      continue;
    }
    if (!readable) {
      unreadable.push(filename);
      console.log(
        `[msg-sage] attachment stored unread document_id=${documentId} file=${filename}`
      );
      continue;
    }

    try {
      const { data, error } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .download(filePath);
      if (error || !data) {
        console.error(
          "[msg-sage] attachment PDF download failed:",
          error?.message ?? filename
        );
        unreadable.push(filename);
        continue;
      }
      const buf = Buffer.from(await data.arrayBuffer());
      const extractedText = (await extractPdfText(buf)).trim();
      if (extractedText.length > 0) {
        extracted.push({ filename, text: extractedText });
        console.log(
          `[msg-sage] attachment extracted document_id=${documentId} file=${filename} chars=${extractedText.length}`
        );
      } else {
        unreadable.push(filename);
        console.log(
          `[msg-sage] attachment empty text document_id=${documentId} file=${filename} bytes=${buf.length}`
        );
      }
    } catch (e) {
      unreadable.push(filename);
      console.error("[msg-sage] attachment PDF extract failed:", e);
    }
  }

  return { extracted, unreadable };
}

/**
 * Co-Parent inbound message → Sage. Propose only.
 * Does not write a role:'user' journal row.
 */
export type InboundSageOptions = {
  /** The parent the sender addressed. Verified against the case. Resolved from the message when omitted. */
  recipientUserId?: string | null;
};

async function loadMessageRouting(
  admin: SupabaseClient,
  messageId: string
): Promise<{ senderId: string | null; recipientEmails: string[] }> {
  const { data, error } = await admin
    .from("messages")
    .select("sender_id, recipient_email")
    .eq("id", messageId)
    .maybeSingle();
  if (!error && data) {
    const row = data as { sender_id?: string | null; recipient_email?: string | null };
    return {
      senderId: (row.sender_id ?? "").trim() || null,
      recipientEmails: (row.recipient_email ?? "")
        .split(/[,;]/)
        .map((email) => email.trim())
        .filter(Boolean),
    };
  }
  const slim = await admin.from("messages").select("sender_id").eq("id", messageId).maybeSingle();
  const row = (slim.data ?? null) as { sender_id?: string | null } | null;
  return { senderId: (row?.sender_id ?? "").trim() || null, recipientEmails: [] };
}

/**
 * The parent whose Sage reads this message: the parent the message was addressed to.
 * A message the case cannot attribute to one receiving parent is left unread, not handed to the
 * primary account.
 */
export async function resolveReceivingUserId(
  admin: SupabaseClient,
  message: { id: string; case_id: string },
  explicitRecipientId?: string | null
): Promise<string | { error: string }> {
  const routing = await loadMessageRouting(admin, message.id);
  return resolveCaseReceiver(admin, {
    caseId: message.case_id,
    senderId: routing.senderId,
    recipientEmails: routing.recipientEmails,
    explicitRecipientId,
  });
}

/** The receiving parent for a message before or after it is saved. Shared by ingest and in-app sends. */
export async function resolveCaseReceiver(
  admin: SupabaseClient,
  input: {
    caseId: string;
    senderId: string | null;
    recipientEmails: (string | null | undefined)[];
    explicitRecipientId?: string | null;
  }
): Promise<string | { error: string }> {
  const directory = await parentDirectory(admin as never, input.caseId, input.senderId ?? "");
  const explicit = (input.explicitRecipientId ?? "").trim();
  if (explicit) {
    const onCase = directory.parents.some((parent) => parent.userId === explicit);
    if (!onCase) return { error: "The addressed parent is not on this case." };
    if (explicit === (input.senderId ?? "").trim()) return { error: "The sender cannot be the receiving parent." };
    return explicit;
  }
  const resolved = resolveReceivingParent({
    senderId: input.senderId,
    recipientEmails: input.recipientEmails,
    parents: directory.parents,
  });
  return resolved.ok ? resolved.userId : { error: resolved.error };
}

export async function processInboundMessageForSage(
  messageId: string,
  failedAttachments: AttachmentNotice[] = [],
  options: InboundSageOptions = {}
): Promise<void> {
  const admin = getServiceRoleClient();
  try {
    const { data: messageRow, error: messageErr } = await admin
      .from("messages")
      .select("id, case_id, conversation_id, original_content, ai_rewritten_content, created_at")
      .eq("id", messageId)
      .maybeSingle();
    if (messageErr) {
      logMsgSage(messageId, `skipped=load_failed error=${messageErr.message}`);
      return;
    }
    const message = messageRow as {
      id: string;
      case_id: string;
      conversation_id: string | null;
      original_content: string | null;
      ai_rewritten_content: string | null;
      created_at: string | null;
    } | null;
    if (!message) {
      logMsgSage(messageId, "skipped=message_not_found");
      return;
    }
    if (!message.conversation_id) {
      logMsgSage(messageId, "skipped=no_conversation");
      return;
    }

    const { data: convRow, error: convErr } = await admin
      .from("conversations")
      .select("id, subject, topic")
      .eq("id", message.conversation_id)
      .maybeSingle();
    if (convErr) {
      logMsgSage(messageId, `skipped=load_failed error=${convErr.message}`);
      return;
    }
    const conversation = convRow as {
      id: string;
      subject: string | null;
      topic: string | null;
    } | null;
    if (!conversation) {
      logMsgSage(messageId, "skipped=conversation_not_found");
      return;
    }

    const existingId = await findSageItemForSource(admin, "message", message.id);
    if (existingId) {
      logMsgSage(messageId, `skipped=sage_item_exists sage_item_id=${existingId}`);
      return;
    }

    // The receiving parent reads what the sender approved, never the sender's first draft.
    const bodyText = (message.ai_rewritten_content ?? "").trim() || (message.original_content ?? "").trim();
    const { extracted: pdfAttachments, unreadable } =
      await loadMessagePdfAttachments(admin, message.id);
    const storedFiles = [
      ...pdfAttachments.map((file) => ({ filename: file.filename, read: true })),
      ...unreadable.map((filename) => ({ filename, read: false })),
    ];
    const parts: string[] = [];
    if (bodyText) parts.push(bodyText);
    for (const attachment of pdfAttachments) {
      parts.push(formatAttachmentBlock(attachment));
    }
    const attachmentFacts = correctIntakeText("", { stored: storedFiles, failed: failedAttachments, ownMessage: false });
    if (attachmentFacts) parts.push(attachmentFacts);
    const text = parts.join("\n\n");
    if (!text) {
      logMsgSage(messageId, "skipped=empty_body");
      return;
    }

    const visibleTo = await resolveReceivingUserId(admin, message, options.recipientUserId);
    if (typeof visibleTo !== "string") {
      logMsgSage(messageId, `skipped=no_recipient error=${visibleTo.error}`);
      return;
    }

    const { data: profile } = await admin
      .from("users")
      .select("timezone")
      .eq("id", visibleTo)
      .maybeSingle();
    const timezone =
      typeof (profile as { timezone?: string | null } | null)?.timezone === "string" &&
      (profile as { timezone: string }).timezone.trim()
        ? (profile as { timezone: string }).timezone.trim()
        : "America/Denver";

    const rawItem: RawItem = {
      id: message.id,
      reply_to_id: null,
      from: "Co-Parent",
      timestamp: message.created_at ?? new Date().toISOString(),
      text,
      source: "message",
      ...(pdfAttachments.length > 0 ? { attachments: pdfAttachments } : {}),
    };
    const observation = buildObservation(message.id, [rawItem]);
    const incoming = await loadIncomingContext(admin, { messageId: message.id, recipientId: visibleTo });
    const [processed, reading] = await Promise.all([
      processObservation(observation, {
        case_id: message.case_id,
        timezone,
        source_type: "message",
        source_id: message.id,
        sender: "Co-Parent",
        plan_sender: "Co-Parent",
      }),
      incoming ? readIncomingCommunication(incoming) : Promise.resolve(null),
    ]);

    if (!needsAttention(processed.plan) && !readingNeedsAttention(reading)) {
      const intent = processed.interpretation.intent;
      const plan = processed.plan;
      console.log(
        "[msg-sage]",
        "status=",
        plan.status,
        "reasoning=",
        plan.reasoning,
        "proposals=",
        plan.proposals.map((p) => p.type).join(","),
        "item_type=",
        intent.item_type,
        "action_required=",
        intent.action_required,
        "action_type=",
        intent.action_type,
        "domain=",
        intent.domain,
        "confidence=",
        intent.confidence
      );
      logMsgSage(messageId, "skipped=no_attention");
      return;
    }

    const ensured = await ensureConversationSession(admin, {
      userId: visibleTo,
      conversationId: conversation.id,
      title: (conversation.subject ?? "").trim() || "(no subject)",
    });
    if (!ensured.id) {
      logMsgSage(messageId, `skipped=${ensured.error ?? "session_create_failed"}`);
      return;
    }
    const sessionId: string = ensured.id;

    const { intent, entities } = processed.interpretation;
    const { child_ids, resolved_dates } = processed;
    const correctedPlan = correctIntakeProposals(processed.plan.proposals, {
      storedFileNames: storedFiles.map((file) => file.filename),
      ownMessage: false,
    });
    const itemPlan = { ...processed.plan, proposals: correctedPlan.proposals };
    const summary = correctIntakeText(intent.summary, {
      stored: storedFiles,
      failed: failedAttachments,
      ownMessage: false,
    });
    const { data: sageRow, error: insertError } = await admin
      .from("sage_items")
      .insert({
        case_id: message.case_id,
        source_type: "message",
        source_id: message.id,
        visible_to: visibleTo,
        item_type: intent.item_type,
        domain: intent.domain,
        summary,
        evidence_excerpt: intent.evidence_excerpt,
        tool_name: intent.tool_name,
        action_required: intent.action_required,
        action_type: intent.action_type,
        urgency: intent.urgency,
        confidence: intent.confidence,
        tool_input: {
          ...entities,
          resolved_dates,
          ...(processed.expense_category
            ? { expense_category: processed.expense_category }
            : {}),
          ...(reading ? { communication_reading: reading } : {}),
        },
        child_ids,
        plan: itemPlan,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !sageRow) {
      if (isUniqueViolation(insertError)) {
        const racedId = await findSageItemForSource(admin, "message", message.id);
        logMsgSage(
          messageId,
          `skipped=sage_item_exists${racedId ? ` sage_item_id=${racedId}` : ""}`
        );
        return;
      }
      logMsgSage(
        messageId,
        `skipped=sage_item_insert_failed error=${insertError?.message ?? "insert failed"}`
      );
      return;
    }

    const sageItemId = (sageRow as { id: string }).id;
    const content = correctIntakeText(
      inboundNarration({
        reading,
        ctx: incoming,
        replyReady: hasOutboundDraft(itemPlan),
        fallback: narrationFor(itemPlan, summary),
      }),
      { stored: storedFiles, failed: failedAttachments, ownMessage: false }
    );
    const journalRow = {
      user_id: visibleTo,
      role: "sage" as const,
      session_id: sessionId,
      sage_item_id: sageItemId,
      source_message_id: message.id,
      content,
    };
    let { error: journalErr } = await admin.from("sage_journal_messages").insert(journalRow);
    if (journalErr && /source_message_id/i.test(journalErr.message ?? "")) {
      const { source_message_id: _ignored, ...withoutSource } = journalRow;
      void _ignored;
      ({ error: journalErr } = await admin.from("sage_journal_messages").insert(withoutSource));
    }
    if (journalErr) {
      logMsgSage(
        messageId,
        `session_id=${sessionId} sage_item_id=${sageItemId} journal_failed=${journalErr.message}`
      );
      return;
    }

    const { error: touchErr } = await admin
      .from("sage_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (touchErr) {
      logMsgSage(
        messageId,
        `session_id=${sessionId} sage_item_id=${sageItemId} touch_failed=${touchErr.message}`
      );
      return;
    }

    logMsgSage(messageId, `session_id=${sessionId} sage_item_id=${sageItemId}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "processInboundMessageForSage failed";
    logMsgSage(messageId, `skipped=error error=${message}`);
    console.error("[msg-sage]", e);
  }
}
