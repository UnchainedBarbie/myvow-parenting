/**
 * Shadow interpreter contract.
 * The model may only return this tool input. The server validates every field
 * and drops handles that were not minted for this request.
 * Nothing here writes, sends, or creates a proposal.
 */

import { documentAuthorizedForViewer } from "@/lib/documents-tab";
import type { WorkingMemory } from "@/lib/sage/working-memory";

export const SHADOW_INTENTS = [
  "conversation",
  "advice",
  "retrieve",
  "create",
  "update",
  "cancel",
  "supply_missing",
  "message_coparent",
  "note",
  "unsupported",
] as const;

export const SHADOW_DOMAINS = ["none", "calendar", "expense", "document", "message"] as const;

export const SHADOW_ACTIONS = [
  "none",
  "read",
  "create",
  "update",
  "cancel",
  "answer",
  "draft_message",
  "note",
] as const;

export const SHADOW_MISSING = [
  "date",
  "time",
  "amount",
  "child",
  "description",
  "recipient",
  "category",
  "attachment",
  "title",
] as const;

export type ShadowIntent = (typeof SHADOW_INTENTS)[number];
export type ShadowDomain = (typeof SHADOW_DOMAINS)[number];
export type ShadowAction = (typeof SHADOW_ACTIONS)[number];
export type ShadowMissing = (typeof SHADOW_MISSING)[number];

export const SHADOW_TOOL_NAME = "interpret_parent_turn";

const FIELD_KEYS = new Set([
  "title",
  "description",
  "date",
  "time",
  "amount",
  "category",
  "child_handle",
  "visibility",
  "subject",
]);

const CATEGORIES = new Set([
  "medical",
  "dental",
  "therapy",
  "school",
  "extracurricular",
  "clothing",
  "childcare",
  "transportation",
  "other",
  "court_order",
  "expenses",
  "legal",
  "custody",
  "photos",
  "communication",
  "incident",
]);

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UNTRUSTED_KEY = /percent|share|owed|split|case_id|email|permission|password|token|secret/i;

export const SHADOW_TOOL = {
  name: SHADOW_TOOL_NAME,
  description:
    "Classify what the parent wants. Use only handles from the packet. Do not invent ids, emails, or percentages.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["actions"],
    properties: {
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["intent", "domain", "action", "needs_clarification"],
          properties: {
            intent: { type: "string", enum: [...SHADOW_INTENTS] },
            domain: { type: "string", enum: [...SHADOW_DOMAINS] },
            action: { type: "string", enum: [...SHADOW_ACTIONS] },
            target_handle: { type: "string" },
            context_handle: { type: "string" },
            attachment_handle: { type: "string" },
            fields: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "value"],
                properties: {
                  key: { type: "string" },
                  value: { type: "string" },
                },
              },
            },
            missing: {
              type: "array",
              items: { type: "string", enum: [...SHADOW_MISSING] },
            },
            needs_clarification: { type: "boolean" },
          },
        },
      },
    },
  },
} as const;

export type RouterView = {
  handled: boolean;
  control: "none" | "cancel_message" | "revise_pending" | "revise_document";
  reply: string;
  reasoning?: string;
  proposals: Array<{
    type?: string;
    calendar_intent?: string;
    updatesExisting?: boolean;
    clarifies?: string;
  }>;
};

export type RouterAction = { intent: ShadowIntent; domain: ShadowDomain };

export type RouterSnapshot = {
  actions: RouterAction[];
  fallback: boolean;
  failed: boolean;
};

export type ShadowTurnInput = {
  message: string;
  recentTurns?: { role: "parent" | "sage"; text: string }[];
  memory?: WorkingMemory | null;
  children?: { id: string; name: string }[];
  events?: {
    id: string;
    title: string;
    childId: string | null;
    start: string;
    description?: string | null;
    status?: string | null;
  }[];
  documents?: {
    id: string;
    title: string;
    description?: string;
    category: string;
    fileName: string;
    childIds: string[];
    createdAt: string;
    visibility: string;
    uploadedBy: string;
    storagePath?: string;
  }[];
  attachments?: { id: string; fileName: string; url?: string }[];
  viewerId?: string;
  viewerRole?: string | null;
  coparentName?: string | null;
  /** Journal message id used only to skip a second call. Never logged or sent to the model. */
  turnKey?: string | null;
  router: RouterView;
};

export type HandleKind = "child" | "record" | "attachment" | "coparent";

export type HandleCatalog = {
  handleFor(localId: string): string | null;
  accepts(handle: string, kind: HandleKind): boolean;
};

export type ShadowPacket = {
  prompt: string;
  catalog: HandleCatalog;
};

export type ValidatedAction = {
  intent: ShadowIntent;
  domain: ShadowDomain;
  action: ShadowAction;
  targetHandle: string | null;
  contextHandle: string | null;
  attachmentHandle: string | null;
  fields: Record<string, string | number>;
  missing: ShadowMissing[];
  needsClarification: boolean;
  rejectedReference: boolean;
};

export type ValidatedShadow = {
  actions: ValidatedAction[];
  rejectedReferences: number;
  discardedFields: number;
};

export type ShadowAgreement = "agree" | "partial" | "disagree";

export type ShadowMetric = ShadowAgreement | "failure";

export type ShadowComparisonRecord = {
  tag: "sage-shadow";
  outcome: "disabled" | "compared" | "timeout" | "api_error" | "invalid_schema";
  /** Count agree, partial, disagree, and failure without reading the message. */
  metric: ShadowMetric | null;
  agreement: ShadowAgreement | null;
  routerIntent: ShadowIntent | null;
  routerDomain: ShadowDomain | null;
  routerActions: number;
  routerFallback: boolean;
  routerFailed: boolean;
  shadowIntent: ShadowIntent | null;
  shadowDomain: ShadowDomain | null;
  shadowActions: number;
  shadowMulti: boolean;
  needsClarification: boolean;
  rejectedReferences: number;
  discardedFields: number;
  latencyMs: number;
  httpStatus: number | null;
  /** Stable class such as invalid_request. No response text. */
  errorCategory: string | null;
  /** Stable code such as unsupported_maxitems. No response text. */
  diagnostic: string | null;
};

type Minted = { kind: HandleKind; domain: ShadowDomain; localId: string };

export function routerSnapshot(view: RouterView, failed = false): RouterSnapshot {
  const actions: RouterAction[] = [];
  if (view.control === "cancel_message") {
    actions.push({ intent: "cancel", domain: "message" });
  } else if (view.control === "revise_document") {
    actions.push({ intent: "update", domain: "document" });
  } else if (view.control === "revise_pending") {
    actions.push({ intent: "supply_missing", domain: "calendar" });
  } else {
    const substantive = view.proposals.some((proposal) => proposal.type && proposal.type !== "ask_clarification" && proposal.type !== "note_only");
    for (const proposal of view.proposals) {
      const mapped = mapProposal(proposal, substantive);
      if (mapped) actions.push(mapped);
    }
  }

  if (actions.length === 0 && view.handled && view.reply.trim()) {
    actions.push({ intent: retrievalIntent(view), domain: retrievalDomain(view) });
  }
  if (actions.length === 0) {
    actions.push({ intent: "unsupported", domain: "none" });
  }

  const fallback = !view.handled || actions.every((action) => action.intent === "unsupported");
  return { actions, fallback, failed };
}

export function buildShadowPacket(input: ShadowTurnInput): ShadowPacket {
  const byHandle = new Map<string, Minted>();
  const byLocal = new Map<string, string>();
  let childN = 0;
  let recordN = 0;
  let attachmentN = 0;

  const mint = (kind: HandleKind, domain: ShadowDomain, localId: string): string => {
    const existing = byLocal.get(localId);
    if (existing) return existing;
    const prefix = kind === "child" ? "c" : kind === "attachment" ? "a" : kind === "coparent" ? "p" : "r";
    const n = kind === "child" ? ++childN : kind === "attachment" ? ++attachmentN : kind === "coparent" ? 1 : ++recordN;
    const handle = kind === "coparent" ? "coparent" : `${prefix}${n}`;
    byLocal.set(localId, handle);
    byHandle.set(handle, { kind, domain, localId });
    return handle;
  };

  const children = (input.children ?? [])
    .map((child) => ({ id: child.id, name: safeName(child.name) }))
    .filter((child) => child.id.trim() && child.name)
    .slice(0, 12)
    .map((child) => ({ handle: mint("child", "none", `child:${child.id}`), name: child.name }));

  const childById = new Map(
    (input.children ?? []).map((child) => [child.id, mint("child", "none", `child:${child.id}`)])
  );

  const viewer = { userId: input.viewerId ?? "", role: input.viewerRole };
  const documents = (input.documents ?? [])
    .filter((doc) => doc.id.trim())
    .filter((doc) =>
      documentAuthorizedForViewer(
        { visibility: doc.visibility, uploadedBy: doc.uploadedBy },
        viewer.userId ? viewer : { userId: "", role: viewer.role }
      )
    )
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  const events = (input.events ?? [])
    .filter((event) => event.id.trim())
    .slice()
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, 8);

  const records: Array<Record<string, string>> = [];
  for (const event of events) {
    const handle = mint("record", "calendar", `event:${event.id}`);
    records.push({
      handle,
      domain: "calendar",
      label: clip(event.title, 80),
      ...(isoDay(event.start) ? { when: isoDay(event.start) as string } : {}),
      ...(event.childId && childById.get(event.childId) ? { child: childById.get(event.childId) as string } : {}),
    });
  }
  for (const doc of documents) {
    const handle = mint("record", "document", `document:${doc.id}`);
    const child = doc.childIds.map((id) => childById.get(id)).find((value) => value) ?? "";
    records.push({
      handle,
      domain: "document",
      label: clip(doc.title, 80),
      category: CATEGORIES.has(doc.category) ? doc.category : "other",
      file_name: baseName(doc.fileName),
      ...(child ? { child } : {}),
    });
  }

  const memory = input.memory ?? null;
  const focusHandle = memory?.focus
    ? memoryHandle(memory.focus.proposalId, memory.focus.recordId, mint, byLocal)
    : null;
  if (memory?.focus?.proposalId && focusHandle && !records.some((record) => record.handle === focusHandle)) {
    records.unshift({
      handle: focusHandle,
      domain: domainFromKind(memory.focus.kind),
      role: "focus",
      status: memory.focus.status,
      ...(memory.focus.missing[0] ? { missing: memory.focus.missing.slice(0, 4).join(",") } : {}),
    });
  }
  const clarification = memory?.clarification ?? null;
  const clarificationHandle = clarification
    ? memoryHandle(clarification.proposalId, null, mint, byLocal)
    : null;

  const attachments = (input.attachments ?? [])
    .filter((file) => file.id.trim() && baseName(file.fileName))
    .slice(0, 3)
    .map((file) => ({
      handle: mint("attachment", "document", `attachment:${file.id}`),
      file_name: baseName(file.fileName),
    }));

  const coparent = safeName(input.coparentName ?? "");
  if (coparent) mint("coparent", "message", "coparent");

  const recent = (input.recentTurns ?? [])
    .slice(-6)
    .map((turn) => ({
      role: turn.role === "sage" ? "sage" : "parent",
      text: clip(turn.text, 280),
    }))
    .filter((turn) => turn.text);

  const packet = {
    message: clip(input.message, 2000),
    ...(recent.length ? { recent_turns: recent } : {}),
    memory: {
      ...(memory?.focus
        ? {
            focus: {
              handle: focusHandle,
              kind: domainFromKind(memory.focus.kind),
              status: memory.focus.status,
              missing: memory.focus.missing.slice(0, 4),
            },
          }
        : {}),
      ...(clarification
        ? {
            clarification: {
              handle: clarificationHandle,
              kind: domainFromKind(clarification.kind),
              question: clip(clarification.question, 200),
              missing: clarification.missing.slice(0, 4),
            },
          }
        : {}),
    },
    children,
    records: dedupeRecords(records).slice(0, 16),
    attachments,
    ...(coparent ? { coparent: { handle: "coparent", name: coparent } } : {}),
    continuation: {
      open: Boolean(clarification),
      kind: clarification ? domainFromKind(clarification.kind) : "none",
      missing: (clarification?.missing ?? []).slice(0, 4),
      focus_kind: memory?.focus ? domainFromKind(memory.focus.kind) : "none",
      focus_status: memory?.focus?.status ?? "",
    },
  };

  return {
    prompt: JSON.stringify(packet),
    catalog: {
      handleFor(localId: string) {
        return byLocal.get(localId) ?? null;
      },
      accepts(handle: string, kind: HandleKind) {
        return byHandle.get(handle)?.kind === kind;
      },
    },
  };
}

export function validateShadowOutput(raw: unknown, catalog: HandleCatalog): ValidatedShadow | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const actionsRaw = (raw as { actions?: unknown }).actions;
  if (!Array.isArray(actionsRaw) || actionsRaw.length === 0 || actionsRaw.length > 4) return null;

  const actions: ValidatedAction[] = [];
  let rejectedReferences = 0;
  let discardedFields = 0;

  for (const entry of actionsRaw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (!isIntent(row.intent) || !isDomain(row.domain) || !isAction(row.action)) return null;
    if (typeof row.needs_clarification !== "boolean") return null;

    const target = takeHandle(row.target_handle, catalog, "record");
    const context = takeHandle(row.context_handle, catalog, "record");
    const attachment = takeHandle(row.attachment_handle, catalog, "attachment");
    if (target.rejected || context.rejected || attachment.rejected) rejectedReferences += 1;

    const fields = readFields(row.fields, catalog);
    discardedFields += fields.discarded;
    const missing = readMissing(row.missing);
    if (missing === null) return null;

    actions.push({
      intent: row.intent,
      domain: row.domain,
      action: row.action,
      targetHandle: target.handle,
      contextHandle: context.handle,
      attachmentHandle: attachment.handle,
      fields: fields.values,
      missing,
      needsClarification: row.needs_clarification,
      rejectedReference: target.rejected || context.rejected || attachment.rejected,
    });
  }

  return { actions, rejectedReferences, discardedFields };
}

export function compareSnapshots(
  router: RouterSnapshot,
  shadow: ValidatedShadow
): ShadowAgreement {
  const key = (action: { intent: string; domain: string }) => `${action.intent}:${action.domain}`;
  const left = router.actions.map(key).sort();
  const right = shadow.actions.map(key).sort();
  const same =
    left.length === right.length && left.every((value, index) => value === right[index]);
  if (same) return "agree";
  const primaryRouter = router.actions[0];
  const primaryShadow = shadow.actions[0];
  if (
    primaryRouter &&
    primaryShadow &&
    primaryRouter.intent === primaryShadow.intent &&
    primaryRouter.domain === primaryShadow.domain
  ) {
    return "partial";
  }
  return "disagree";
}

export function comparisonRecord(input: {
  outcome: ShadowComparisonRecord["outcome"];
  router: RouterSnapshot;
  shadow?: ValidatedShadow | null;
  agreement?: ShadowAgreement | null;
  latencyMs: number;
  httpStatus?: number | null;
  errorCategory?: string | null;
  diagnostic?: string | null;
}): ShadowComparisonRecord {
  const primaryRouter = input.router.actions[0] ?? null;
  const primaryShadow = input.shadow?.actions[0] ?? null;
  const agreement = input.agreement ?? null;
  return {
    tag: "sage-shadow",
    outcome: input.outcome,
    metric: shadowMetric(input.outcome, agreement),
    agreement,
    routerIntent: primaryRouter?.intent ?? null,
    routerDomain: primaryRouter?.domain ?? null,
    routerActions: input.router.actions.length,
    routerFallback: input.router.fallback,
    routerFailed: input.router.failed,
    shadowIntent: primaryShadow?.intent ?? null,
    shadowDomain: primaryShadow?.domain ?? null,
    shadowActions: input.shadow?.actions.length ?? 0,
    shadowMulti: (input.shadow?.actions.length ?? 0) > 1,
    needsClarification: input.shadow?.actions.some((action) => action.needsClarification) ?? false,
    rejectedReferences: input.shadow?.rejectedReferences ?? 0,
    discardedFields: input.shadow?.discardedFields ?? 0,
    latencyMs: input.latencyMs,
    httpStatus: input.httpStatus ?? null,
    errorCategory: input.errorCategory ?? null,
    diagnostic: input.diagnostic ?? null,
  };
}

function shadowMetric(
  outcome: ShadowComparisonRecord["outcome"],
  agreement: ShadowAgreement | null
): ShadowMetric | null {
  if (outcome === "disabled") return null;
  if (outcome === "compared") return agreement ?? "disagree";
  return "failure";
}

function mapProposal(
  proposal: RouterView["proposals"][number],
  substantive: boolean
): RouterAction | null {
  if (proposal.type === "calendar_update") {
    return {
      intent: proposal.calendar_intent === "update" ? "update" : "create",
      domain: "calendar",
    };
  }
  if (proposal.type === "log_expense") return { intent: "create", domain: "expense" };
  if (proposal.type === "log_document") {
    return { intent: proposal.updatesExisting ? "update" : "create", domain: "document" };
  }
  if (proposal.type === "reply_coparent") return { intent: "message_coparent", domain: "message" };
  if (proposal.type === "ask_clarification" && !substantive) {
    return { intent: "supply_missing", domain: domainFromClarifies(proposal.clarifies) };
  }
  if (proposal.type === "note_only") return null;
  return null;
}

function retrievalIntent(view: RouterView): ShadowIntent {
  const reply = view.reply.toLowerCase();
  if (reply.includes("saved that as a note")) return "note";
  if (reply.includes("wording") || reply.includes("won't send anything about that")) return "advice";
  if (reply.includes("canceled that message")) return "cancel";
  return "retrieve";
}

function retrievalDomain(view: RouterView): ShadowDomain {
  const reasoning = (view.reasoning ?? "").toLowerCase();
  if (reasoning.includes("document")) return "document";
  if (reasoning.includes("calendar")) return "calendar";
  if (view.reply.includes("[[doc:")) return "document";
  return "none";
}

function domainFromClarifies(value: string | undefined): ShadowDomain {
  if (value === "calendar" || value === "expense" || value === "document" || value === "message") return value;
  return "none";
}

function domainFromKind(kind: string): ShadowDomain {
  if (kind === "calendar" || kind === "expense" || kind === "document" || kind === "message") return kind;
  return "none";
}

function memoryHandle(
  proposalId: string | null | undefined,
  recordId: string | null | undefined,
  mint: (kind: HandleKind, domain: ShadowDomain, localId: string) => string,
  byLocal: Map<string, string>
): string | null {
  if (recordId) {
    const event = byLocal.get(`event:${recordId}`);
    if (event) return event;
    const document = byLocal.get(`document:${recordId}`);
    if (document) return document;
  }
  if (proposalId && byLocal.get(`proposal:${proposalId}`)) return byLocal.get(`proposal:${proposalId}`) ?? null;
  if (proposalId) return mint("record", "none", `proposal:${proposalId}`);
  return null;
}

function takeHandle(
  value: unknown,
  catalog: HandleCatalog,
  kind: HandleKind
): { handle: string | null; rejected: boolean } {
  if (typeof value !== "string" || !value.trim()) return { handle: null, rejected: false };
  const handle = value.trim();
  if (UUID.test(handle) || EMAIL.test(handle) || !catalog.accepts(handle, kind)) {
    return { handle: null, rejected: true };
  }
  return { handle, rejected: false };
}

function readFields(
  raw: unknown,
  catalog: HandleCatalog
): { values: Record<string, string | number>; discarded: number } {
  const values: Record<string, string | number> = {};
  let discarded = 0;
  if (raw == null) return { values, discarded };
  if (!Array.isArray(raw)) return { values, discarded: discarded + 1 };
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      discarded += 1;
      continue;
    }
    const key = typeof (entry as { key?: unknown }).key === "string" ? (entry as { key: string }).key.trim() : "";
    const value = (entry as { value?: unknown }).value;
    if (!key || typeof value !== "string") {
      discarded += 1;
      continue;
    }
    if (!FIELD_KEYS.has(key) || UNTRUSTED_KEY.test(key) || EMAIL.test(value) || UUID.test(value)) {
      discarded += 1;
      continue;
    }
    const cleaned = cleanField(key, value.trim(), catalog);
    if (cleaned == null) {
      discarded += 1;
      continue;
    }
    values[key] = cleaned;
  }
  return { values, discarded };
}

function cleanField(key: string, value: string, catalog: HandleCatalog): string | number | null {
  if (!value || value.length > 240) return null;
  if (key === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  if (key === "time") return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
  if (key === "amount") {
    if (value.includes("%")) return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return null;
    return Math.round(amount * 100) / 100;
  }
  if (key === "category") return CATEGORIES.has(value) ? value : null;
  if (key === "visibility") return value === "private" || value === "parents_only" || value === "family" ? value : null;
  if (key === "child_handle") return catalog.accepts(value, "child") ? value : null;
  return value;
}

function readMissing(raw: unknown): ShadowMissing[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const missing: ShadowMissing[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !isMissing(entry)) return null;
    missing.push(entry);
  }
  return missing;
}

function dedupeRecords(records: Array<Record<string, string>>): Array<Record<string, string>> {
  const seen = new Set<string>();
  const next: Array<Record<string, string>> = [];
  for (const record of records) {
    if (seen.has(record.handle)) continue;
    seen.add(record.handle);
    next.push(record);
  }
  return next;
}

function safeName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 40 || EMAIL.test(trimmed) || UUID.test(trimmed)) return "";
  return trimmed;
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max);
}

function baseName(value: string): string {
  const parts = value.split(/[/\\]/);
  return clip(parts[parts.length - 1] ?? "", 80);
}

function isoDay(value: string): string | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function isIntent(value: unknown): value is ShadowIntent {
  return typeof value === "string" && (SHADOW_INTENTS as readonly string[]).includes(value);
}
function isDomain(value: unknown): value is ShadowDomain {
  return typeof value === "string" && (SHADOW_DOMAINS as readonly string[]).includes(value);
}
function isAction(value: unknown): value is ShadowAction {
  return typeof value === "string" && (SHADOW_ACTIONS as readonly string[]).includes(value);
}
function isMissing(value: string): value is ShadowMissing {
  return (SHADOW_MISSING as readonly string[]).includes(value);
}
