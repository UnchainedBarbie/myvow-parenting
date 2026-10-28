/**
 * Chat file attach: classify an already-stored documents-vault file and
 * either produce a log_expense or log_document plan (with attached_document_id)
 * or a placeholder reply for event (full flow comes later).
 */

import { runClassify, type ClassifyPayload } from "@/lib/ai-classify";
import { mapExpenseCategoryFromClassify } from "@/lib/expenses-share";
import { processChatMessage } from "@/lib/sage/chat";
import { buildObservationFromChat } from "@/lib/sage/observation-builder";
import type { ProcessObservationResult } from "@/lib/sage/process-observation";
import {
  attachedMessageDraft,
  attachedMessageRecipient,
  attachmentCanBeSent,
  attachmentInstruction,
  childNamedInInstruction,
  mentionsSeveralChildren,
} from "@/lib/sage/attachment-role";
import { answerDocumentQuestion, reasonWithModel } from "@/lib/sage/document-reason";
import { extractDocument } from "@/lib/documents/extract-document";
import type { KnownCoparent } from "@/lib/sage/chat-intent";
import {
  attachmentFilingText,
  attachmentRouteKind,
  attachmentShouldBeCalendar,
  interpretDocumentTurn,
  isDocumentEdit,
  isDocumentFilingRequest,
  type DocumentProposalState,
  type KnownDocumentChild,
} from "@/lib/sage/document-intent";
import { isLogExpenseProposal } from "@/lib/sage/proposal-kind";
import type { Proposal } from "@/lib/sage/planner";
import type { getServiceRoleClient } from "@/lib/supabase/server";

export type ChatAttachmentMeta = {
  document_id: string;
  file_name: string;
  url: string;
  visibility?: string | null;
};

export type ForcedAttachType = "expense" | "event" | "document";

export type ChatAttachmentProcessResult =
  | {
      kind: "expense";
      classify: ClassifyPayload;
      attachment: ChatAttachmentMeta;
      reply: string;
      result: ProcessObservationResult;
    }
    | {
      kind: "event";
      classify: ClassifyPayload;
      attachment: ChatAttachmentMeta;
      reply: string;
      result: null;
    }
  | {
      kind: "document";
      classify: ClassifyPayload;
      attachment: ChatAttachmentMeta;
      reply: string;
      result: ProcessObservationResult;
      /** Update the open document proposal instead of inserting another. */
      revisesExisting?: boolean;
    }
  | {
      kind: "disambiguate";
      classify: ClassifyPayload;
      attachment: ChatAttachmentMeta;
      reply: string;
      result: ProcessObservationResult;
    }
  | {
      kind: "message";
      classify: ClassifyPayload;
      attachment: ChatAttachmentMeta;
      reply: string;
      result: ProcessObservationResult;
    }
  | {
      kind: "explain";
      classify: ClassifyPayload;
      attachment: ChatAttachmentMeta;
      reply: string;
      result: null;
    };

type AdminClient = ReturnType<typeof getServiceRoleClient>;

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function buildExpenseCommandFromClassify(
  payload: ClassifyPayload,
  caption?: string
): string {
  const amountPart =
    typeof payload.amount === "number" &&
    Number.isFinite(payload.amount) &&
    payload.amount > 0
      ? ` a $${formatMoney(payload.amount)} expense`
      : " an expense";
  const child = payload.child_names.find((n) => n.trim());
  const who = child ? `${child.trim()}'s ` : "";
  const what =
    (payload.vendor && payload.vendor.trim()) ||
    (payload.title && payload.title.trim() ? payload.title.trim() : "") ||
    (payload.description && payload.description.trim()) ||
    "this receipt";
  const date =
    payload.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date.trim())
      ? ` on ${payload.date.trim()}`
      : "";
  const command = `You'd like to log${amountPart} for ${who}${what}${date}.`
    .replace(/\s+/g, " ")
    .trim();
  const cap = (caption ?? "").trim();
  return cap ? `${cap}\n\n${command}` : command;
}

export function buildDocumentCommandFromClassify(
  payload: ClassifyPayload,
  caption?: string
): string {
  const title =
    (payload.title && payload.title.trim()) ||
    (payload.description && payload.description.trim()) ||
    "this file";
  const command = `You'd like to file “${title}” in your documents.`;
  const cap = (caption ?? "").trim();
  return cap ? `${cap}\n\n${command}` : command;
}

export function stampAttachedDocumentOnPlan(
  plan: ProcessObservationResult["plan"],
  attachment: ChatAttachmentMeta
): ProcessObservationResult["plan"] {
  const proposals = (plan.proposals ?? []).map((p) =>
    isLogExpenseProposal(p.type)
      ? {
          ...p,
          attached_document_id: attachment.document_id,
          attached_file_name: attachment.file_name,
          attached_file_url: attachment.url,
        }
      : p
  );
  const hasExpense = proposals.some((p) => isLogExpenseProposal(p.type));
  if (!hasExpense) {
    proposals.unshift({
      type: "log_expense",
      draft: "You'd like to log this expense for your records.",
      depends_on: null,
      requires_approval: true,
      attached_document_id: attachment.document_id,
      attached_file_name: attachment.file_name,
      attached_file_url: attachment.url,
    });
  }
  return {
    ...plan,
    proposals,
    status: plan.status === "no_action" ? "ready" : plan.status,
  };
}

export async function loadAndClassifyDocument(opts: {
  admin: AdminClient;
  userId: string;
  caseId: string;
  documentId: string;
  /** Keep the title and description the parent already supplied. */
  preserveMetadata?: boolean;
}): Promise<
  | { classify: ClassifyPayload; attachment: ChatAttachmentMeta }
  | { error: string; status: number }
> {
  const { admin, userId, caseId, documentId } = opts;
  const { data: doc, error } = await admin
    .from("documents")
    .select("id, case_id, uploaded_by, storage_path, file_name, mime_type, visibility")
    .eq("id", documentId)
    .maybeSingle();
  if (error || !doc) {
    return { error: "Document not found.", status: 404 };
  }
  if (doc.case_id !== caseId) {
    return { error: "Document does not belong to this case.", status: 403 };
  }
  if (doc.uploaded_by !== userId) {
    return { error: "Document does not belong to you.", status: 403 };
  }

  const { data: blob, error: dlError } = await admin.storage
    .from("documents")
    .download(doc.storage_path as string);
  if (dlError || !blob) {
    return { error: "Could not read the stored file.", status: 500 };
  }

  const buf = Buffer.from(await blob.arrayBuffer());
  const mimeType = (doc.mime_type as string) || "application/octet-stream";
  const fileName = (doc.file_name as string) || "receipt";
  const classify = await runClassify(buf, mimeType, fileName);
  console.log("[chat-attach] type:", classify.type, "confidence:", classify.confidence);

  if (classify.confidence > 0 && !opts.preserveMetadata) {
    const updates: Record<string, unknown> = {};
    const title = classify.title?.trim();
    if (title) updates.title = title;
    const description = classify.description?.trim();
    if (description) updates.description = description;
    const category = classify.category?.trim();
    if (category) updates.category = category;
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await admin
        .from("documents")
        .update(updates)
        .eq("id", documentId);
      if (updateError) {
        console.warn(
          "[chat-attach] documents metadata update failed:",
          updateError.message
        );
      }
    }
  }

  return {
    classify,
    attachment: {
      document_id: doc.id as string,
      file_name: fileName,
      url: `/api/documents/${doc.id}/download`,
      visibility: (doc.visibility as string | null) ?? null,
    },
  };
}

export function isForcedAttachType(value: unknown): value is ForcedAttachType {
  return value === "expense" || value === "event" || value === "document";
}

export function forcedTypeFromProposal(p: {
  force_type?: unknown;
}): ForcedAttachType | null {
  return isForcedAttachType(p.force_type) ? p.force_type : null;
}

const DISAMBIGUATE_CHOICES: {
  forceType: ForcedAttachType;
  draft: string;
  proposalType: string;
}[] = [
  {
    forceType: "expense",
    draft: "Log as expense",
    proposalType: "force_expense",
  },
  {
    forceType: "event",
    draft: "Add to calendar",
    proposalType: "force_event",
  },
  {
    forceType: "document",
    draft: "File as document",
    proposalType: "force_document",
  },
];

export function buildForceChoiceProposals(
  attachment: ChatAttachmentMeta,
  exclude?: ForcedAttachType
) {
  const stamp = {
    attached_document_id: attachment.document_id,
    attached_file_name: attachment.file_name,
    attached_file_url: attachment.url,
  };
  return DISAMBIGUATE_CHOICES.filter((choice) => choice.forceType !== exclude).map(
    (choice) => ({
      type: choice.proposalType as Proposal["type"],
      draft: choice.draft,
      depends_on: null,
      requires_approval: true as const,
      force_type: choice.forceType,
      ...stamp,
    })
  );
}

function buildDisambiguateResult(
  attachment: ChatAttachmentMeta,
  sourceId?: string,
  opts?: { exclude?: ForcedAttachType; summary?: string }
): ProcessObservationResult {
  const summary = opts?.summary ?? "What would you like to log?";
  const observation = buildObservationFromChat(summary, {
    id: sourceId,
  });
  const proposals = buildForceChoiceProposals(attachment, opts?.exclude);
  return {
    observation,
    interpretation: {
      intent: {
        item_type: "needs_review",
        domain: "general",
        summary,
        evidence_excerpt: attachment.file_name || "file",
        tool_name: null,
        action_required: true,
        action_type: "review",
        urgency: "normal",
        confidence: 0,
      },
      entities: {
        children: [],
        people: [],
        dates: [],
        amounts: [],
        merchants: [],
        providers: [],
        documents: [{ name: attachment.file_name }],
      },
      reasoning: {
        signals: opts?.exclude
          ? [`document proposal declined — offer remaining types`]
          : ["classify.confidence === 0"],
      },
    },
    child_ids: [],
    unresolved_children: [],
    resolved_dates: [],
    plan: {
      status: "ready",
      reasoning: opts?.exclude
        ? "document proposal declined — ask how else to log the attachment"
        : "classify.confidence === 0 — ask how to log the attachment",
      proposals: proposals as ProcessObservationResult["plan"]["proposals"],
    },
  };
}

export function buildAlternateTypeResult(
  attachment: ChatAttachmentMeta,
  exclude: ForcedAttachType,
  sourceId?: string
): ProcessObservationResult {
  return buildDisambiguateResult(attachment, sourceId, {
    exclude,
    summary: "Would you like to log this as an expense or add it to the calendar instead?",
  });
}

function buildDocumentProposalResult(input: {
  classify: ClassifyPayload;
  attachment: ChatAttachmentMeta;
  caption: string;
  sourceId?: string;
  filing?: DocumentProposalState | null;
}): ProcessObservationResult {
  const filing = input.filing;
  const title =
    filing?.title?.trim() ||
    (input.classify.title && input.classify.title.trim()) ||
    input.attachment.file_name ||
    "Untitled document";
  const description = filing?.description?.trim() || input.classify.description?.trim() || "";
  const category = filing?.category?.trim() || input.classify.category?.trim() || "other";
  const draft = description
    ? `File “${title}”. ${description}`
    : `File “${title}” in your documents.`;
  const summary = input.caption.trim() || draft;
  const observation = buildObservationFromChat(summary, { id: input.sourceId });
  const proposal: Proposal = {
    type: "log_document",
    draft,
    depends_on: null,
    requires_approval: true,
    attached_document_id: input.attachment.document_id,
    attached_file_name: filing?.fileName || input.attachment.file_name,
    attached_file_url: input.attachment.url,
    title,
    description,
    category,
    visibility: filing?.visibility ?? "parents_only",
    key: filing?.key ?? "pending-document",
    document_child_id: filing?.childId ?? null,
    document_child_name: filing?.childName ?? null,
    updatesExisting: filing?.updatesExisting === true,
  };
  return {
    observation,
    interpretation: {
      intent: {
        item_type: "document_summary",
        domain: "general",
        summary: draft,
        evidence_excerpt: input.attachment.file_name || title,
        tool_name: "document",
        action_required: true,
        action_type: "review",
        urgency: "normal",
        confidence: input.classify.confidence,
      },
      entities: {
        children: filing?.childName ? [{ name: filing.childName, confidence: 0.9 }] : [],
        people: [],
        dates: [],
        amounts: [],
        merchants: [],
        providers: [],
        documents: [{ name: input.attachment.file_name || title }],
      },
      reasoning: { signals: ["document filing"] },
    },
    child_ids: filing?.childId ? [filing.childId] : [],
    unresolved_children: [],
    resolved_dates: [],
    plan: {
      status: "ready",
      reasoning: "A document filing stays a document. It is not a calendar event.",
      proposals: [proposal],
    },
  };
}

function withoutUnnamedChild(
  filing: DocumentProposalState | null,
  caption: string,
  children: KnownDocumentChild[]
): DocumentProposalState | null {
  if (!filing || !mentionsSeveralChildren(caption)) return filing;
  if (childNamedInInstruction(caption, children)) return filing;
  const title = filing.title.includes(" — ") ? filing.title.split(" — ").slice(1).join(" — ") : filing.title;
  return {
    ...filing,
    title,
    childId: null,
    childName: null,
    description: filing.description.replace(/\s+for\s+[A-Z][a-z]+\.?$/, "").trim() || filing.description,
  };
}

function attachmentFields(attachment: ChatAttachmentMeta): Pick<
  Proposal,
  "attached_document_id" | "attached_file_name" | "attached_file_url"
> {
  return {
    attached_document_id: attachment.document_id,
    attached_file_name: attachment.file_name,
    attached_file_url: attachment.url,
  };
}

function explainAttachment(
  opts: Parameters<typeof processChatAttachment>[0],
  reply: string
): ChatAttachmentProcessResult {
  return {
    kind: "explain",
    classify: opts.classify,
    attachment: opts.attachment,
    reply,
    result: null,
  };
}

async function directedAttachmentResult(
  opts: Parameters<typeof processChatAttachment>[0],
  instruction: "summarize" | "message" | "save_and_message"
): Promise<ChatAttachmentProcessResult | null> {
  const fileName = opts.attachment.file_name;
  if (instruction === "summarize") {
    if (opts.bytes && opts.bytes.length > 0) {
      const extracted = await extractDocument(opts.bytes, fileName);
      const reply = await answerDocumentQuestion({
        question: opts.caption,
        fileName,
        extracted,
        reason: reasonWithModel,
      });
      return explainAttachment(opts, reply);
    }
    return explainAttachment(opts, `${fileName} is attached. I haven't read its contents.`);
  }
  if (!attachmentCanBeSent(fileName)) {
    return explainAttachment(
      opts,
      `I can't attach ${fileName} to a message. I can only send PDF, image, Word, Excel, CSV, and text files.`
    );
  }
  if ((opts.attachment.visibility ?? "").toLowerCase() === "private") {
    return explainAttachment(
      opts,
      "This file is private, so your co-parent can't open it. I haven't sent anything."
    );
  }
  const recipient = attachedMessageRecipient(opts.caption, opts.coparents ?? []);
  const proposals: Proposal[] = [];
  if (instruction === "save_and_message") {
    const saved = buildDocumentProposalResult({
      classify: { ...opts.classify, contentsRead: false, description: "" },
      attachment: opts.attachment,
      caption: opts.caption,
      sourceId: opts.sourceId,
      filing: null,
    });
    const document = saved.plan.proposals[0];
    if (document) proposals.push({ ...document, requires_approval: true });
  }
  if (recipient.kind === "clarify") {
    proposals.push({
      type: "ask_clarification",
      draft: recipient.reply,
      depends_on: null,
      requires_approval: true,
      audience: "parent",
      clarifies: "message",
      ...attachmentFields(opts.attachment),
    });
  } else {
    const email = recipient.coparent.email?.trim() || "";
    if (!email) {
      proposals.push({
        type: "ask_clarification",
        draft: `I don't have a delivery email for ${recipient.coparent.name}. Add one and I can prepare the message.`,
        depends_on: null,
        requires_approval: true,
        audience: "parent",
        clarifies: "message",
        recipient_name: recipient.coparent.name,
        ...attachmentFields(opts.attachment),
      });
    } else {
      proposals.push({
        type: "reply_coparent",
        draft: attachedMessageDraft(opts.caption, fileName),
        depends_on: null,
        requires_approval: true,
        recipient_name: recipient.coparent.name,
        recipient_email: email,
        subject: null,
        draft_origin: "sage_wording",
        ...attachmentFields(opts.attachment),
      });
    }
  }
  const message = proposals.find((proposal) => proposal.type === "reply_coparent");
  const saved = proposals.some((proposal) => proposal.type === "log_document");
  const reply = message?.recipient_name
    ? saved
      ? `I prepared a message to ${message.recipient_name} with ${fileName} attached, and a separate save in Documents. Nothing is sent or filed until you approve each one.`
      : `Here is a message to ${message.recipient_name} with ${fileName} attached. Nothing is sent until you choose Send.`
    : proposals.find((proposal) => proposal.type === "ask_clarification")?.draft ??
      "Who should I send that to?";
  const observation = buildObservationFromChat(opts.caption.trim() || reply, { id: opts.sourceId });
  return {
    kind: "message",
    classify: opts.classify,
    attachment: opts.attachment,
    reply,
    result: {
      observation,
      interpretation: {
        intent: {
          item_type: "message",
          domain: "message",
          summary: reply,
          evidence_excerpt: fileName,
          tool_name: "messaging",
          action_required: true,
          action_type: "review",
          urgency: "normal",
          confidence: opts.classify.confidence,
        },
        entities: {
          children: [],
          people: message?.recipient_name ? [{ name: message.recipient_name, confidence: 0.9 }] : [],
          dates: [],
          amounts: [],
          merchants: [],
          providers: [],
          documents: [{ name: fileName }],
        },
        reasoning: { signals: ["co-parent message with attachment"] },
      },
      child_ids: [],
      unresolved_children: [],
      resolved_dates: [],
      plan: {
        status: proposals.every((proposal) => proposal.type === "ask_clarification")
          ? "awaiting_clarification"
          : "ready",
        reasoning: "The attachment follows the parent's instruction. Nothing is sent or filed until approved.",
        proposals,
      },
    },
  };
}

export async function processChatAttachment(opts: {
  caseId: string;
  timezone: string;
  sourceId?: string;
  caption: string;
  /** Filing sentence from an earlier turn, used when this message is only the file. */
  priorText?: string | null;
  classify: ClassifyPayload;
  attachment: ChatAttachmentMeta;
  /** When set, skip the confidence === 0 ask and follow this type's existing path. */
  forcedType?: ForcedAttachType;
  children?: KnownDocumentChild[];
  pendingDocument?: DocumentProposalState | null;
  filedDocument?: DocumentProposalState | null;
  coparents?: KnownCoparent[];
  today?: Date;
  /** Present only when the parent asked Sage to read this file. */
  bytes?: Buffer | null;
}): Promise<ChatAttachmentProcessResult> {
  const instruction = attachmentInstruction(opts.caption);
  if (
    opts.forcedType == null &&
    (instruction === "summarize" || instruction === "message" || instruction === "save_and_message")
  ) {
    const directed = await directedAttachmentResult(opts, instruction);
    if (directed) return directed;
  }
  const pendingDocument =
    instruction === "save" && isDocumentFilingRequest(opts.caption) && !isDocumentEdit(opts.caption)
      ? null
      : opts.pendingDocument;
  let routed =
    opts.forcedType ??
    attachmentRouteKind({
      caption: opts.caption,
      fileName: opts.attachment.file_name,
      classifyType: opts.classify.type,
      pendingDocument: Boolean(pendingDocument),
    });
  const unread = opts.classify.contentsRead === false;
  if (unread && opts.forcedType == null) {
    const caption = opts.caption.trim();
    const explicit =
      (attachmentShouldBeCalendar(caption) && !isDocumentFilingRequest(caption)) ||
      /\b(expense|reimburse|reimbursement)\b/i.test(caption);
    if (!explicit) routed = "document";
  }
  if (opts.forcedType == null && opts.classify.confidence === 0 && routed !== "document" && !unread) {
    return {
      kind: "disambiguate",
      classify: opts.classify,
      attachment: opts.attachment,
      reply: "What would you like to log?",
      result: buildDisambiguateResult(opts.attachment, opts.sourceId),
    };
  }
  if (routed === "event") {
    return {
      kind: "event",
      classify: opts.classify,
      attachment: opts.attachment,
      reply: "I can log this as a calendar event.",
      result: null,
    };
  }
  if (routed === "document") {
    const text = attachmentFilingText(opts.caption, opts.priorText, Boolean(opts.pendingDocument));
    const interpreted = interpretDocumentTurn({
      text,
      fileName: opts.attachment.file_name,
      children: opts.children ?? [],
      pending: pendingDocument ?? null,
      filed: opts.filedDocument ?? null,
      today: opts.today ?? new Date(),
      timezone: opts.timezone,
      incomingDocumentId: opts.attachment.document_id,
    });
    const filing = withoutUnnamedChild(
      interpreted.action === "create" || interpreted.action === "revise" ? interpreted.proposal : null,
      opts.caption,
      opts.children ?? []
    );
    const result = buildDocumentProposalResult({
      classify: opts.classify,
      attachment: opts.attachment,
      caption: opts.caption,
      sourceId: opts.sourceId,
      filing,
    });
    const approvalReply =
      interpreted.action === "create" || interpreted.action === "revise"
        ? interpreted.reply
        : buildDocumentCommandFromClassify(opts.classify, opts.caption);
    const reply =
      unread && interpreted.action !== "revise" && interpreted.action !== "ask" && interpreted.action !== "error"
        ? "I can save this file in Documents once you approve it. I haven't read its contents."
        : approvalReply;
    return {
      kind: "document",
      classify: opts.classify,
      attachment: opts.attachment,
      reply,
      result,
      revisesExisting: interpreted.action === "revise",
    };
  }

  const message = buildExpenseCommandFromClassify(opts.classify, opts.caption);
  const { reply, result } = await processChatMessage({
    message,
    case_id: opts.caseId,
    timezone: opts.timezone,
    source_id: opts.sourceId,
    shadow: false,
  });
  const stampedPlan = stampAttachedDocumentOnPlan(result.plan, opts.attachment);
  const mappedCategory = mapExpenseCategoryFromClassify(opts.classify.category);
  const summary = result.interpretation.intent.summary?.trim() || "";
  const userVoice = /^you'd like to/i.test(summary)
    ? summary
    : buildExpenseCommandFromClassify(opts.classify);
  const expenseDraft = stampedPlan.proposals.find((p) =>
    isLogExpenseProposal(p.type)
  )?.draft;
  const sageReply = userVoice || expenseDraft || reply || "I can log that.";

  return {
    kind: "expense",
    classify: opts.classify,
    attachment: opts.attachment,
    reply: sageReply,
    result: {
      ...result,
      plan: stampedPlan,
      expense_category: mappedCategory || result.expense_category,
    },
  };
}

export function mergeClassifyIntoToolInput(
  entities: Record<string, unknown>,
  result: ProcessObservationResult,
  classify: ClassifyPayload,
  attachment: ChatAttachmentMeta
): Record<string, unknown> {
  const mappedCategory = mapExpenseCategoryFromClassify(classify.category);
  const merchants = Array.isArray(entities.merchants)
    ? (entities.merchants as unknown[])
    : [];
  const vendor = classify.vendor?.trim();
  const amounts = Array.isArray(entities.amounts)
    ? [...(entities.amounts as unknown[])]
    : [];
  if (
    typeof classify.amount === "number" &&
    Number.isFinite(classify.amount) &&
    classify.amount > 0
  ) {
    const has = amounts.some(
      (a) =>
        a &&
        typeof a === "object" &&
        Number((a as { value?: unknown }).value) === classify.amount
    );
    if (!has) amounts.unshift({ value: classify.amount, currency: "USD" });
  }
  let resolved_dates = result.resolved_dates;
  if (classify.date && /^\d{4}-\d{2}-\d{2}$/.test(classify.date)) {
    const hasIso = resolved_dates.some(
      (d) => d.status === "resolved" && d.iso === classify.date
    );
    if (!hasIso) {
      resolved_dates = [
        {
          raw: classify.date,
          status: "resolved",
          iso: classify.date,
          reason: "extracted from receipt",
        },
        ...resolved_dates,
      ];
    }
  }
  return {
    ...entities,
    resolved_dates,
    amounts,
    merchants:
      vendor && merchants.length === 0 ? [{ name: vendor }] : merchants,
    expense_category: mappedCategory || result.expense_category,
    ...(typeof classify.amount === "number" && Number.isFinite(classify.amount)
      ? { amount: classify.amount }
      : {}),
    attached_document_id: attachment.document_id,
    attached_file_name: attachment.file_name,
    attached_file_url: attachment.url,
  };
}
