/**
 * Chat file attach: classify an already-stored documents-vault file and
 * either produce a log_expense plan (with attached_document_id) or a
 * placeholder reply for event/document (full flows come later).
 */

import { runClassify, type ClassifyPayload } from "@/lib/ai-classify";
import { mapExpenseCategoryFromClassify } from "@/lib/expenses-share";
import { processChatMessage } from "@/lib/sage/chat";
import type { ProcessObservationResult } from "@/lib/sage/process-observation";
import { isLogExpenseProposal } from "@/lib/sage/proposal-kind";
import type { getServiceRoleClient } from "@/lib/supabase/server";

export type ChatAttachmentMeta = {
  document_id: string;
  file_name: string;
  url: string;
};

export type ChatAttachmentProcessResult =
  | {
      kind: "expense";
      classify: ClassifyPayload;
      attachment: ChatAttachmentMeta;
      reply: string;
      result: ProcessObservationResult;
    }
  | {
      kind: "event" | "document";
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
}): Promise<
  | { classify: ClassifyPayload; attachment: ChatAttachmentMeta }
  | { error: string; status: number }
> {
  const { admin, userId, caseId, documentId } = opts;
  const { data: doc, error } = await admin
    .from("documents")
    .select("id, case_id, uploaded_by, storage_path, file_name, mime_type")
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
  console.log("[chat-attach] classify result:", JSON.stringify(classify));
  return {
    classify,
    attachment: {
      document_id: doc.id as string,
      file_name: fileName,
      url: `/api/documents/${doc.id}/download`,
    },
  };
}

export async function processChatAttachment(opts: {
  caseId: string;
  timezone: string;
  sourceId?: string;
  caption: string;
  classify: ClassifyPayload;
  attachment: ChatAttachmentMeta;
}): Promise<ChatAttachmentProcessResult> {
  const type = opts.classify.type;
  if (type === "event") {
    return {
      kind: "event",
      classify: opts.classify,
      attachment: opts.attachment,
      reply: "I can log this as a calendar event.",
      result: null,
    };
  }
  if (type !== "expense") {
    return {
      kind: "document",
      classify: opts.classify,
      attachment: opts.attachment,
      reply: "I can log this as a document.",
      result: null,
    };
  }

  const message = buildExpenseCommandFromClassify(opts.classify, opts.caption);
  const { reply, result } = await processChatMessage({
    message,
    case_id: opts.caseId,
    timezone: opts.timezone,
    source_id: opts.sourceId,
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
