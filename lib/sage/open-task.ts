/**
 * OpenTask is the first-class view of ongoing Sage work.
 *
 * It is a compatibility layer over sage_items.plan.proposals. Identity is the proposal id chain
 * (and plan.task_id when present). Legacy items with no task_id use the sage_item id. Nothing
 * here writes a second task table, and existing approval records stay where they are.
 *
 * Recency never chooses a task. A live task is selected by id, or by kind when exactly one live
 * task of that kind exists. Dismissed, executed, canceled, superseded, and expired tasks stay closed.
 */

import { proposalId, proposalState, type ProposalState } from "@/lib/sage/proposal-lifecycle";
import { parseGroundedIn, type GroundedIn } from "@/lib/sage/task-objective";
import type { MemorySource, WorkingFocus, WorkingMemory } from "@/lib/sage/working-memory";
import { focusKindOf, type FocusKind } from "@/lib/sage/working-memory";

export type OpenTaskKind = "message" | "calendar" | "expense" | "document" | "other";

export type OpenTaskStatus =
  | "collecting"
  | "awaiting_input"
  | "awaiting_approval"
  | "executed"
  | "dismissed"
  | "canceled"
  | "superseded"
  | "expired";

export type TaskVersion = {
  proposalId: string;
  itemId: string;
  draft: string | null;
  status: OpenTaskStatus;
};

export type OpenTask = {
  id: string;
  ownerId: string;
  caseId: string;
  sessionId: string | null;
  kind: OpenTaskKind;
  status: OpenTaskStatus;
  missing: string[];
  clarification: string | null;
  proposalIds: string[];
  currentProposalId: string | null;
  currentItemId: string | null;
  currentProposalIndex: number | null;
  versions: TaskVersion[];
  /** Parent's private objective. Never copied into the outgoing body. */
  privateObjective: string | null;
  /** Full stored objective, including the question, facts, constraints, and rejected feedback. */
  groundedIn: GroundedIn | null;
  /** Recipient-facing text of the current version. */
  outgoingBody: string | null;
  resultIds: string[];
  source: string | null;
};

export const LIVE_TASK_STATUS: ReadonlySet<OpenTaskStatus> = new Set([
  "collecting",
  "awaiting_input",
  "awaiting_approval",
]);

export function isLiveTask(task: OpenTask | null | undefined): boolean {
  return !!task && LIVE_TASK_STATUS.has(task.status);
}

export function asTaskKind(kind: FocusKind | string | null | undefined): OpenTaskKind {
  if (kind === "message" || kind === "calendar" || kind === "expense" || kind === "document") return kind;
  return "other";
}

/** Stored plan.task_id, else the sage_item id. One item is one task unless a later write stamps a shared id. */
export function taskIdOf(item: { id?: string | null; plan?: { task_id?: unknown } | null }): string {
  const stored = typeof item.plan?.task_id === "string" ? item.plan.task_id.trim() : "";
  if (stored) return stored;
  return typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resultIdsOf(row: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const key of ["result_event_id", "result_expense_id", "result_document_id", "result_message_id"]) {
    const value = text(row[key]);
    if (value) ids.push(value);
  }
  return ids;
}

function statusFromProposal(row: Record<string, unknown>, itemType: string | null): OpenTaskStatus {
  const state: ProposalState = proposalState(row);
  if (state === "superseded") return "superseded";
  if (state === "expired") return "expired";
  if (state === "canceled") return "canceled";
  if (state === "dismissed" || state === "declined") return "dismissed";
  if (state === "executed" || state === "completed") return "executed";
  if (row.type === "ask_clarification") return "awaiting_input";
  const depends = text(row.depends_on);
  if (depends) return "collecting";
  if (state === "approved" || state === "open") return "awaiting_approval";
  return asTaskKind(focusKindOf(row, itemType)) === "other" ? "awaiting_input" : "awaiting_approval";
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function outgoingOf(row: Record<string, unknown>): string | null {
  return text(row.revised_text) ?? text(row.draft);
}

/**
 * Build OpenTasks from the same session items working memory already reads.
 * Newest item first in the source list, but grouping is by task id, not recency.
 */
export function openTasksFromItems(opts: {
  items: Array<{
    id: string | null;
    itemType: string | null;
    sourceType?: string | null;
    plan?: { task_id?: unknown; proposals?: unknown[] } | null;
    proposals?: unknown[];
  }>;
  ownerId: string;
  caseId: string;
  sessionId: string | null;
}): OpenTask[] {
  const byId = new Map<string, OpenTask>();
  for (const item of opts.items) {
    const itemId = typeof item.id === "string" && item.id.trim() ? item.id.trim() : "";
    if (!itemId) continue;
    const proposals = Array.isArray(item.proposals)
      ? item.proposals
      : Array.isArray(item.plan?.proposals)
        ? item.plan.proposals
        : [];
    const taskId = taskIdOf({ id: itemId, plan: item.plan ?? null }) || itemId;
    let task = byId.get(taskId);
    if (!task) {
      task = {
        id: taskId,
        ownerId: opts.ownerId,
        caseId: opts.caseId,
        sessionId: opts.sessionId,
        kind: "other",
        status: "superseded",
        missing: [],
        clarification: null,
        proposalIds: [],
        currentProposalId: null,
        currentItemId: null,
        currentProposalIndex: null,
        versions: [],
        privateObjective: null,
        groundedIn: null,
        outgoingBody: null,
        resultIds: [],
        source: item.sourceType ?? null,
      };
      byId.set(taskId, task);
    }
    proposals.forEach((raw, index) => {
      const row = asRecord(raw);
      if (!row) return;
      const id = proposalId(row);
      const status = statusFromProposal(row, item.itemType);
      const kind = asTaskKind(focusKindOf(row, item.itemType));
      if (id) task!.proposalIds.push(id);
      task!.versions.push({
        proposalId: id,
        itemId,
        draft: outgoingOf(row),
        status,
      });
      if (kind !== "other") task!.kind = kind;
      const privateObjective = text(row.private_objective);
      if (privateObjective && !task!.privateObjective) task!.privateObjective = privateObjective;
      for (const resultId of resultIdsOf(row)) {
        if (!task!.resultIds.includes(resultId)) task!.resultIds.push(resultId);
      }
      if (status === "superseded") return;
      const takeCurrent =
        !task!.currentProposalId || (!isLiveStatus(task!.status) && isLiveStatus(status));
      if (!takeCurrent) return;
      task!.status = status;
      task!.currentProposalId = id || task!.currentProposalId;
      task!.currentItemId = itemId;
      task!.currentProposalIndex = index;
      task!.outgoingBody = outgoingOf(row);
      task!.groundedIn = parseGroundedIn(row.grounded_in) ?? task!.groundedIn;
      const storedObjective = text(row.private_objective);
      if (storedObjective) task!.privateObjective = storedObjective;
      task!.missing = text(row.depends_on) ? [text(row.depends_on)!] : [];
      if (row.type === "ask_clarification") {
        task!.clarification = outgoingOf(row);
        task!.missing = task!.missing.length > 0 ? task!.missing : ["answer"];
      }
    });
  }
  return [...byId.values()];
}

function isLiveStatus(status: OpenTaskStatus): boolean {
  return LIVE_TASK_STATUS.has(status);
}

/** Same derivation from working memory when session items are not loaded separately. */
export function openTasksFromMemory(
  memory: WorkingMemory | null | undefined,
  opts: { ownerId: string; caseId: string; sessionId: string | null; sources?: MemorySource[] }
): OpenTask[] {
  if (opts.sources && opts.sources.length > 0) {
    return openTasksFromItems({
      items: opts.sources.map((source) => ({
        id: source.itemId,
        itemType: source.itemType,
        proposals: source.proposals,
      })),
      ownerId: opts.ownerId,
      caseId: opts.caseId,
      sessionId: opts.sessionId,
    });
  }
  const grouped = new Map<string, WorkingFocus[]>();
  for (const entry of memory?.history ?? []) {
    const itemId = entry.itemId?.trim() || "";
    if (!itemId) continue;
    const list = grouped.get(itemId) ?? [];
    list.push(entry);
    grouped.set(itemId, list);
  }
  const tasks: OpenTask[] = [];
  for (const [itemId, entries] of grouped) {
    const current = entries.find((entry) => isLiveFocus(entry)) ?? entries[0];
    if (!current) continue;
    const status = statusFromFocus(current);
    tasks.push({
      id: itemId,
      ownerId: opts.ownerId,
      caseId: opts.caseId,
      sessionId: opts.sessionId,
      kind: asTaskKind(current.kind),
      status,
      missing: current.missing,
      clarification: current.clarification,
      proposalIds: entries.map((entry) => entry.proposalId).filter((id): id is string => !!id),
      currentProposalId: current.proposalId,
      currentItemId: itemId,
      currentProposalIndex: null,
      versions: entries.map((entry) => ({
        proposalId: entry.proposalId ?? "",
        itemId,
        draft: entry.draft ?? entry.clarification,
        status: statusFromFocus(entry),
      })),
      privateObjective: current.privateObjective,
      groundedIn: parseGroundedIn(current.groundedInRaw),
      outgoingBody: current.draft ?? current.clarification,
      resultIds: current.recordId ? [current.recordId] : [],
      source: null,
    });
  }
  return tasks;
}

function isLiveFocus(entry: WorkingFocus): boolean {
  return (
    entry.status === "pending" ||
    entry.status === "awaiting_clarification" ||
    entry.status === "approved"
  );
}

function statusFromFocus(entry: WorkingFocus): OpenTaskStatus {
  switch (entry.status) {
    case "awaiting_clarification":
      return "awaiting_input";
    case "pending":
      return entry.missing.length > 0 ? "collecting" : "awaiting_approval";
    case "approved":
      return "awaiting_approval";
    case "executed":
      return "executed";
    case "dismissed":
      return "dismissed";
    case "canceled":
      return "canceled";
    case "superseded":
      return "superseded";
    case "expired":
      return "expired";
    default:
      return "awaiting_approval";
  }
}

export function liveTasks(tasks: readonly OpenTask[]): OpenTask[] {
  return tasks.filter(isLiveTask);
}

export function liveTasksOfKind(tasks: readonly OpenTask[], kind: OpenTaskKind): OpenTask[] {
  return liveTasks(tasks).filter((task) => task.kind === kind);
}

/**
 * The live task of this kind, only when identity is unambiguous.
 * Several live tasks of the same kind yield null — the caller must name one by id.
 */
export function liveTaskOfKind(tasks: readonly OpenTask[], kind: OpenTaskKind): OpenTask | null {
  const matches = liveTasksOfKind(tasks, kind);
  if (matches.length === 1) return matches[0];
  return null;
}

/** Parent-facing question when more than one live message could be the target, or new vs revise is unclear. */
export function whichOpenMessageQuestion(tasks: readonly OpenTask[]): string {
  const messages = liveTasksOfKind(tasks, "message");
  const lines = messages.map((task, index) => {
    const snippet = (task.outgoingBody ?? task.privateObjective ?? "an open draft").replace(/\s+/g, " ").trim();
    const clipped = snippet.length > 140 ? `${snippet.slice(0, 137)}...` : snippet;
    return `${index + 1}. ${clipped}`;
  });
  if (messages.length === 1) {
    return `I already have a message in progress:\n${lines[0]}\nShould I change that one, or start a separate message?`;
  }
  if (messages.length > 1) {
    return `I have more than one message in progress. Which one should I use?\n${lines.join("\n")}`;
  }
  return "Which message should I work on? I will not guess.";
}

export function taskById(tasks: readonly OpenTask[], id: string | null | undefined): OpenTask | null {
  const needle = id?.trim() ?? "";
  if (!needle) return null;
  return tasks.find((task) => task.id === needle) ?? null;
}

/** A named task is used only when it is still live. Closed work is not reopened by id. */
export function liveTaskById(tasks: readonly OpenTask[], id: string | null | undefined): OpenTask | null {
  const found = taskById(tasks, id);
  return isLiveTask(found) ? found : null;
}
