import {
  displayDraft,
  isBlocked,
  isCalendarUpdateProposal,
  isLogDocumentProposal,
  isLogExpenseProposal,
  proposalTypeLabel,
} from "@/components/sage/proposal-helpers";
import type { SageItem, SageProposal } from "@/components/sage/proposal-types";
import { isParentClarification } from "@/lib/sage/proposal-kind";
import { isResolvedProposal } from "@/lib/sage/proposal-resolution";

/**
 * Open items are a read of sage_items.plan.proposals — the same JSON chat and
 * the inbox actions already update. There is no second task table.
 *
 * save_error / status "save_failed" live on that proposal. A failed save used
 * to look identical to "not started", so a retry could insert another expense
 * or event. The marker, plus any result_* id already created, is the smallest
 * durable state that lets Retry save call execute again instead of inserting.
 */

export type OpenItemType = "expense" | "calendar_event" | "document" | "message";

export type OpenItemKind =
  | "awaiting_confirmation"
  | "missing_information"
  | "filing_decision"
  | "message_draft"
  | "save_failed";

export type OpenItemRetry = {
  eventId?: string;
  expenseId?: string;
  documentId?: string;
};

export type OpenItemDraft = {
  key: string;
  sageItemId: string;
  proposalIndex: number | null;
  type: OpenItemType;
  kind: OpenItemKind;
  title: string;
  explanation: string;
  actionLabel: string;
  createdAt: string;
  retry: OpenItemRetry | null;
};

export type OpenItemView = OpenItemDraft & {
  href: string | null;
  item: SageItem | null;
};

export type OpenItemSource = {
  id: string;
  created_at: string;
  status?: string | null;
  source_type?: string | null;
  summary?: string | null;
  item_type?: string | null;
  domain?: string | null;
  evidence_excerpt?: string | null;
  action_required?: boolean | null;
  plan?: { proposals?: unknown[] } | null;
};

const INITIAL_OPEN_LIMIT = 4;

export function openItemsPreviewLimit(): number {
  return INITIAL_OPEN_LIMIT;
}

export const SAGE_PROPOSALS_CHANGED_EVENT = "sage-proposals-changed";

export function notifySageProposalsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SAGE_PROPOSALS_CHANGED_EVENT));
}

export function openItemHref(
  sessionId: string | null | undefined,
  sageItemId: string,
  proposalIndex: number | null
): string | null {
  if (!sessionId) return null;
  const params = new URLSearchParams({ item: sageItemId });
  if (proposalIndex != null && proposalIndex >= 0) {
    params.set("proposal", String(proposalIndex));
  }
  return `/sage/${sessionId}?${params.toString()}`;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function asProposal(raw: unknown): SageProposal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const proposal = raw as SageProposal;
  if (typeof proposal.type !== "string" || !proposal.type.trim()) return null;
  return proposal;
}

function proposalStatus(proposal: SageProposal): string {
  return (proposal.status ?? "").trim().toLowerCase();
}

function isSaveFailed(proposal: SageProposal): boolean {
  if (proposalStatus(proposal) === "save_failed") return true;
  return typeof proposal.save_error === "string" && proposal.save_error.trim().length > 0;
}

function itemClosed(item: OpenItemSource): boolean {
  const status = (item.status ?? "").trim().toLowerCase();
  return status === "archived" || status === "dismissed";
}

/**
 * A proposal chat would no longer offer as unfinished work.
 * An approved co-parent draft stays open until that proposal records a sent reply.
 */
export function isClosedOpenItemProposal(proposal: SageProposal): boolean {
  return isResolvedProposal(proposal);
}

function forceType(proposal: SageProposal): string {
  const raw = (proposal as SageProposal & { force_type?: unknown }).force_type;
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

export function openItemType(proposal: SageProposal): OpenItemType | null {
  const forced = forceType(proposal);
  if (
    isLogExpenseProposal(proposal.type) ||
    proposal.type === "force_expense" ||
    forced === "expense"
  ) {
    return "expense";
  }
  if (
    isCalendarUpdateProposal(proposal.type) ||
    proposal.type === "force_event" ||
    forced === "event"
  ) {
    return "calendar_event";
  }
  if (
    isLogDocumentProposal(proposal.type) ||
    proposal.type === "force_document" ||
    forced === "document"
  ) {
    return "document";
  }
  if (proposal.type === "reply_coparent" || proposal.type === "ask_clarification") {
    return "message";
  }
  return null;
}

function kindFor(proposal: SageProposal, type: OpenItemType): OpenItemKind {
  if (isSaveFailed(proposal)) return "save_failed";
  if (isBlocked(proposal)) return "missing_information";
  if (type === "document") return "filing_decision";
  if (type === "message" && proposal.audience === "parent") return "missing_information";
  if (type === "message") return "message_draft";
  return "awaiting_confirmation";
}

function actionLabel(kind: OpenItemKind, type: OpenItemType, proposal: SageProposal): string {
  if (kind === "save_failed") return "Retry save";
  if (type === "expense") return "Review expense";
  if (type === "calendar_event") return "Confirm event";
  if (type === "document") return "Review document";
  if (proposal.type === "ask_clarification" && proposal.audience === "parent") {
    return "Add details";
  }
  if (type === "message") return "Review draft";
  return "Add details";
}

function titleFor(item: OpenItemSource, proposal: SageProposal): string {
  const titled = typeof proposal.title === "string" ? proposal.title.trim() : "";
  if (titled) return clip(titled, 90);
  const draft = displayDraft(proposal, false);
  if (draft) return clip(draft, 90);
  const summary = (item.summary ?? "").trim();
  if (summary) return clip(summary, 90);
  return proposalTypeLabel(proposal.type, proposal);
}

function explanationFor(
  item: OpenItemSource,
  proposal: SageProposal,
  kind: OpenItemKind
): string {
  if (kind === "save_failed") {
    const err = typeof proposal.save_error === "string" ? proposal.save_error.trim() : "";
    return (
      err ||
      "This didn't save. Retry finishes the same record when one was already created."
    );
  }
  if (kind === "missing_information") {
    const need =
      typeof proposal.depends_on === "string" ? proposal.depends_on.trim() : "";
    if (need) return clip(`Still needs: ${need}`, 180);
    const draft = displayDraft(proposal, false);
    if (draft) return clip(draft, 180);
    return "Sage still needs a detail before this can be saved.";
  }
  if (kind === "message_draft") {
    if (proposal.approved === true) {
      return "This draft is approved. It has not been sent.";
    }
    return "Review this draft. Nothing is sent until you approve it.";
  }
  if (kind === "filing_decision") {
    return "Choose whether to file this.";
  }
  const draft = displayDraft(proposal, false);
  if (draft) return clip(draft, 180);
  const summary = (item.summary ?? "").trim();
  if (summary) return clip(summary, 180);
  return "This still needs your confirmation.";
}

function retryFor(proposal: SageProposal, kind: OpenItemKind): OpenItemRetry | null {
  if (kind !== "save_failed") return null;
  const eventId =
    typeof proposal.result_event_id === "string" ? proposal.result_event_id.trim() : "";
  const expenseId =
    typeof proposal.result_expense_id === "string"
      ? proposal.result_expense_id.trim()
      : "";
  const documentId =
    typeof proposal.result_document_id === "string"
      ? proposal.result_document_id.trim()
      : "";
  if (!eventId && !expenseId && !documentId) return null;
  return {
    ...(eventId ? { eventId } : {}),
    ...(expenseId ? { expenseId } : {}),
    ...(documentId ? { documentId } : {}),
  };
}

function domainType(item: OpenItemSource): OpenItemType {
  const domain = (item.domain ?? "").toLowerCase();
  const itemType = (item.item_type ?? "").toLowerCase();
  if (domain === "expense" || itemType === "expense") return "expense";
  if (
    domain === "calendar" ||
    itemType === "schedule_change" ||
    itemType === "calendar_update" ||
    itemType === "event"
  ) {
    return "calendar_event";
  }
  if (domain === "message" || itemType === "message" || itemType === "reply") {
    return "message";
  }
  return "document";
}

function fallbackAction(type: OpenItemType): string {
  if (type === "expense") return "Review expense";
  if (type === "calendar_event") return "Confirm event";
  if (type === "message") return "Review draft";
  return "Review document";
}

/**
 * One row per unresolved proposal. Closed, declined, and superseded proposals
 * are omitted. A second pass over the same rows cannot invent extra items.
 */
export function deriveOpenItems(items: OpenItemSource[]): OpenItemDraft[] {
  const drafts: OpenItemDraft[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item?.id || itemClosed(item)) continue;
    const proposals = Array.isArray(item.plan?.proposals) ? item.plan!.proposals! : [];
    let emitted = 0;
    let substantive = 0;

    proposals.forEach((raw, index) => {
      const proposal = asProposal(raw);
      if (!proposal || proposal.type === "note_only" || isParentClarification(proposal)) return;
      substantive += 1;
      if (isClosedOpenItemProposal(proposal)) return;
      const type = openItemType(proposal);
      if (!type) return;
      const key = `${item.id}:${index}`;
      if (seen.has(key)) return;
      seen.add(key);
      const kind = kindFor(proposal, type);
      drafts.push({
        key,
        sageItemId: item.id,
        proposalIndex: index,
        type,
        kind,
        title: titleFor(item, proposal),
        explanation: explanationFor(item, proposal, kind),
        actionLabel: actionLabel(kind, type, proposal),
        createdAt: item.created_at,
        retry: retryFor(proposal, kind),
      });
      emitted += 1;
    });

    if (emitted > 0 || substantive > 0) continue;
    const source = (item.source_type ?? "").trim().toLowerCase();
    if (source === "chat") continue;
    const needsReview = (item.item_type ?? "").trim().toLowerCase() === "needs_review";
    const actionRequired = item.action_required === true;
    if (!needsReview && !actionRequired) continue;
    const key = `${item.id}:item`;
    if (seen.has(key)) continue;
    seen.add(key);
    const type = domainType(item);
    const summary =
      (item.summary ?? "").trim() ||
      (item.evidence_excerpt ?? "").trim() ||
      "This still needs a review.";
    drafts.push({
      key,
      sageItemId: item.id,
      proposalIndex: null,
      type,
      kind: type === "document" ? "filing_decision" : "awaiting_confirmation",
      title: clip(summary, 90),
      explanation:
        type === "message"
          ? "Review this draft. Nothing is sent until you approve it."
          : clip(summary, 180),
      actionLabel: fallbackAction(type),
      createdAt: item.created_at,
      retry: null,
    });
  }

  return drafts;
}
