/**
 * Working memory for one Sage session.
 * Derived from sage_items.plan JSON that the session journal already points at.
 * No new table: proposal id, result ids, attachment id, and lifecycle status
 * are already stored on each proposal.
 *
 * Limitation: a proposal is visible here only when its sage item is linked from
 * this session's journal and visible to the current user. Memory is recomputed
 * on each turn. It is not a second copy of the conversation.
 */

import { isSupersededProposal } from "@/lib/sage/proposal-lifecycle";

export type FocusKind = "calendar" | "expense" | "document" | "message" | "general";

export type FocusStatus =
  | "pending"
  | "awaiting_clarification"
  | "approved"
  | "executed"
  | "superseded"
  | "dismissed"
  | "canceled";

export type CollectedFields = Record<string, string | number | boolean | null>;

export type WorkingFocus = {
  kind: FocusKind;
  proposalId: string | null;
  itemId: string | null;
  status: FocusStatus;
  /** Saved record id, or the explicit document/event id already stored on the proposal. */
  recordId: string | null;
  attachmentId: string | null;
  fields: CollectedFields;
  missing: string[];
  clarification: string | null;
};

export type WorkingClarification = {
  proposalId: string | null;
  itemId: string | null;
  kind: FocusKind;
  question: string;
  collected: CollectedFields;
  missing: string[];
};

export type WorkingMemory = {
  /** Newest proposal that is still the subject of the conversation. */
  focus: WorkingFocus | null;
  /** Newest open question. Kept even after a later request takes the focus. */
  clarification: WorkingClarification | null;
  /** Newest proposal first, including superseded and executed versions. */
  history: WorkingFocus[];
};

export type MemorySource = {
  itemId: string | null;
  itemType: string | null;
  /** Oldest proposal first, matching sage_items.plan.proposals. */
  proposals: unknown[];
};

const RESULT_KEYS = [
  "result_event_id",
  "result_expense_id",
  "result_document_id",
  "result_message_id",
] as const;

const FIELD_KEYS = [
  "date",
  "event_start",
  "title",
  "description",
  "amount",
  "category",
  "document_child_id",
  "document_child_name",
  "visibility",
  "paid_by",
  "stated_percent",
  "sharing_intent",
  "calendar_event_id",
  "attached_document_id",
  "recipient_name",
  "recipient_email",
] as const;

const EXPLICIT_NOTE =
  /\b(make a note|take a note|note that|jot (this|that) down|add a note|save (this|that) as a note)\b/i;

export function emptyWorkingMemory(): WorkingMemory {
  return { focus: null, clarification: null, history: [] };
}

export function isExplicitNoteRequest(message: string): boolean {
  return EXPLICIT_NOTE.test(message.trim());
}

/** A pending or open question can still be approved. A superseded version cannot. */
export function isActionableFocus(focus: WorkingFocus | null | undefined): boolean {
  return focus?.status === "pending" || focus?.status === "awaiting_clarification";
}

/**
 * True when this turn is an explicit request of a different kind than the open
 * question. A short answer with no request kind stays with the question.
 */
export function interruptsClarification(
  requested: FocusKind | null,
  memory: WorkingMemory | null | undefined
): boolean {
  if (!requested || requested === "general") return false;
  const open = memory?.clarification?.kind;
  if (!open) return false;
  if (open === "general") return true;
  return requested !== open;
}

export function unrecognizedChatReply(memory: WorkingMemory | null | undefined): string {
  const question = memory?.clarification?.question?.trim();
  if (question) {
    return `I didn't take an action on that. Your earlier question is still open: ${question}`;
  }
  return "I didn't take an action on that. I can add a calendar event, log an expense, file a document, or draft a message. What should I do?";
}

/**
 * Parent chat only. An all-note plan from the model is a miss, not a Note.
 * Returns null when the plan already contains a real action.
 */
export function settleParentChatPlan(
  plan: { status?: string; proposals?: { type?: string }[]; reasoning?: string },
  memory: WorkingMemory | null | undefined
): { reply: string; plan: { status: "no_action"; proposals: []; reasoning: string } } | null {
  const proposals = plan.proposals ?? [];
  if (proposals.length === 0) return null;
  if (!proposals.every((proposal) => proposal.type === "note_only")) return null;
  return {
    reply: unrecognizedChatReply(memory),
    plan: {
      status: "no_action",
      proposals: [],
      reasoning: "Parent chat did not match an action. No note was created.",
    },
  };
}

/**
 * Newest sage item first. Identity comes from proposal id and stored record ids.
 * A matching title is never copied onto a proposal that has no identifier.
 */
export function deriveWorkingMemory(items: MemorySource[]): WorkingMemory {
  const history: WorkingFocus[] = [];
  let focus: WorkingFocus | null = null;
  let clarification: WorkingClarification | null = null;

  for (const item of items) {
    const records = item.proposals
      .map((raw) => asRecord(raw))
      .filter((row): row is Record<string, unknown> => row != null);
    const siblingKind =
      records
        .map((row) => kindFromProposal(row, item.itemType))
        .find((kind) => kind !== "general") ?? null;
    const collected = records.reduce<CollectedFields>((fields, row) => {
      if (isSupersededProposal(row)) return fields;
      return { ...fields, ...collectedFields(row) };
    }, {});
    const entries = records.map((row) => toFocus(row, item, siblingKind));

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      history.push(entry);
      if (!focus && isCurrent(entry.status)) focus = entry;
      if (!clarification && entry.status === "awaiting_clarification") {
        clarification = {
          proposalId: entry.proposalId,
          itemId: entry.itemId,
          kind: entry.kind,
          question: entry.clarification ?? "",
          collected,
          missing: entry.missing,
        };
      }
    }
  }

  return { focus, clarification, history };
}

function isCurrent(status: FocusStatus): boolean {
  return (
    status === "pending" ||
    status === "awaiting_clarification" ||
    status === "approved" ||
    status === "executed"
  );
}

function toFocus(
  row: Record<string, unknown>,
  item: MemorySource,
  siblingKind: FocusKind | null
): WorkingFocus {
  const kind = kindFor(row, item.itemType, siblingKind);
  const status = focusStatus(row);
  return {
    kind,
    proposalId: text(row.id),
    itemId: item.itemId,
    status,
    recordId: explicitRecordId(row, kind),
    attachmentId: text(row.attached_document_id),
    fields: collectedFields(row),
    missing: missingFields(row),
    clarification: row.type === "ask_clarification" ? text(row.draft) : null,
  };
}

function kindFor(
  row: Record<string, unknown>,
  itemType: string | null,
  siblingKind: FocusKind | null
): FocusKind {
  const own = kindFromProposal(row, itemType);
  if (own !== "general") return own;
  if (row.type === "ask_clarification" && siblingKind && siblingKind !== "general") return siblingKind;
  return kindFromItemType(itemType);
}

function kindFromProposal(row: Record<string, unknown>, itemType: string | null): FocusKind {
  if (isFocusKind(row.clarifies)) return row.clarifies;
  const type = typeof row.type === "string" ? row.type : "";
  if (type === "calendar_update" || type === "force_event") return "calendar";
  if (type === "log_expense" || type === "force_expense") return "expense";
  if (type === "log_document" || type === "file_document" || type === "force_document") return "document";
  if (type === "reply_coparent") return "message";
  if (type === "ask_clarification") return kindFromItemType(itemType);
  return "general";
}

function kindFromItemType(itemType: string | null): FocusKind {
  const value = (itemType ?? "").trim().toLowerCase();
  if (
    value === "calendar" ||
    value === "calendar_event" ||
    value === "calendar_update" ||
    value === "schedule_change" ||
    value === "event"
  ) {
    return "calendar";
  }
  if (value === "expense") return "expense";
  if (value === "document" || value === "document_summary") return "document";
  if (value === "message" || value === "reply") return "message";
  return "general";
}

function isFocusKind(value: unknown): value is FocusKind {
  return (
    value === "calendar" ||
    value === "expense" ||
    value === "document" ||
    value === "message" ||
    value === "general"
  );
}

function explicitRecordId(row: Record<string, unknown>, kind: FocusKind): string | null {
  for (const key of RESULT_KEYS) {
    const value = text(row[key]);
    if (value) return value;
  }
  if (kind === "calendar") return text(row.calendar_event_id);
  if (kind === "document") return text(row.attached_document_id);
  return null;
}

function focusStatus(row: Record<string, unknown>): FocusStatus {
  if (isSupersededProposal(row)) return "superseded";
  const status = (text(row.status) ?? "").toLowerCase();
  if (status === "canceled" || status === "cancelled") return "canceled";
  if (status === "dismissed" || status === "declined" || status === "waived_by_user") return "dismissed";
  if (row.executed === true || status === "executed" || status === "completed") return "executed";
  if (
    row.approved === true ||
    status === "approved" ||
    (typeof row.approved_at === "string" && row.approved_at.trim().length > 0)
  ) {
    return "approved";
  }
  if (row.type === "ask_clarification") return "awaiting_clarification";
  return "pending";
}

function collectedFields(row: Record<string, unknown>): CollectedFields {
  const fields: CollectedFields = {};
  for (const key of FIELD_KEYS) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) fields[key] = value.trim();
    else if (typeof value === "number" && Number.isFinite(value)) fields[key] = value;
    else if (typeof value === "boolean") fields[key] = value;
  }
  return fields;
}

function missingFields(row: Record<string, unknown>): string[] {
  const depends = text(row.depends_on);
  if (depends) return [depends];
  if (row.type === "ask_clarification") return ["answer"];
  return [];
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
