import { NextRequest, NextResponse } from "next/server";
import type { ClassifyPayload } from "@/lib/ai-classify";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { loadCalendarContext } from "@/lib/sage/calendar-chat";
import { reconcileCalendarPlan } from "@/lib/sage/calendar-match";
import { processChatMessage } from "@/lib/sage/chat";
import { scheduleShadowComparison } from "@/lib/sage/shadow-interpreter";
import { loadSessionTurns } from "@/lib/sage/session-turns";
import { pendingDocument, shouldPreserveOpenWork } from "@/lib/sage/chat-intent";
import { prepareAnalysisRead } from "@/lib/sage/analysis-sources";
import { requestsDocumentAnalysis } from "@/lib/sage/document-read";
import { applySessionControl } from "@/lib/sage/chat-control";
import { isDocumentFilingRequest, openDocumentStates } from "@/lib/sage/document-intent";
import {
  loadLatestOpenDocument,
  loadVisibleDocuments,
  reviseLatestOpenDocument,
  syncPendingDocumentMetadata,
} from "@/lib/sage/document-records";
import type { DocumentProposalState } from "@/lib/sage/document-intent";
import { loadKnownCoparents } from "@/lib/sage/known-coparents";
import {
  formatConversationContext,
  loadConversationContext,
  type ConversationContext,
} from "@/lib/sage/conversation-context";
import { matchingLedgerText } from "@/lib/sage/ledger-facts";
import { redraftMessage } from "@/lib/sage/planner";
import {
  isInactiveProposal,
  reviseProposal,
  withProposalIds,
} from "@/lib/sage/proposal-lifecycle";
import {
  forcedTypeFromProposal,
  loadAndClassifyDocument,
  mergeClassifyIntoToolInput,
  processChatAttachment,
  type ChatAttachmentMeta,
  type ChatAttachmentProcessResult,
} from "@/lib/sage/process-chat-attachment";
import { linkedIncomingMessageIds } from "@/lib/sage/original-message";
import { applyStoredIntake } from "@/lib/sage/apply-intake-correction";
import type { SageAttachmentView } from "@/lib/sage/message-attachments";

export const runtime = "nodejs";

const SAGE_ITEM_SELECT =
  "id, item_type, domain, summary, evidence_excerpt, urgency, action_required, child_ids, tool_input, plan, status, flagged, created_at";

const JOURNAL_SELECT_BASE =
  "id, user_id, role, content, created_at, session_id";
const JOURNAL_SELECT = `${JOURNAL_SELECT_BASE}, sage_item_id, source_message_id`;

function missingSageItemIdColumn(error: { message?: string } | null): boolean {
  return !!error?.message && /sage_item_id/i.test(error.message);
}

const FALLBACK_REPLY =
  "I'm here with you. Take a breath, then tell me what feels most important about this moment for your children.";

type SageMessageRow = {
  id: string;
  user_id: string;
  role: "user" | "sage";
  content: string;
  created_at: string;
  session_id?: string | null;
  sage_item_id?: string | null;
  source_message_id?: string | null;
  source_conversation_id?: string | null;
  source_message_ids?: string[];
  source_own_message?: boolean;
  source_attachments?: SageAttachmentView[];
  sage_item?: unknown | null;
};

function timezoneFromProfile(profile: { timezone?: string } | null): string {
  if (profile && typeof profile.timezone === "string") {
    return profile.timezone.trim() || "America/Denver";
  }
  return "America/Denver";
}

type AdminClient = ReturnType<typeof getServiceRoleClient>;

function toolInputRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asClassifyPayload(value: unknown): ClassifyPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (o.type !== "document" && o.type !== "expense" && o.type !== "event") {
    return null;
  }
  if (typeof o.confidence !== "number") return null;
  return value as ClassifyPayload;
}

function attachmentFromStored(
  input: Record<string, unknown> | null,
  proposal: {
    attached_document_id?: unknown;
    attached_file_name?: unknown;
    attached_file_url?: unknown;
  }
): ChatAttachmentMeta | null {
  const fromProposal =
    typeof proposal.attached_document_id === "string"
      ? proposal.attached_document_id.trim()
      : "";
  const fromInput =
    typeof input?.attached_document_id === "string"
      ? input.attached_document_id.trim()
      : "";
  const document_id = fromProposal || fromInput;
  if (!document_id) return null;
  const file_name =
    (typeof proposal.attached_file_name === "string" &&
      proposal.attached_file_name.trim()) ||
    (typeof input?.attached_file_name === "string" &&
      input.attached_file_name.trim()) ||
    "file";
  const url =
    (typeof proposal.attached_file_url === "string" &&
      proposal.attached_file_url.trim()) ||
    (typeof input?.attached_file_url === "string" &&
      input.attached_file_url.trim()) ||
    `/api/documents/${document_id}/download`;
  return { document_id, file_name, url };
}

async function persistProcessedPlan(opts: {
  admin: AdminClient;
  caseId: string;
  userId: string;
  sourceId: string;
  processed: ChatAttachmentProcessResult;
}): Promise<Record<string, unknown> | null> {
  const { processed } = opts;
  if (!processed.result) {
    return null;
  }
  const { intent, entities } = processed.result.interpretation;
  const tool_input = {
    ...mergeClassifyIntoToolInput(
      entities as unknown as Record<string, unknown>,
      processed.result,
      processed.classify,
      processed.attachment
    ),
    classify: processed.classify,
  };
  const { data: itemRow, error: insertItemError } = await opts.admin
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
      tool_input,
      child_ids: processed.result.child_ids,
      plan: withProposalIds(processed.result.plan),
      status: "pending",
    })
    .select(SAGE_ITEM_SELECT)
    .single();

  if (insertItemError) {
    console.error("[sage/messages] sage_items insert failed:", insertItemError);
    return null;
  }
  return (itemRow as Record<string, unknown> | null) ?? null;
}

type RevisableDraft = {
  itemId: string;
  summary: string;
  proposalType: "reply_coparent" | "ask_clarification" | "calendar_update";
  proposalIndex: number;
  currentDraft: string;
  sourceType: string | null;
  audience: "parent" | "coparent" | null;
  plan: Record<string, unknown>;
  proposals: Record<string, unknown>[];
};

function observeAttachmentTurn(input: {
  message: string;
  reply: string;
  reasoning?: string;
  proposals: {
    type?: string;
    calendar_intent?: "offer" | "update" | string;
    updatesExisting?: boolean;
    clarifies?: "calendar" | "expense" | "document" | "message" | string;
  }[];
  revisesDocument: boolean;
  documents: {
    id: string;
    title: string;
    description: string;
    category: string;
    fileName: string;
    childIds: string[];
    createdAt: string;
    visibility: string;
    uploadedBy: string;
  }[];
  children: { id: string; name: string }[];
  memory: ShadowMemory;
  viewerId: string;
  viewerRole: string | null;
  attachmentId: string;
  fileName: string;
  turnKey?: string | null;
}): void {
  scheduleShadowComparison({
    message: input.message,
    memory: input.memory,
    documents: input.documents,
    children: input.children,
    attachments: [{ id: input.attachmentId, fileName: input.fileName }],
    viewerId: input.viewerId,
    viewerRole: input.viewerRole,
    turnKey: input.turnKey,
    router: {
      handled: true,
      control: input.revisesDocument ? "revise_document" : "none",
      reply: input.reply,
      reasoning: input.reasoning,
      proposals: input.proposals,
    },
  });
}

type ShadowMemory = NonNullable<ConversationContext["memory"]> | null;

function isNoteOnlyPlan(plan: {
  status?: string;
  proposals?: { type?: string }[];
}): boolean {
  const proposals = plan.proposals ?? [];
  return proposals.length > 0 && proposals.every((p) => p.type === "note_only");
}

function withOpenDocument(
  conversation: ConversationContext | null,
  pending: DocumentProposalState | null
): ConversationContext | null {
  if (!pending) return conversation;
  const base: ConversationContext = conversation ?? {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: [],
  };
  const already = openDocumentStates(base.open_proposals).some(
    (doc) => doc.key === pending.key || (pending.documentId != null && doc.documentId === pending.documentId)
  );
  if (already) return base;
  return {
    ...base,
    open_proposals: [
      { type: "log_document", text: pending.description || pending.title, document: pending },
      ...base.open_proposals,
    ],
  };
}

async function previousFilingText(
  admin: AdminClient,
  sessionId: string,
  userId: string,
  currentContent: string
): Promise<string> {
  const { data } = await admin
    .from("sage_journal_messages")
    .select("content")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(6);
  const texts = ((data ?? []) as { content?: string | null }[])
    .map((row) => (row.content ?? "").trim())
    .filter(Boolean);
  const earlier = texts[0] === currentContent.trim() ? texts.slice(1) : texts;
  return earlier.find((text) => isDocumentFilingRequest(text.replace(/\n+Attached:[\s\S]*$/, ""))) ?? "";
}

async function rememberPendingDocument(
  admin: AdminClient,
  proposal: {
    attached_document_id?: string | null;
    title?: string | null;
    description?: string | null;
    category?: string | null;
    visibility?: string | null;
    document_child_id?: string | null;
    updatesExisting?: boolean | null;
  }
): Promise<void> {
  const visibility =
    proposal.visibility === "private" || proposal.visibility === "family" || proposal.visibility === "parents_only"
      ? proposal.visibility
      : "parents_only";
  await syncPendingDocumentMetadata(admin, {
    documentId: proposal.attached_document_id ?? null,
    title: proposal.title ?? "",
    description: proposal.description ?? "",
    category: proposal.category ?? "other",
    visibility,
    childId: proposal.document_child_id ?? null,
    updatesExisting: proposal.updatesExisting === true,
  });
}

function revisionReply(
  proposalType: "reply_coparent" | "ask_clarification" | "calendar_update"
): string {
  if (proposalType === "calendar_update") return "Updated that calendar suggestion.";
  return proposalType === "ask_clarification"
    ? "Added that to your question to Co-Parent."
    : "Added that to your reply to Co-Parent.";
}

function isClosedProposal(raw: unknown): boolean {
  return isInactiveProposal(raw);
}

function openCalendarProposal(raw: unknown): {
  draft?: string;
  revised_text?: string;
  date?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const proposal = raw as {
    type?: string;
    draft?: string;
    revised_text?: string;
    date?: string;
    executed?: boolean;
    approved?: boolean;
    status?: string;
  };
  if (proposal.type !== "calendar_update") return null;
  if (isClosedProposal(proposal)) return null;
  return {
    draft: proposal.draft,
    revised_text: proposal.revised_text,
    date: proposal.date,
  };
}

function openReplyProposal(raw: unknown): {
  type: "reply_coparent" | "ask_clarification";
  draft?: string;
  revised_text?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const proposal = raw as {
    type?: string;
    draft?: string;
    revised_text?: string;
    executed?: boolean;
    approved?: boolean;
    status?: string;
  };
  if (isClosedProposal(proposal)) return null;
  if (proposal.type !== "reply_coparent" && proposal.type !== "ask_clarification") {
    return null;
  }
  return {
    type: proposal.type,
    draft: proposal.draft,
    revised_text: proposal.revised_text,
  };
}

/** depends_on is free text. Unsatisfied means that text is set and unblocked is not. */
function unsatisfiedDependsOn(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const proposal = raw as { depends_on?: unknown; unblocked?: boolean };
  if (proposal.unblocked === true) return false;
  return typeof proposal.depends_on === "string" && proposal.depends_on.trim() !== "";
}

/**
 * The reply or clarification most recently added in this session that is still waiting.
 * Item status is ignored: approving one proposal marks the whole item in_progress.
 * blockedOnly limits that to a proposal whose depends_on is set and not yet unblocked.
 */
async function latestRevisableDraft(
  admin: AdminClient,
  sessionId: string,
  userId: string,
  opts?: { blockedOnly?: boolean; calendarOnly?: boolean; includeCalendar?: boolean }
): Promise<RevisableDraft | null> {
  const { data: journals, error: journalErr } = await admin
    .from("sage_journal_messages")
    .select("sage_item_id")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .not("sage_item_id", "is", null);
  if (journalErr || !journals) return null;

  const itemIds = [
    ...new Set(
      (journals as { sage_item_id?: string | null }[])
        .map((row) => row.sage_item_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  if (itemIds.length === 0) return null;

  const { data: items, error: itemErr } = await admin
    .from("sage_items")
    .select("id, summary, plan, created_at, source_type")
    .in("id", itemIds)
    .eq("visible_to", userId)
    .order("created_at", { ascending: false });
  if (itemErr || !items) return null;

  for (const row of items as {
    id?: string;
    summary?: string | null;
    source_type?: string | null;
    plan?: { proposals?: unknown[] } | null;
  }[]) {
    if (!row.id || !row.plan || typeof row.plan !== "object") continue;
    const proposals = Array.isArray(row.plan.proposals) ? row.plan.proposals : [];
    let chosen: RevisableDraft | null = null;
    proposals.forEach((raw, proposalIndex) => {
      const calendar = opts?.calendarOnly || opts?.includeCalendar
        ? openCalendarProposal(raw)
        : null;
      const reply = opts?.calendarOnly ? null : openReplyProposal(raw);
      const proposal = calendar ?? reply;
      if (!proposal) return;
      if (opts?.blockedOnly && !unsatisfiedDependsOn(raw)) return;
      const currentDraft =
        typeof proposal.revised_text === "string" && proposal.revised_text.trim()
          ? proposal.revised_text.trim()
          : typeof proposal.draft === "string"
            ? proposal.draft.trim()
            : "";
      const audienceRaw =
        raw && typeof raw === "object" ? (raw as { audience?: unknown }).audience : null;
      chosen = {
        itemId: row.id as string,
        summary: (row.summary ?? "").trim(),
        proposalType: calendar
          ? "calendar_update"
          : (proposal as { type: "reply_coparent" | "ask_clarification" }).type,
        proposalIndex,
        currentDraft,
        sourceType: typeof row.source_type === "string" ? row.source_type : null,
        audience: audienceRaw === "parent" || audienceRaw === "coparent" ? audienceRaw : null,
        plan: row.plan as Record<string, unknown>,
        proposals: proposals.map((p) =>
          p && typeof p === "object" ? { ...(p as Record<string, unknown>) } : {}
        ),
      };
    });
    if (chosen) return chosen;
  }
  return null;
}

async function sourcesForOutboundRedraft(opts: {
  caseId: string | null;
  timezone: string;
  iso: string | null;
  childIds: string[];
  conversation: ConversationContext | null;
  guidance: string;
  viewerId: string;
}): Promise<string> {
  const parts = [opts.guidance];
  if (opts.conversation) parts.push(formatConversationContext(opts.conversation));
  if (opts.caseId) {
    const ledger = await matchingLedgerText({
      caseId: opts.caseId,
      timezone: opts.timezone,
      iso: opts.iso,
      childIds: opts.childIds,
      corpus: [opts.guidance, opts.conversation?.event.subject ?? ""].filter(Boolean).join(" "),
      subject: opts.conversation?.event.subject ?? null,
      viewerId: opts.viewerId,
      viewerRole: "parent",
    });
    if (ledger.trim()) parts.push(ledger);
  }
  return parts.map((part) => part.trim()).filter(Boolean).join("\n");
}

async function revisePendingDraft(opts: {
  admin: AdminClient;
  userId: string;
  guidance: string;
  target: RevisableDraft;
  clearDependsOn?: boolean;
  sources?: string;
  event?: string | null;
  child?: string | null;
}): Promise<{ reply: string; item: { id: string; plan: Record<string, unknown> } } | null> {
  if (opts.target.proposalType === "calendar_update") return null;
  const { data: fresh } = await opts.admin
    .from("sage_items")
    .select("plan")
    .eq("id", opts.target.itemId)
    .eq("visible_to", opts.userId)
    .maybeSingle();
  const freshPlan =
    fresh &&
    typeof (fresh as { plan?: unknown }).plan === "object" &&
    (fresh as { plan?: unknown }).plan
      ? (fresh as { plan: { proposals?: unknown[] } }).plan
      : null;
  const live = Array.isArray(freshPlan?.proposals)
    ? freshPlan.proposals[opts.target.proposalIndex]
    : opts.target.proposals[opts.target.proposalIndex];
  if (isClosedProposal(live)) return null;
  const redraft = await redraftMessage({
    summary: opts.target.summary,
    proposalType: opts.target.proposalType,
    currentDraft: opts.target.currentDraft,
    guidance: opts.guidance,
    sourceType: opts.target.sourceType,
    audience: opts.target.audience,
    sources: opts.sources,
    event: opts.event,
    child: opts.child,
  });
  const revisedText = redraft?.trim() ?? "";
  if (!revisedText) return null;

  const proposals = (Array.isArray(freshPlan?.proposals) ? freshPlan.proposals : opts.target.proposals).map(
    (p) => (p && typeof p === "object" ? { ...(p as Record<string, unknown>) } : {})
  );
  const revised = reviseProposal(proposals, opts.target.proposalIndex, {
    revised_text: revisedText,
    ...(opts.clearDependsOn ? { depends_on: null, date_supplied: true } : {}),
  });
  if (!revised) return null;
  const updatedPlan = { ...(freshPlan ?? opts.target.plan), proposals: revised.proposals };
  const { data, error } = await opts.admin
    .from("sage_items")
    .update({ plan: updatedPlan })
    .eq("id", opts.target.itemId)
    .eq("visible_to", opts.userId)
    .select("id");
  if (error || !data?.length) {
    console.error(
      "[sage/messages] revise pending draft failed:",
      error?.message ?? "no row updated"
    );
    return null;
  }
  return {
    reply: revisionReply(opts.target.proposalType),
    item: { id: opts.target.itemId, plan: updatedPlan },
  };
}

/** The time answer completed the question, so the clarification is no longer an open item. */
async function closeAnsweredClarification(
  admin: AdminClient,
  userId: string,
  target: RevisableDraft
): Promise<void> {
  const { data: fresh } = await admin
    .from("sage_items")
    .select("plan")
    .eq("id", target.itemId)
    .eq("visible_to", userId)
    .maybeSingle();
  const plan =
    fresh && typeof (fresh as { plan?: unknown }).plan === "object" && (fresh as { plan?: unknown }).plan
      ? (fresh as { plan: { proposals?: unknown[] } }).plan
      : null;
  if (!plan || !Array.isArray(plan.proposals)) return;
  const proposals = plan.proposals.map((raw, index) => {
    if (index !== target.proposalIndex || !raw || typeof raw !== "object") return raw;
    return { ...(raw as Record<string, unknown>), status: "completed" };
  });
  const { error } = await admin
    .from("sage_items")
    .update({ plan: { ...plan, proposals } })
    .eq("id", target.itemId)
    .eq("visible_to", userId);
  if (error) console.error("[sage/messages] close clarification failed:", error.message);
}

async function reviseOpenCalendar(opts: {
  admin: AdminClient;
  userId: string;
  guidance: string;
  target: RevisableDraft;
  caseId: string;
  timezone: string;
  childIds: string[];
  resolvedIso: string | null;
  subject?: string | null;
  childName?: string | null;
  /** Reply and calendar text already stating facts. The new turn is guidance. */
  priorText?: string | null;
}): Promise<{ reply: string; item: { id: string; plan: Record<string, unknown> } } | null> {
  const { data: fresh } = await opts.admin
    .from("sage_items")
    .select("plan")
    .eq("id", opts.target.itemId)
    .eq("visible_to", opts.userId)
    .maybeSingle();
  const freshPlan =
    fresh &&
    typeof (fresh as { plan?: unknown }).plan === "object" &&
    (fresh as { plan?: unknown }).plan
      ? ((fresh as { plan: Record<string, unknown> }).plan)
      : opts.target.plan;
  const proposals = Array.isArray(freshPlan.proposals)
    ? (freshPlan.proposals as unknown[]).map((p) =>
        p && typeof p === "object" ? { ...(p as Record<string, unknown>) } : {}
      )
    : opts.target.proposals.map((p) => ({ ...p }));
  const proposalIndex = opts.target.proposalIndex;
  const kept = proposals[proposalIndex];
  if (!kept || kept.type !== "calendar_update" || isClosedProposal(kept)) return null;
  const storedDate = kept.date;
  const existingDate = typeof storedDate === "string" && storedDate.trim() ? storedDate.trim() : null;
  const iso = opts.resolvedIso ?? existingDate;
  const reconciled = await reconcileCalendarPlan(
    {
      status: "ready",
      proposals: [
        {
          type: "calendar_update",
          draft: opts.target.currentDraft,
          depends_on: null,
          requires_approval: true,
          ...(existingDate ? { date: existingDate } : {}),
        },
      ],
      reasoning: "",
    },
    {
      caseId: opts.caseId,
      timezone: opts.timezone,
      iso,
      childIds: opts.childIds,
      summary: opts.target.summary,
      corpus: opts.guidance,
      subject: opts.subject ?? null,
      childName: opts.childName ?? null,
      priorText: opts.priorText ?? opts.target.currentDraft,
    }
  );
  const next = reconciled.proposals[0];
  if (!next?.draft?.trim()) return null;
  const changes: Record<string, unknown> = {
    ...(next as unknown as Record<string, unknown>),
    draft: next.draft,
  };
  delete changes.id;
  delete changes.revised_text;
  delete changes.superseded_by;
  delete changes.supersedes;
  delete changes.replacement_item_id;
  delete changes.status;
  delete changes.executed;
  delete changes.executed_at;
  delete changes.approved;
  delete changes.approved_at;
  if (iso) {
    changes.date = iso;
    changes.depends_on = null;
    changes.date_supplied = true;
  }
  const revised = reviseProposal(proposals, proposalIndex, changes);
  if (!revised) return null;
  const updatedPlan = { ...freshPlan, proposals: revised.proposals };
  const { data, error } = await opts.admin
    .from("sage_items")
    .update({ plan: updatedPlan })
    .eq("id", opts.target.itemId)
    .eq("visible_to", opts.userId)
    .select("id");
  if (error || !data?.length) {
    console.error(
      "[sage/messages] revise calendar draft failed:",
      error?.message ?? "no row updated"
    );
    return null;
  }
  return {
    reply: revisionReply("calendar_update"),
    item: { id: opts.target.itemId, plan: updatedPlan },
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id") ?? undefined;

    const admin = getServiceRoleClient();
    const loadJournal = async (columns: string) => {
      let q = admin
        .from("sage_journal_messages")
        .select(columns)
        .eq("user_id", user.id);
      q = sessionId ? q.eq("session_id", sessionId) : q.is("session_id", null);
      return q.order("created_at", { ascending: true });
    };

    let { data, error } = await loadJournal(JOURNAL_SELECT);
    if (error && /source_message_id/i.test(error.message ?? "")) {
      ({ data, error } = await loadJournal(`${JOURNAL_SELECT_BASE}, sage_item_id`));
    }
    if (error && missingSageItemIdColumn(error)) {
      ({ data, error } = await loadJournal(JOURNAL_SELECT_BASE));
    }

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as unknown as SageMessageRow[];
    const itemIds = [
      ...new Set(
        rows
          .map((m) => m.sage_item_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];
    const userMessageIds = rows.filter((m) => m.role === "user").map((m) => m.id);

    const itemsById = new Map<string, unknown>();
    const itemsBySourceId = new Map<string, unknown>();
    if (itemIds.length > 0) {
      const { data: items } = await admin
        .from("sage_items")
        .select(`${SAGE_ITEM_SELECT}, source_type, source_id`)
        .in("id", itemIds)
        .eq("visible_to", user.id);
      for (const item of items ?? []) {
        const id = (item as { id?: string }).id;
        if (id) itemsById.set(id, item);
      }
    }
    if (userMessageIds.length > 0) {
      const { data: chatItems } = await admin
        .from("sage_items")
        .select(`${SAGE_ITEM_SELECT}, source_id`)
        .eq("source_type", "chat")
        .eq("visible_to", user.id)
        .in("source_id", userMessageIds);
      for (const item of chatItems ?? []) {
        const sourceId = (item as { source_id?: string }).source_id;
        if (sourceId) itemsBySourceId.set(sourceId, item);
      }
    }

    const linkedIdsByJournal = new Map<string, string[]>();
    for (const m of rows) {
      if (m.role !== "sage") continue;
      const linkedItem = m.sage_item_id ? itemsById.get(m.sage_item_id) : null;
      const itemRecord =
        linkedItem && typeof linkedItem === "object"
          ? (linkedItem as Record<string, unknown>)
          : null;
      linkedIdsByJournal.set(
        m.id,
        linkedIncomingMessageIds({
          sourceMessageId: m.source_message_id,
          itemSourceType: typeof itemRecord?.source_type === "string" ? itemRecord.source_type : null,
          itemSourceId: typeof itemRecord?.source_id === "string" ? itemRecord.source_id : null,
        })
      );
    }
    const sourceMessageIds = [
      ...new Set(rows.flatMap((m) => linkedIdsByJournal.get(m.id) ?? [])),
    ];
    const conversationByMessageId = new Map<string, string>();
    if (sourceMessageIds.length > 0) {
      const { data: sourceMessages } = await admin
        .from("messages")
        .select("id, conversation_id")
        .in("id", sourceMessageIds);
      for (const row of sourceMessages ?? []) {
        const id = (row as { id?: string }).id;
        const conversationId = (row as { conversation_id?: string | null }).conversation_id;
        if (id && conversationId) conversationByMessageId.set(id, conversationId);
      }
    }

    const messages: SageMessageRow[] = [];
    let lastUserId: string | null = null;
    for (const m of rows) {
      if (m.role === "user") lastUserId = m.id;
      const linked =
        (m.sage_item_id ? itemsById.get(m.sage_item_id) : null) ??
        (m.role === "sage" && lastUserId
          ? itemsBySourceId.get(lastUserId) ?? null
          : null);
      const explicitIds = linkedIdsByJournal.get(m.id) ?? [];
      const sourceConversationId = explicitIds
        .map((id) => conversationByMessageId.get(id))
        .find((id): id is string => typeof id === "string" && id.length > 0) ?? null;
      messages.push({
        ...m,
        sage_item: linked ?? null,
        source_message_ids: explicitIds,
        source_conversation_id: sourceConversationId,
      });
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const caseId = (membership?.case_id as string | undefined) ?? null;
    let children: { id: string; first_name: string }[] = [];
    if (caseId) {
      const { data: childrenData } = await admin
        .from("children")
        .select("id, first_name")
        .eq("case_id", caseId)
        .order("first_name");
      children = ((childrenData ?? []) as { id: string; first_name: string }[]).map(
        (c) => ({ id: c.id, first_name: c.first_name })
      );
    }

    await applyStoredIntake(admin, {
      userId: user.id,
      userEmail: user.email,
      caseId,
      viewerRole: (membership as { role?: string | null } | null)?.role ?? null,
      messages,
    });

    return NextResponse.json({ messages, case_id: caseId, children });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load Sage messages" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      content,
      session_id: bodySessionId,
      attachment: bodyAttachment,
      sage_item_id: bodySageItemId,
      proposal_index: bodyProposalIndex,
    } = body as {
      content?: string;
      session_id?: string;
      category?: string;
      attachment?: { document_id?: string; file_name?: string };
      sage_item_id?: unknown;
      proposal_index?: unknown;
    };
    const trimmed = (content ?? "").trim();
    const attachmentDocumentId =
      typeof bodyAttachment?.document_id === "string"
        ? bodyAttachment.document_id.trim()
        : "";
    const attachmentFileName =
      typeof bodyAttachment?.file_name === "string"
        ? bodyAttachment.file_name.trim()
        : "";
    const reentryItemId =
      typeof bodySageItemId === "string" ? bodySageItemId.trim() : "";
    const reentryProposalIndex =
      typeof bodyProposalIndex === "number" &&
      Number.isInteger(bodyProposalIndex) &&
      bodyProposalIndex >= 0
        ? bodyProposalIndex
        : null;
    const isReentry = reentryItemId.length > 0 && reentryProposalIndex != null;
    if (!trimmed && !attachmentDocumentId && !isReentry) {
      return NextResponse.json(
        { message: "Content is required." },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const now = new Date().toISOString();
    const sessionId =
      typeof bodySessionId === "string" && bodySessionId.length > 0
        ? bodySessionId
        : null;

    if (sessionId) {
      const { data: session } = await admin
        .from("sage_sessions")
        .select("id")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!session) {
        return NextResponse.json(
          { message: "Session not found." },
          { status: 404 }
        );
      }
    }

    const { data: membership, error: membershipError } = await admin
      .from("case_members")
      .select("case_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.error("[sage/messages] membership error:", membershipError);
      return NextResponse.json(
        { message: "Failed to load case." },
        { status: 500 }
      );
    }

    const caseId = (membership?.case_id as string | undefined) ?? null;

    const { data: profile } = await admin
      .from("users")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    const timezone = timezoneFromProfile(
      profile as { timezone?: string } | null
    );

    let classifiedAttachment: Awaited<
      ReturnType<typeof loadAndClassifyDocument>
    > | null = null;
    let reentry:
      | {
          forcedType: NonNullable<ReturnType<typeof forcedTypeFromProposal>>;
          classify: ClassifyPayload;
          attachment: ChatAttachmentMeta;
          caption: string;
        }
      | null = null;
    const attachmentConversation =
      sessionId && attachmentDocumentId
        ? await loadConversationContext(admin, sessionId, user.id, timezone)
        : null;
    const viewerRole = (membership as { role?: string | null } | null)?.role ?? "parent";
    const savedDocuments = caseId
      ? await loadVisibleDocuments(admin, caseId, { userId: user.id, role: viewerRole })
      : [];
    const latestOpenDocument = caseId
      ? await loadLatestOpenDocument(admin, caseId, user.id)
      : null;
    const attachmentContext = withOpenDocument(attachmentConversation, latestOpenDocument);

    if (isReentry) {
      if (!caseId) {
        return NextResponse.json(
          { message: "No case found." },
          { status: 403 }
        );
      }
      const { data: itemRow, error: itemError } = await admin
        .from("sage_items")
        .select("id, case_id, visible_to, tool_input, plan")
        .eq("id", reentryItemId)
        .eq("visible_to", user.id)
        .maybeSingle();
      if (itemError || !itemRow) {
        return NextResponse.json(
          { message: "Sage item not found." },
          { status: 404 }
        );
      }
      if ((itemRow as { case_id?: string }).case_id !== caseId) {
        return NextResponse.json(
          { message: "Sage item does not belong to this case." },
          { status: 403 }
        );
      }
      const plan = (itemRow as { plan?: { proposals?: unknown[] } }).plan;
      const proposals = Array.isArray(plan?.proposals) ? plan.proposals : [];
      const chosen = proposals[reentryProposalIndex];
      if (!chosen || typeof chosen !== "object") {
        return NextResponse.json(
          { message: "Proposal not found." },
          { status: 400 }
        );
      }
      const forcedType = forcedTypeFromProposal(
        chosen as { force_type?: unknown }
      );
      if (!forcedType) {
        return NextResponse.json(
          { message: "That choice cannot be forced." },
          { status: 400 }
        );
      }
      const input = toolInputRecord(
        (itemRow as { tool_input?: unknown }).tool_input
      );
      const classify = asClassifyPayload(input?.classify);
      const attachment = attachmentFromStored(
        input,
        chosen as {
          attached_document_id?: unknown;
          attached_file_name?: unknown;
          attached_file_url?: unknown;
        }
      );
      if (!classify || !attachment) {
        return NextResponse.json(
          { message: "Stored attachment classification is missing." },
          { status: 400 }
        );
      }
      const choiceDraft =
        typeof (chosen as { draft?: unknown }).draft === "string"
          ? (chosen as { draft: string }).draft.trim()
          : "";
      reentry = {
        forcedType,
        classify,
        attachment,
        caption: trimmed || choiceDraft,
      };
    } else if (attachmentDocumentId) {
      if (!caseId) {
        return NextResponse.json(
          { message: "No case found." },
          { status: 403 }
        );
      }
      const fileSuggestsDocument = /\b(eval(?:uation)?|report|record|therapy|medical|document)\b/i.test(
        attachmentFileName || ""
      );
      classifiedAttachment = await loadAndClassifyDocument({
        admin,
        userId: user.id,
        caseId,
        documentId: attachmentDocumentId,
        preserveMetadata:
          isDocumentFilingRequest(trimmed) ||
          Boolean(pendingDocument(attachmentConversation)) ||
          fileSuggestsDocument,
      });
      if ("error" in classifiedAttachment) {
        return NextResponse.json(
          { message: classifiedAttachment.error },
          { status: classifiedAttachment.status }
        );
      }
    }

    const fileLabel =
      attachmentFileName ||
      reentry?.attachment.file_name ||
      (classifiedAttachment && "attachment" in classifiedAttachment
        ? classifiedAttachment.attachment.file_name
        : "file");
    const userContent =
      attachmentDocumentId && !isReentry
        ? trimmed
          ? `${trimmed}\n\nAttached: ${fileLabel}`
          : `Attached: ${fileLabel}`
        : trimmed || reentry?.caption || fileLabel;

    const insertPayload = {
      user_id: user.id,
      role: "user" as const,
      content: userContent,
      created_at: now,
      ...(sessionId ? { session_id: sessionId } : {}),
    };

    const { data: userRow, error: insertUserError } = await admin
      .from("sage_journal_messages")
      .insert(insertPayload)
      .select(JOURNAL_SELECT_BASE)
      .single();

    if (insertUserError || !userRow) {
      return NextResponse.json(
        { message: insertUserError?.message ?? "Failed to save message." },
        { status: 500 }
      );
    }

    let sageContent = FALLBACK_REPLY;
    let sageItem: Record<string, unknown> | null = null;
    let revisedItem: { id: string; plan: Record<string, unknown> } | null = null;
    let revisionNarration: string | null = null;

    if (caseId) {
      try {
        if (reentry) {
          const coparents = await loadKnownCoparents(admin, caseId, user.id);
          const processed = await processChatAttachment({
            caseId,
            timezone,
            sourceId: (userRow as { id: string }).id,
            caption: reentry.caption,
            classify: reentry.classify,
            attachment: reentry.attachment,
            forcedType: reentry.forcedType,
            coparents,
          });
          if (processed.reply.trim()) sageContent = processed.reply;
          observeAttachmentTurn({
            message: reentry.caption,
            reply: processed.reply,
            reasoning: processed.result?.plan.reasoning,
            proposals: processed.result?.plan.proposals ?? [],
            revisesDocument: processed.kind === "document" && processed.revisesExisting === true,
            documents: savedDocuments,
            children: [],
            memory: attachmentContext?.memory ?? null,
            viewerId: user.id,
            viewerRole,
            attachmentId: reentry.attachment.document_id,
            fileName: reentry.attachment.file_name,
            turnKey: (userRow as { id: string }).id,
          });
          sageItem = await persistProcessedPlan({
            admin,
            caseId,
            userId: user.id,
            sourceId: (userRow as { id: string }).id,
            processed,
          });
        } else if (
          classifiedAttachment &&
          "classify" in classifiedAttachment &&
          !requestsDocumentAnalysis(trimmed, true)
        ) {
          const attachment = {
            ...classifiedAttachment.attachment,
            file_name:
              attachmentFileName || classifiedAttachment.attachment.file_name,
          };
          const calendarContext = await loadCalendarContext(admin, caseId, user.id);
          const priorText = sessionId
            ? await previousFilingText(admin, sessionId, user.id, userContent)
            : "";
          const coparents = await loadKnownCoparents(admin, caseId, user.id);
          const processed = await processChatAttachment({
            caseId,
            timezone,
            sourceId: (userRow as { id: string }).id,
            caption: trimmed,
            priorText,
            classify: classifiedAttachment.classify,
            attachment,
            children: calendarContext.children,
            pendingDocument: pendingDocument(attachmentContext) ?? latestOpenDocument,
            filedDocument: attachmentContext?.recent_document ?? null,
            coparents,
            today: new Date(),
          });
          if (processed.reply.trim()) sageContent = processed.reply;
          observeAttachmentTurn({
            message: trimmed,
            reply: processed.reply,
            reasoning: processed.result?.plan.reasoning,
            proposals: processed.result?.plan.proposals ?? [],
            revisesDocument: processed.kind === "document" && processed.revisesExisting === true,
            documents: savedDocuments,
            children: calendarContext.children,
            memory: attachmentContext?.memory ?? null,
            viewerId: user.id,
            viewerRole,
            attachmentId: attachment.document_id,
            fileName: attachment.file_name,
            turnKey: (userRow as { id: string }).id,
          });

          const openDocument = processed.kind === "document" && processed.revisesExisting;
          if (openDocument && sessionId) {
            const proposal = processed.result.plan.proposals[0];
            const applied = await applySessionControl(
              admin,
              sessionId,
              user.id,
              "revise_document",
              {
                date: "",
                label: proposal?.title ?? "Document",
                time: null,
                document: {
                  key: proposal?.key ?? "pending-document",
                  title: proposal?.title ?? "Document",
                  description: proposal?.description ?? "",
                  category: proposal?.category ?? "other",
                  visibility:
                    proposal?.visibility === "private" || proposal?.visibility === "family"
                      ? proposal.visibility
                      : "parents_only",
                  childId: proposal?.document_child_id ?? null,
                  childName: proposal?.document_child_name ?? null,
                  fileName: proposal?.attached_file_name ?? attachment.file_name,
                  documentId: proposal?.attached_document_id ?? attachment.document_id,
                  updatesExisting: proposal?.updatesExisting === true,
                },
              }
            );
            if (applied) revisedItem = applied;
          }
          if (!revisedItem && processed.kind === "document" && processed.revisesExisting) {
            const proposal = processed.result.plan.proposals[0];
            const applied = await reviseLatestOpenDocument(admin, caseId, user.id, {
              key: proposal?.key ?? "pending-document",
              title: proposal?.title ?? "Document",
              description: proposal?.description ?? "",
              category: proposal?.category ?? "other",
              visibility:
                proposal?.visibility === "private" || proposal?.visibility === "family"
                  ? proposal.visibility
                  : "parents_only",
              childId: proposal?.document_child_id ?? null,
              childName: proposal?.document_child_name ?? null,
              fileName: proposal?.attached_file_name ?? attachment.file_name,
              documentId: proposal?.attached_document_id ?? attachment.document_id,
              updatesExisting: proposal?.updatesExisting === true,
            });
            if (applied) revisedItem = applied;
          }
          const filingProposal = processed.result?.plan.proposals.find(
            (proposal) => proposal.type === "log_document"
          );
          if (filingProposal) await rememberPendingDocument(admin, filingProposal);
          if (!revisedItem && !(processed.kind === "document" && processed.revisesExisting)) {
            sageItem = await persistProcessedPlan({
              admin,
              caseId,
              userId: user.id,
              sourceId: (userRow as { id: string }).id,
              processed,
            });
          }
        } else {
          const conversation = withOpenDocument(
            sessionId
              ? await loadConversationContext(admin, sessionId, user.id, timezone)
              : null,
            latestOpenDocument
          );
          const coparents = await loadKnownCoparents(admin, caseId, user.id);
          const calendarContext = await loadCalendarContext(admin, caseId, user.id);
          const recentTurns = sessionId
            ? await loadSessionTurns(admin, sessionId, user.id, trimmed)
            : [];
          const analysis = await prepareAnalysisRead(admin, {
            message: trimmed,
            caseId,
            userId: user.id,
            role: viewerRole,
            sessionId: sessionId ?? null,
            currentDocumentId: attachmentDocumentId,
            recentTurns,
          });
          const { reply, result, control, revision } = await processChatMessage({
            message: trimmed,
            case_id: caseId,
            timezone,
            source_id: (userRow as { id: string }).id,
            conversation,
            coparents,
            children: calendarContext.children,
            events: calendarContext.events,
            documents: savedDocuments,
            viewerId: user.id,
            viewerRole,
            recentTurns,
            analysisFiles: analysis?.files,
            loadAnalysisBytes: analysis?.loadBytes,
          });
          if (reply.trim()) sageContent = reply;
          const createdDocument = result.plan.proposals.find((proposal) => proposal.type === "log_document");
          if (createdDocument) await rememberPendingDocument(admin, createdDocument);
          if (revision?.document) {
            await syncPendingDocumentMetadata(admin, {
              documentId: revision.document.documentId,
              title: revision.document.title,
              description: revision.document.description,
              category: revision.document.category,
              visibility: revision.document.visibility,
              childId: revision.document.childId,
              updatesExisting: revision.document.updatesExisting,
            });
          }

          let handledControl = false;
          if (
            sessionId &&
            (control === "cancel_message" || control === "revise_pending" || control === "revise_document")
          ) {
            const applied = await applySessionControl(
              admin,
              sessionId,
              user.id,
              control,
              revision
            );
            if (applied) {
              revisedItem = applied;
              handledControl = true;
            }
          }

          if (handledControl) {
            // The pending proposal was updated in place.
          } else {

          const noteOnly = isNoteOnlyPlan(result.plan);
          let foldedReply = false;
          let foldedCalendar = false;
          const turnHasCalendar = result.plan.proposals.some(
            (p) => p.type === "calendar_update"
          );
          const preserveOpenWork = shouldPreserveOpenWork(
            trimmed,
            conversation?.memory,
            result.plan.proposals
          );
          const childName =
            result.interpretation.entities.children.find((c) => c.name?.trim())?.name?.trim() ??
            (preserveOpenWork ? null : conversation?.event.child) ??
            null;
          const resolvedIso =
            result.resolved_dates.find((d) => d.status === "resolved" && d.iso)?.iso ?? null;
          const outboundSources = preserveOpenWork
            ? ""
            : await sourcesForOutboundRedraft({
                caseId,
                timezone,
                iso: conversation?.event.date ?? resolvedIso,
                childIds: result.child_ids,
                conversation,
                guidance: trimmed,
                viewerId: user.id,
              });
          let establishedReply = "";
          const eventName = preserveOpenWork
            ? result.event_subject ?? null
            : result.event_subject ?? conversation?.event.subject ?? null;
          if (!preserveOpenWork && sessionId && (noteOnly || turnHasCalendar)) {
            const openReply = await latestRevisableDraft(admin, sessionId, user.id);
            const answeredClarification =
              openReply?.proposalType === "ask_clarification" &&
              result.plan.proposals.some((proposal) =>
                proposal.type === "calendar_update" ||
                proposal.type === "log_expense" ||
                proposal.type === "log_document" ||
                proposal.type === "reply_coparent"
              );
            if (answeredClarification && openReply) {
              await closeAnsweredClarification(admin, user.id, openReply);
            } else if (openReply && openReply.proposalType !== "calendar_update") {
              establishedReply = openReply.currentDraft;
              const revisedReply = await revisePendingDraft({
                admin,
                userId: user.id,
                guidance: trimmed,
                target: openReply,
                clearDependsOn: unsatisfiedDependsOn(openReply.proposals[openReply.proposalIndex]),
                sources: outboundSources,
                event: eventName,
                child: childName,
              });
              if (revisedReply) {
                foldedReply = true;
                revisionNarration = revisedReply.reply;
                revisedItem = revisedReply.item;
              }
            }
          }
          if (!preserveOpenWork && sessionId && turnHasCalendar) {
            const openCalendar = await latestRevisableDraft(admin, sessionId, user.id, {
              calendarOnly: true,
            });
            if (openCalendar) {
              const revised = await reviseOpenCalendar({
                admin,
                userId: user.id,
                guidance: trimmed,
                target: openCalendar,
                caseId,
                timezone,
                childIds: result.child_ids,
                resolvedIso,
                subject: eventName,
                childName,
                priorText: [establishedReply, openCalendar.currentDraft].filter(Boolean).join("\n"),
              });
              if (revised) {
                foldedCalendar = true;
                const sameItem = !revisedItem || revisedItem.id === revised.item.id;
                if (sameItem) {
                  revisedItem = revised.item;
                  if (revisionNarration) sageContent = revisionNarration;
                  revisionNarration = null;
                }
              }
            }
          } else if (!preserveOpenWork && sessionId && noteOnly) {
            const openCalendar = await latestRevisableDraft(admin, sessionId, user.id, {
              calendarOnly: true,
            });
            if (openCalendar) {
              const revised = await reviseOpenCalendar({
                admin,
                userId: user.id,
                guidance: trimmed,
                target: openCalendar,
                caseId,
                timezone,
                childIds: result.child_ids,
                resolvedIso,
                subject: eventName,
                childName,
                priorText: [establishedReply, openCalendar.currentDraft].filter(Boolean).join("\n"),
              });
              if (revised) {
                foldedCalendar = true;
                const sameItem = !revisedItem || revisedItem.id === revised.item.id;
                if (sameItem) {
                  revisedItem = revised.item;
                  if (revisionNarration) sageContent = revisionNarration;
                  revisionNarration = null;
                }
              }
            }
          } else if (!preserveOpenWork && sessionId && !noteOnly) {
            const blockedDraft = await latestRevisableDraft(
              admin,
              sessionId,
              user.id,
              { blockedOnly: true }
            );
            if (blockedDraft) {
              const revised = await revisePendingDraft({
                admin,
                userId: user.id,
                guidance: trimmed,
                target: blockedDraft,
                clearDependsOn: true,
                sources: outboundSources,
                event: eventName,
                child: childName,
              });
              if (revised) {
                revisionNarration = revised.reply;
                revisedItem = revised.item;
              }
            }
          }

          if (foldedReply && noteOnly && !turnHasCalendar && revisionNarration) {
            sageContent = revisionNarration;
            revisionNarration = null;
          }

          if (!(noteOnly && foldedReply) && !foldedCalendar && result.plan.proposals.length > 0) {
            const { intent, entities } = result.interpretation;
            const { data: itemRow, error: insertItemError } = await admin
              .from("sage_items")
              .insert({
                case_id: caseId,
                source_type: "chat",
                source_id: (userRow as { id: string }).id,
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
                tool_input: {
                  ...entities,
                  resolved_dates: result.resolved_dates,
                  ...(result.event_subject ? { event_subject: result.event_subject } : {}),
                  ...(result.expense_category
                    ? { expense_category: result.expense_category }
                    : {}),
                },
                child_ids: result.child_ids,
                plan: withProposalIds(result.plan),
                status: "pending",
              })
              .select(SAGE_ITEM_SELECT)
              .single();

            if (insertItemError) {
              console.error(
                "[sage/messages] sage_items insert failed:",
                insertItemError
              );
            } else {
              sageItem = (itemRow as Record<string, unknown> | null) ?? null;
            }
          }
          }
        }
      } catch (e) {
        console.error("[sage/messages] engine failed:", e);
      }
    }

    if (!sageItem && revisedItem) {
      const { data: revisedRow } = await admin
        .from("sage_items")
        .select(SAGE_ITEM_SELECT)
        .eq("id", revisedItem.id)
        .eq("visible_to", user.id)
        .maybeSingle();
      if (revisedRow) sageItem = revisedRow as Record<string, unknown>;
    }

    const sageItemId =
      (sageItem && typeof sageItem.id === "string" ? sageItem.id : null) ??
      revisedItem?.id ??
      null;

    const sagePayload = {
      user_id: user.id,
      role: "sage" as const,
      content: sageContent,
      created_at: new Date().toISOString(),
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(sageItemId ? { sage_item_id: sageItemId } : {}),
    };
    let { data: sageRow, error: insertSageError } = await admin
      .from("sage_journal_messages")
      .insert(sagePayload)
      .select(sageItemId ? JOURNAL_SELECT : JOURNAL_SELECT_BASE)
      .single();

    if (insertSageError && sageItemId && missingSageItemIdColumn(insertSageError)) {
      const { sage_item_id: _omit, ...withoutItemId } = sagePayload;
      ({ data: sageRow, error: insertSageError } = await admin
        .from("sage_journal_messages")
        .insert(withoutItemId)
        .select(JOURNAL_SELECT_BASE)
        .single());
    }

    if (insertSageError || !sageRow) {
      return NextResponse.json(
        { message: insertSageError?.message ?? "Failed to save Sage response." },
        { status: 500 }
      );
    }

    if (sessionId) {
      await admin
        .from("sage_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("user_id", user.id);
    }

    const sageMessage: SageMessageRow = {
      ...(sageRow as unknown as SageMessageRow),
      sage_item: sageItem,
    };

    const primaryItemId =
      sageItem && typeof sageItem.id === "string" ? sageItem.id : null;
    let revisionMessage: SageMessageRow | null = null;
    if (
      revisionNarration &&
      revisedItem &&
      primaryItemId &&
      primaryItemId !== revisedItem.id
    ) {
      const { data: revisedRow } = await admin
        .from("sage_items")
        .select(SAGE_ITEM_SELECT)
        .eq("id", revisedItem.id)
        .eq("visible_to", user.id)
        .maybeSingle();
      const revisionItem = revisedRow
        ? { ...(revisedRow as Record<string, unknown>), plan: revisedItem.plan }
        : { id: revisedItem.id, plan: revisedItem.plan };
      const revisionPayload = {
        user_id: user.id,
        role: "sage" as const,
        content: revisionNarration,
        created_at: new Date(Date.now() + 1).toISOString(),
        ...(sessionId ? { session_id: sessionId } : {}),
        sage_item_id: revisedItem.id,
      };
      let { data: revisionRow, error: revisionErr } = await admin
        .from("sage_journal_messages")
        .insert(revisionPayload)
        .select(JOURNAL_SELECT)
        .single();
      if (revisionErr && missingSageItemIdColumn(revisionErr)) {
        const { sage_item_id: _omit, ...withoutItemId } = revisionPayload;
        ({ data: revisionRow, error: revisionErr } = await admin
          .from("sage_journal_messages")
          .insert(withoutItemId)
          .select(JOURNAL_SELECT_BASE)
          .single());
      }
      if (revisionErr || !revisionRow) {
        console.error(
          "[sage/messages] revision journal insert failed:",
          revisionErr?.message ?? "insert failed"
        );
      } else {
        revisionMessage = {
          ...(revisionRow as unknown as SageMessageRow),
          sage_item: revisionItem,
        };
      }
    }

    return NextResponse.json({
      user_message: userRow as SageMessageRow,
      sage_message: sageMessage,
      revision_message: revisionMessage,
      sage_item: sageItem,
      revised_item: revisedItem,
      case_id: caseId,
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Sage request failed" },
      { status: 500 }
    );
  }
}
