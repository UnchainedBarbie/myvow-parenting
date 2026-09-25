import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import type { ClassifyPayload } from "@/lib/ai-classify";
import {
  buildAlternateTypeResult,
  mergeClassifyIntoToolInput,
  type ChatAttachmentMeta,
} from "@/lib/sage/process-chat-attachment";
import {
  isCalendarUpdateProposal,
  isFormExecuteProposal,
  isLogDocumentProposal,
  isLogExpenseProposal,
} from "@/lib/sage/proposal-kind";

export const runtime = "nodejs";

type PlanProposal = {
  type?: string;
  draft?: string;
  revised_text?: string | null;
  depends_on?: string | null;
  requires_approval?: boolean;
  approved?: boolean;
  approved_at?: string;
  chosen_date?: string;
  status?: string;
  waived_at?: string;
  unblocked?: boolean;
  executed?: boolean;
  executed_at?: string;
  result_event_id?: string;
  result_expense_id?: string;
  attached_document_id?: string;
  attached_file_name?: string;
  attached_file_url?: string;
  title?: string;
  description?: string;
  category?: string;
  date?: string | null;
};

type SagePlan = {
  status?: string;
  proposals?: PlanProposal[];
  reasoning?: string;
  [key: string]: unknown;
};

const SAGE_ITEM_SELECT =
  "id, item_type, domain, summary, evidence_excerpt, urgency, action_required, child_ids, tool_input, plan, status, flagged, created_at";

function asClassifyPayload(value: unknown): ClassifyPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (o.type !== "document" && o.type !== "expense" && o.type !== "event") {
    return null;
  }
  if (typeof o.confidence !== "number") return null;
  return value as ClassifyPayload;
}

function toolInputRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function attachmentFromProposal(
  p: PlanProposal,
  input: Record<string, unknown> | null
): ChatAttachmentMeta | null {
  const fromProposal =
    typeof p.attached_document_id === "string" ? p.attached_document_id.trim() : "";
  const fromInput =
    typeof input?.attached_document_id === "string"
      ? input.attached_document_id.trim()
      : "";
  const document_id = fromProposal || fromInput;
  if (!document_id) return null;
  const file_name =
    (typeof p.attached_file_name === "string" && p.attached_file_name.trim()) ||
    (typeof input?.attached_file_name === "string" &&
      String(input.attached_file_name).trim()) ||
    "file";
  const url =
    (typeof p.attached_file_url === "string" && p.attached_file_url.trim()) ||
    (typeof input?.attached_file_url === "string" &&
      String(input.attached_file_url).trim()) ||
    `/api/documents/${document_id}/download`;
  return { document_id, file_name, url };
}

function filedTitle(p: PlanProposal, attachment: ChatAttachmentMeta | null): string {
  const fromProposal = typeof p.title === "string" ? p.title.trim() : "";
  return fromProposal || attachment?.file_name || "document";
}

async function insertFiledConfirmation(opts: {
  admin: ReturnType<typeof getServiceRoleClient>;
  userId: string;
  sourceId: string | null;
  title: string;
}): Promise<Record<string, unknown> | null> {
  let sessionId: string | null = null;
  if (opts.sourceId) {
    const { data: sourceMsg } = await opts.admin
      .from("sage_journal_messages")
      .select("session_id")
      .eq("id", opts.sourceId)
      .maybeSingle();
    sessionId =
      typeof sourceMsg?.session_id === "string" ? sourceMsg.session_id : null;
  }
  const content = `Filed “${opts.title}” in your documents.`;
  const sagePayload: Record<string, unknown> = {
    user_id: opts.userId,
    role: "sage",
    content,
    created_at: new Date().toISOString(),
    ...(sessionId ? { session_id: sessionId } : {}),
  };
  const { data: sageRow, error: sageErr } = await opts.admin
    .from("sage_journal_messages")
    .insert(sagePayload)
    .select("id, user_id, role, content, created_at, session_id")
    .single();
  if (sageErr) {
    console.warn("[sage-inbox/POST] filed confirmation insert failed:", sageErr.message);
    return null;
  }
  return {
    ...(sageRow as Record<string, unknown>),
    sage_item: null,
  };
}

/**
 * GET /api/sage-inbox?status=open|flagged|archived|all
 * Authenticated parent user.
 * Returns sage_items for the user's case that are visible to them.
 * Chat-sourced rows (source_type = 'chat') stay in the conversation UI, not here.
 * Default status=open (status ≠ archived).
 * flagged = flagged = true (any archive status).
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const { data: membership, error: membershipError } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.error("[sage-inbox/GET] Error loading membership:", membershipError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!membership?.case_id) {
      return NextResponse.json({ error: "No case found" }, { status: 403 });
    }

    const caseId = membership.case_id as string;
    const statusParam = (req.nextUrl.searchParams.get("status") ?? "open").toLowerCase();
    const statusFilter =
      statusParam === "archived" ||
      statusParam === "flagged" ||
      statusParam === "all"
        ? statusParam
        : "open";

    let query = admin
      .from("sage_items")
      .select(
        "id, item_type, domain, summary, evidence_excerpt, urgency, action_required, child_ids, tool_input, plan, status, flagged, created_at"
      )
      .eq("case_id", caseId)
      .eq("visible_to", user.id)
      .neq("source_type", "chat")
      .order("created_at", { ascending: false });

    if (statusFilter === "archived") {
      query = query.eq("status", "archived");
    } else if (statusFilter === "flagged") {
      query = query.eq("flagged", true);
    } else if (statusFilter === "open") {
      query = query.neq("status", "archived");
    }
    // "all" — no status/flag filter

    const { data: items, error: itemsError } = await query;

    if (itemsError) {
      console.error("[sage-inbox/GET] Error loading sage_items:", itemsError);
      return NextResponse.json({ error: "Failed to load sage items" }, { status: 500 });
    }

    return NextResponse.json(items ?? []);
  } catch (e) {
    console.error("[sage-inbox/GET] Unhandled error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/sage-inbox
 * Body variants:
 *  - { id, action: "agree"|"dismiss"|"undo", proposal_indexes, dates? }
 *  - { id, action: "revise", proposal_index, revised_text }
 *  - { id, action: "execute", proposal_index, event_id? | expense_id? }
 * Records approval/waiver/undo/revise/execute on plan.proposals — does NOT execute calendar/email/expense itself
 * (calendar create happens client-side via AddEventForm; expense create via ExpenseForm;
 *  execute only marks the proposal done).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      id?: string | null;
      action?: string | null;
      proposal_indexes?: unknown;
      proposal_index?: unknown;
      revised_text?: unknown;
      event_id?: unknown;
      expense_id?: unknown;
      document_id?: unknown;
      filed_title?: unknown;
      dates?: Record<string, string> | null;
    } | null;

    const id = body?.id ? String(body.id) : "";
    const action =
      body?.action === "agree" ||
      body?.action === "dismiss" ||
      body?.action === "undo" ||
      body?.action === "revise" ||
      body?.action === "execute"
        ? body.action
        : null;

    if (!id || !action) {
      return NextResponse.json(
        { success: false, error: "Invalid id or action" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const { data: row, error: fetchError } = await admin
      .from("sage_items")
      .select("id, plan, case_id, source_id, source_type, tool_input, visible_to")
      .eq("id", id)
      .eq("visible_to", user.id)
      .maybeSingle();

    if (fetchError) {
      console.error("[sage-inbox/POST] Failed to load sage_item:", fetchError);
      return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json({ success: false, error: "Item not found" }, { status: 404 });
    }

    const plan = (
      row.plan && typeof row.plan === "object" ? { ...(row.plan as SagePlan) } : { proposals: [] }
    ) as SagePlan;

    const proposals = Array.isArray(plan.proposals)
      ? plan.proposals.map((p) => ({ ...p }))
      : [];

    if (action === "revise") {
      const idx =
        typeof body?.proposal_index === "number" && Number.isInteger(body.proposal_index)
          ? body.proposal_index
          : -1;
      const revisedText =
        typeof body?.revised_text === "string" ? body.revised_text.trim() : "";
      if (idx < 0 || idx >= proposals.length || !revisedText) {
        return NextResponse.json(
          { success: false, error: "Invalid proposal_index or revised_text" },
          { status: 400 }
        );
      }
      const p = proposals[idx];
      if (!p || (p.type !== "reply_coparent" && p.type !== "ask_clarification")) {
        return NextResponse.json(
          { success: false, error: "Proposal is not revisable" },
          { status: 400 }
        );
      }
      if (p.executed === true) {
        return NextResponse.json(
          { success: false, error: "already sent, cannot revise" },
          { status: 400 }
        );
      }
      proposals[idx] = { ...p, revised_text: revisedText };
      const updatedPlan: SagePlan = { ...plan, proposals };
      const { error: updateError } = await admin
        .from("sage_items")
        .update({ plan: updatedPlan })
        .eq("id", id)
        .eq("visible_to", user.id);
      if (updateError) {
        console.error("[sage-inbox/POST] Failed to save revise:", updateError);
        return NextResponse.json(
          { success: false, error: updateError.message ?? "Failed to save revise" },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, plan: updatedPlan });
    }

    if (action === "execute") {
      const idx =
        typeof body?.proposal_index === "number" && Number.isInteger(body.proposal_index)
          ? body.proposal_index
          : -1;
      const eventId =
        typeof body?.event_id === "string" && body.event_id.trim()
          ? body.event_id.trim()
          : "";
      const expenseId =
        typeof body?.expense_id === "string" && body.expense_id.trim()
          ? body.expense_id.trim()
          : "";
      const documentId =
        typeof body?.document_id === "string" && body.document_id.trim()
          ? body.document_id.trim()
          : "";
      const filedTitleFromBody =
        typeof body?.filed_title === "string" ? body.filed_title.trim() : "";
      if (idx < 0 || idx >= proposals.length) {
        return NextResponse.json(
          { success: false, error: "Invalid proposal_index" },
          { status: 400 }
        );
      }
      const p = proposals[idx];
      if (!p || !isFormExecuteProposal(p.type)) {
        return NextResponse.json(
          { success: false, error: "Proposal is not executable" },
          { status: 400 }
        );
      }
      if (isCalendarUpdateProposal(p.type) && !eventId) {
        return NextResponse.json(
          { success: false, error: "Invalid event_id" },
          { status: 400 }
        );
      }
      if (isLogExpenseProposal(p.type) && !expenseId) {
        return NextResponse.json(
          { success: false, error: "Invalid expense_id" },
          { status: 400 }
        );
      }
      const toolInputForExecute = toolInputRecord(
        (row as { tool_input?: unknown }).tool_input
      );
      const documentAttachment = isLogDocumentProposal(p.type)
        ? attachmentFromProposal(p, toolInputForExecute)
        : null;
      if (isLogDocumentProposal(p.type) && !documentId && !documentAttachment) {
        return NextResponse.json(
          { success: false, error: "Invalid document_id" },
          { status: 400 }
        );
      }
      if (p.executed === true) {
        return NextResponse.json(
          { success: false, error: "already executed" },
          { status: 400 }
        );
      }
      const nowIso = new Date().toISOString();
      const resultDocumentId =
        documentId || documentAttachment?.document_id || "";
      proposals[idx] = {
        ...p,
        approved: true,
        approved_at: p.approved_at ?? nowIso,
        executed: true,
        executed_at: nowIso,
        ...(isCalendarUpdateProposal(p.type) ? { result_event_id: eventId } : {}),
        ...(isLogExpenseProposal(p.type) ? { result_expense_id: expenseId } : {}),
        ...(isLogDocumentProposal(p.type) && resultDocumentId
          ? { result_document_id: resultDocumentId, title: filedTitleFromBody || p.title }
          : {}),
      };
      const updatedPlan: SagePlan = { ...plan, proposals };
      const { error: updateError } = await admin
        .from("sage_items")
        .update({ plan: updatedPlan, status: "in_progress" })
        .eq("id", id)
        .eq("visible_to", user.id);
      if (updateError) {
        console.error("[sage-inbox/POST] Failed to save execute:", updateError);
        return NextResponse.json(
          { success: false, error: updateError.message ?? "Failed to mark executed" },
          { status: 500 }
        );
      }
      if (isLogDocumentProposal(p.type)) {
        const title =
          filedTitleFromBody || filedTitle(p, documentAttachment);
        const confirmation = await insertFiledConfirmation({
          admin,
          userId: user.id,
          sourceId: (row as { source_id?: string | null }).source_id ?? null,
          title,
        });
        return NextResponse.json({
          success: true,
          plan: updatedPlan,
          ...(confirmation ? { sage_messages: [confirmation] } : {}),
        });
      }
      return NextResponse.json({ success: true, plan: updatedPlan });
    }

    const indexes = Array.isArray(body?.proposal_indexes)
      ? body!.proposal_indexes.filter(
          (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0
        )
      : [];
    const dates =
      body?.dates && typeof body.dates === "object" && !Array.isArray(body.dates)
        ? body.dates
        : {};

    if (indexes.length === 0) {
      return NextResponse.json(
        { success: false, error: "Invalid proposal_indexes" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    let waivedAskClarification = false;
    let undidWaivedAskClarification = false;
    const toolInput = toolInputRecord(
      (row as { tool_input?: unknown }).tool_input
    );
    const classify = asClassifyPayload(toolInput?.classify);
    type ChatFollowUp =
      | { kind: "filed"; title: string }
      | {
          kind: "alternates";
          attachment: ChatAttachmentMeta;
          classify: ClassifyPayload | null;
        };
    const chatFollowUps: ChatFollowUp[] = [];

    for (const idx of indexes) {
      if (idx >= proposals.length) continue;
      const p = proposals[idx];
      if (!p || p.type === "note_only") continue;

      if (action === "undo") {
        if (p.executed === true) {
          return NextResponse.json(
            { success: false, error: "already sent, cannot undo" },
            { status: 400 }
          );
        }
        const wasWaivedAsk =
          p.type === "ask_clarification" && p.status === "waived_by_user";
        const next: PlanProposal = { ...p };
        delete next.approved;
        delete next.approved_at;
        delete next.chosen_date;
        delete next.status;
        delete next.waived_at;
        proposals[idx] = next;
        if (wasWaivedAsk) undidWaivedAskClarification = true;
        continue;
      }

      if (p.executed === true) continue;
      if (p.approved === true || p.status === "waived_by_user") continue;

      const blocked =
        p.depends_on != null &&
        String(p.depends_on).trim() !== "" &&
        p.unblocked !== true;
      if (action === "agree" && blocked) continue;

      if (action === "agree") {
        // Calendar, expense, and document must go through the form + execute, never record-only approve.
        if (isFormExecuteProposal(p.type)) continue;
        const chosenDate =
          dates[String(idx)] ?? dates[idx as unknown as string] ?? undefined;
        proposals[idx] = {
          ...p,
          approved: true,
          approved_at: now,
          ...(typeof chosenDate === "string" && chosenDate.trim()
            ? { chosen_date: chosenDate.trim() }
            : {}),
        };
      } else {
        if (isLogDocumentProposal(p.type)) {
          const attachment = attachmentFromProposal(p, toolInput);
          if (attachment) {
            const { error: docErr } = await admin
              .from("documents")
              .update({ status: "dismissed" })
              .eq("id", attachment.document_id);
            if (docErr) {
              console.error("[sage-inbox/POST] document dismiss failed:", docErr);
              return NextResponse.json(
                { success: false, error: "Failed to dismiss the document." },
                { status: 500 }
              );
            }
            chatFollowUps.push({
              kind: "alternates",
              attachment,
              classify,
            });
          }
        }
        proposals[idx] = {
          ...p,
          status: "waived_by_user",
          waived_at: now,
        };
        if (p.type === "ask_clarification") {
          waivedAskClarification = true;
        }
      }
    }

    // v1 simplification: dismissing ANY ask_clarification proposal sets unblocked = true
    // on all OTHER proposals in that plan that had a non-null depends_on.
    if (waivedAskClarification) {
      for (let i = 0; i < proposals.length; i++) {
        const p = proposals[i];
        if (!p) continue;
        if (p.status === "waived_by_user") continue;
        if (p.depends_on != null && String(p.depends_on).trim() !== "") {
          proposals[i] = { ...p, unblocked: true };
        }
      }
    }

    if (undidWaivedAskClarification) {
      const stillHasWaivedAsk = proposals.some(
        (p) => p.type === "ask_clarification" && p.status === "waived_by_user"
      );
      if (!stillHasWaivedAsk) {
        for (let i = 0; i < proposals.length; i++) {
          const p = proposals[i];
          if (!p) continue;
          if (p.depends_on != null && String(p.depends_on).trim() !== "") {
            const next = { ...p };
            delete next.unblocked;
            proposals[i] = next;
          }
        }
      }
    }

    const updatedPlan: SagePlan = { ...plan, proposals };

    const { error: updateError } = await admin
      .from("sage_items")
      .update({ plan: updatedPlan, status: "in_progress" })
      .eq("id", id)
      .eq("visible_to", user.id);

    if (updateError) {
      console.error("[sage-inbox/POST] Failed to update plan:", updateError);
      return NextResponse.json(
        { success: false, error: updateError.message ?? "Failed to record action" },
        { status: 500 }
      );
    }

    const sageMessages: Record<string, unknown>[] = [];
    const sourceId = (row as { source_id?: string | null }).source_id ?? null;
    const caseId = (row as { case_id?: string | null }).case_id ?? null;
    let sessionId: string | null = null;
    if (sourceId) {
      const { data: sourceMsg } = await admin
        .from("sage_journal_messages")
        .select("session_id")
        .eq("id", sourceId)
        .maybeSingle();
      sessionId =
        typeof sourceMsg?.session_id === "string" ? sourceMsg.session_id : null;
    }

    for (const follow of chatFollowUps) {
      if (follow.kind === "filed") {
        const content = `Filed “${follow.title}” in your documents.`;
        const sagePayload: Record<string, unknown> = {
          user_id: user.id,
          role: "sage",
          content,
          created_at: new Date().toISOString(),
          ...(sessionId ? { session_id: sessionId } : {}),
        };
        const { data: sageRow, error: sageErr } = await admin
          .from("sage_journal_messages")
          .insert(sagePayload)
          .select("id, user_id, role, content, created_at, session_id")
          .single();
        if (sageErr) {
          console.warn("[sage-inbox/POST] filed confirmation insert failed:", sageErr.message);
          continue;
        }
        sageMessages.push({
          ...(sageRow as Record<string, unknown>),
          sage_item: null,
        });
        continue;
      }

      if (!caseId) continue;
      const alternate = buildAlternateTypeResult(
        follow.attachment,
        "document",
        sourceId ?? undefined
      );
      const followClassify = follow.classify;
      const followToolInput = followClassify
        ? {
            ...mergeClassifyIntoToolInput(
              alternate.interpretation.entities as unknown as Record<string, unknown>,
              alternate,
              followClassify,
              follow.attachment
            ),
            classify: followClassify,
          }
        : {
            attached_document_id: follow.attachment.document_id,
            attached_file_name: follow.attachment.file_name,
            attached_file_url: follow.attachment.url,
          };
      const { intent } = alternate.interpretation;
      const { data: itemRow, error: insertItemError } = await admin
        .from("sage_items")
        .insert({
          case_id: caseId,
          source_type: "chat",
          source_id: sourceId,
          visible_to: user.id,
          item_type: intent.item_type,
          domain: intent.domain,
          summary: intent.summary,
          evidence_excerpt: intent.evidence_excerpt,
          tool_name: intent.tool_name,
          action_required: intent.action_required,
          action_type: intent.action_type,
          urgency: intent.urgency,
          confidence: intent.confidence,
          tool_input: followToolInput,
          child_ids: alternate.child_ids,
          plan: alternate.plan,
          status: "pending",
        })
        .select(SAGE_ITEM_SELECT)
        .single();
      if (insertItemError || !itemRow) {
        console.error(
          "[sage-inbox/POST] alternate-type sage_items insert failed:",
          insertItemError
        );
        continue;
      }
      const content = intent.summary;
      const sagePayload: Record<string, unknown> = {
        user_id: user.id,
        role: "sage",
        content,
        created_at: new Date().toISOString(),
        ...(sessionId ? { session_id: sessionId } : {}),
        sage_item_id: itemRow.id,
      };
      const { data: sageRow, error: sageErr } = await admin
        .from("sage_journal_messages")
        .insert(sagePayload)
        .select("id, user_id, role, content, created_at, session_id, sage_item_id")
        .single();
      if (sageErr || !sageRow) {
        console.warn(
          "[sage-inbox/POST] alternate-type journal insert failed:",
          sageErr?.message
        );
        continue;
      }
      sageMessages.push({
        ...(sageRow as Record<string, unknown>),
        sage_item: itemRow,
      });
    }

    if (sessionId && sageMessages.length > 0) {
      await admin
        .from("sage_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("user_id", user.id);
    }

    return NextResponse.json({
      success: true,
      plan: updatedPlan,
      ...(sageMessages[0] ? { sage_message: sageMessages[0] } : {}),
      ...(sageMessages.length > 0 ? { sage_messages: sageMessages } : {}),
    });
  } catch (e) {
    console.error("[sage-inbox/POST] Unhandled error:", e);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/sage-inbox
 * Body: { id, status?: 'archived'|'pending'|'dismissed', flagged?: boolean }
 * Updates sage_items for an item visible to the current user.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { id?: string | null; status?: string | null; flagged?: boolean | null }
      | null;

    const id = body?.id ? String(body.id) : "";
    const status =
      body?.status === "archived" ||
      body?.status === "pending" ||
      body?.status === "dismissed"
        ? body.status
        : null;
    const hasFlagged = typeof body?.flagged === "boolean";
    const flagged = hasFlagged ? body!.flagged : null;

    if (!id || (status === null && !hasFlagged)) {
      return NextResponse.json(
        { success: false, error: "Invalid id or update fields" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const updates: { status?: string; flagged?: boolean } = {};
    if (status) updates.status = status;
    if (hasFlagged) updates.flagged = flagged as boolean;

    const admin = getServiceRoleClient();
    const { error: updateError } = await admin
      .from("sage_items")
      .update(updates)
      .eq("id", id)
      .eq("visible_to", user.id);

    if (updateError) {
      console.error("[sage-inbox/PATCH] Failed to update sage_items:", updateError);
      return NextResponse.json(
        { success: false, error: updateError.message ?? "Failed to update" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[sage-inbox/PATCH] Unhandled error:", e);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
