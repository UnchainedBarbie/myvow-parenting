import type { getServiceRoleClient } from "@/lib/supabase/server";
import { processChatMessage } from "@/lib/sage/chat";
import {
  loadAndClassifyDocument,
  mergeClassifyIntoToolInput,
  processChatAttachment,
  type ChatAttachmentProcessResult,
} from "@/lib/sage/process-chat-attachment";

type Admin = ReturnType<typeof getServiceRoleClient>;

const FALLBACK_REPLY =
  "I'm here with you. Take a breath, then tell me what feels most important about this moment for your children.";

export type SelfInboundThread = {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
};

function threadCandidates(thread: SelfInboundThread): string[] {
  const ids: string[] = [];
  if (thread.inReplyTo) ids.push(thread.inReplyTo);
  for (const id of thread.references) {
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key/i.test(error.message ?? "");
}

function activeSessionFilter<T extends { or: (filters: string) => T }>(query: T): T {
  return query.or("archived.is.null,archived.eq.false");
}

async function sessionForThreadIds(
  admin: Admin,
  caseId: string,
  userId: string,
  threadIds: string[]
): Promise<string | null> {
  if (threadIds.length === 0) return null;

  const { data: sessions, error: sessionErr } = await activeSessionFilter(
    admin
      .from("sage_sessions")
      .select("id")
      .eq("user_id", userId)
      .in("email_thread_id", threadIds)
  )
    .order("updated_at", { ascending: false })
    .limit(1);
  if (sessionErr) {
    console.error(`[sender-id] session lookup failed: ${sessionErr.message}`);
  }
  const sessionId = (sessions?.[0] as { id?: string } | undefined)?.id;
  if (sessionId) return sessionId;

  const { data: intakes, error: intakeErr } = await admin
    .from("email_intake")
    .select("sage_session_id")
    .eq("case_id", caseId)
    .in("message_id", threadIds)
    .not("sage_session_id", "is", null)
    .order("received_at", { ascending: false })
    .limit(1);
  if (intakeErr) {
    console.error(`[sender-id] intake session lookup failed: ${intakeErr.message}`);
    return null;
  }
  return (intakes?.[0] as { sage_session_id?: string | null } | undefined)?.sage_session_id ?? null;
}

/**
 * Reuse the session for this email thread, or open one keyed by Message-ID.
 * conversation_id stays null. A unique violation means a concurrent delivery won the insert.
 */
export async function findOrCreateSelfSession(
  admin: Admin,
  input: {
    caseId: string;
    userId: string;
    subject: string;
    thread: SelfInboundThread;
  }
): Promise<string | null> {
  const matched = await sessionForThreadIds(
    admin,
    input.caseId,
    input.userId,
    threadCandidates(input.thread)
  );
  if (matched) return matched;

  const title = input.subject.trim() || "(no subject)";
  const { data: created, error } = await admin
    .from("sage_sessions")
    .insert({
      user_id: input.userId,
      session_type: "private",
      category: "general",
      title,
      email_thread_id: input.thread.messageId,
    })
    .select("id")
    .single();
  if (!error && created) return (created as { id: string }).id;
  if (!isUniqueViolation(error) || !input.thread.messageId) {
    console.error(
      `[sender-id] session create failed: ${error?.message ?? "insert failed"}`
    );
    return null;
  }

  const { data: raced, error: racedErr } = await activeSessionFilter(
    admin
      .from("sage_sessions")
      .select("id")
      .eq("user_id", input.userId)
      .eq("email_thread_id", input.thread.messageId)
  )
    .order("updated_at", { ascending: false })
    .limit(1);
  if (racedErr || !raced?.[0]) {
    console.error(
      `[sender-id] session race failed: ${racedErr?.message ?? "active session not found"}`
    );
    return null;
  }
  return (raced[0] as { id: string }).id;
}

function selfJournalContent(bodyText: string, filenames: string[]): string {
  const body = bodyText.trim();
  const [first, ...rest] = filenames;
  if (!first) return body;
  if (!body) return [`Attached: ${first}`, ...rest].join("\n");
  if (rest.length === 0) return body;
  return [body, ...rest].join("\n\n");
}

async function ownerTimezone(admin: Admin, userId: string): Promise<string> {
  const { data } = await admin.from("users").select("timezone").eq("id", userId).maybeSingle();
  const timezone = (data as { timezone?: string | null } | null)?.timezone?.trim();
  return timezone || "America/Denver";
}

/**
 * Forwarded mail is untrusted data. This only proposes, the same way the composer does.
 * Nothing here files a document or sends a message.
 */
export async function runSelfEmailComposer(opts: {
  admin: Admin;
  caseId: string;
  userId: string;
  intakeId: string;
  sessionId: string;
  bodyText: string;
  documents: { id: string; filename: string }[];
}): Promise<void> {
  const { admin } = opts;
  const content = selfJournalContent(opts.bodyText, opts.documents.map((doc) => doc.filename));
  const { data: userRow, error: userErr } = await admin
    .from("sage_journal_messages")
    .insert({
      user_id: opts.userId,
      role: "user",
      content,
      session_id: opts.sessionId,
      submission_channel: "email",
      email_intake_id: opts.intakeId,
      source_message_id: null,
    })
    .select("id")
    .single();
  if (userErr || !userRow) {
    console.error(
      `[sender-id] journal insert failed: ${userErr?.message ?? "insert failed"}`
    );
    return;
  }

  const sourceId = (userRow as { id: string }).id;
  const timezone = await ownerTimezone(admin, opts.userId);
  const caption = opts.bodyText.trim();
  let sageContent = FALLBACK_REPLY;
  let sageItemId: string | null = null;

  try {
    const first = opts.documents[0];
    if (first) {
      const classified = await loadAndClassifyDocument({
        admin,
        userId: opts.userId,
        caseId: opts.caseId,
        documentId: first.id,
      });
      if ("error" in classified) {
        console.error(`[sender-id] classify failed: ${classified.error}`);
        const { reply, result } = await processChatMessage({
          message: content || caption || first.filename,
          case_id: opts.caseId,
          timezone,
          source_id: sourceId,
        });
        if (reply.trim()) sageContent = reply;
        sageItemId = await insertChatSageItem(admin, {
          caseId: opts.caseId,
          userId: opts.userId,
          sourceId,
          result,
        });
      } else {
        const processed = await processChatAttachment({
          caseId: opts.caseId,
          timezone,
          sourceId,
          caption,
          classify: classified.classify,
          attachment: {
            ...classified.attachment,
            file_name: first.filename || classified.attachment.file_name,
          },
        });
        if (processed.reply.trim()) sageContent = processed.reply;
        sageItemId = await insertAttachmentSageItem(admin, {
          caseId: opts.caseId,
          userId: opts.userId,
          sourceId,
          processed,
        });
      }
    } else {
      const { reply, result } = await processChatMessage({
        message: content,
        case_id: opts.caseId,
        timezone,
        source_id: sourceId,
      });
      if (reply.trim()) sageContent = reply;
      sageItemId = await insertChatSageItem(admin, {
        caseId: opts.caseId,
        userId: opts.userId,
        sourceId,
        result,
      });
    }
  } catch (e) {
    console.error("[sender-id] composer failed:", e);
  }

  const { error: sageErr } = await admin.from("sage_journal_messages").insert({
    user_id: opts.userId,
    role: "sage",
    content: sageContent,
    session_id: opts.sessionId,
    ...(sageItemId ? { sage_item_id: sageItemId } : {}),
  });
  if (sageErr) {
    console.error(`[sender-id] sage journal failed: ${sageErr.message}`);
  }

  const { error: touchErr } = await admin
    .from("sage_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", opts.sessionId)
    .eq("user_id", opts.userId);
  if (touchErr) {
    console.error(`[sender-id] session touch failed: ${touchErr.message}`);
  }
}

async function insertChatSageItem(
  admin: Admin,
  opts: {
    caseId: string;
    userId: string;
    sourceId: string;
    result: Awaited<ReturnType<typeof processChatMessage>>["result"];
  }
): Promise<string | null> {
  const { intent, entities } = opts.result.interpretation;
  const { data, error } = await admin
    .from("sage_items")
    .insert({
      case_id: opts.caseId,
      source_type: "chat",
      source_id: opts.sourceId,
      visible_to: opts.userId,
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
        resolved_dates: opts.result.resolved_dates,
        ...(opts.result.expense_category
          ? { expense_category: opts.result.expense_category }
          : {}),
      },
      child_ids: opts.result.child_ids,
      plan: opts.result.plan,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[sender-id] sage_items insert failed:", error?.message ?? "insert failed");
    return null;
  }
  return (data as { id: string }).id;
}

async function insertAttachmentSageItem(
  admin: Admin,
  opts: {
    caseId: string;
    userId: string;
    sourceId: string;
    processed: ChatAttachmentProcessResult;
  }
): Promise<string | null> {
  if (!opts.processed.result) return null;
  const { intent, entities } = opts.processed.result.interpretation;
  const { data, error } = await admin
    .from("sage_items")
    .insert({
      case_id: opts.caseId,
      source_type: "chat",
      source_id: opts.sourceId,
      visible_to: opts.userId,
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
        ...mergeClassifyIntoToolInput(
          entities as unknown as Record<string, unknown>,
          opts.processed.result,
          opts.processed.classify,
          opts.processed.attachment
        ),
        classify: opts.processed.classify,
      },
      child_ids: opts.processed.result.child_ids,
      plan: opts.processed.result.plan,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[sender-id] sage_items insert failed:", error?.message ?? "insert failed");
    return null;
  }
  return (data as { id: string }).id;
}
