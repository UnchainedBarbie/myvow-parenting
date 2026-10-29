/**
 * Compact context for a chat turn. Not a transcript.
 * The event under discussion, the thread subject, and the text of open proposals.
 */

import { getServiceRoleClient } from "@/lib/supabase/server";
import { savedEventPointer } from "@/lib/sage/calendar-chat";
import { eventSubjectFromTexts, preferEventSubject, resolveEventSubject } from "@/lib/sage/event-subject";
import { parseClockMinutes, resolveDate } from "@/lib/sage/resolver";
import { isLiveProposal } from "@/lib/sage/proposal-lifecycle";
import {
  deriveWorkingMemory,
  emptyWorkingMemory,
  type MemorySource,
  type WorkingMemory,
} from "@/lib/sage/working-memory";

export type OpenProposalContext = {
  type: string;
  text: string;
  document?: {
    key: string;
    title: string;
    description: string;
    category: string;
    visibility: "private" | "parents_only" | "family";
    childName: string | null;
    childId: string | null;
    fileName: string | null;
    documentId: string | null;
    requiresApproval: true;
    updatesExisting: boolean;
  } | null;
};

export type ConversationEvent = {
  subject: string | null;
  child: string | null;
  /** Resolved YYYY-MM-DD, when one has been established. */
  date: string | null;
  /** Clock already established, such as "8:00 AM". */
  time: string | null;
  /** Saved calendar event this conversation is about. */
  eventId?: string | null;
};

export type ConversationContext = {
  thread_subject: string | null;
  event: ConversationEvent;
  open_proposals: OpenProposalContext[];
  /** Latest filed document in this session, when a follow-up should propose an update. */
  recent_document?: OpenProposalContext["document"];
  /**
   * Focus, open clarification, and proposal history derived from this session's
   * sage items. Absent on hand-built fixtures that have no stored proposals.
   */
  memory?: WorkingMemory;
};

export type BareCorrection = {
  kind: "time" | "date" | "place" | "amount";
  phrase: string;
};

const NOT_A_CHILD = new Set([
  "it",
  "that",
  "there",
  "what",
  "let",
  "here",
  "she",
  "he",
  "we",
  "who",
]);

const FILLER = new Set([
  "actually",
  "its",
  "it's",
  "it",
  "is",
  "at",
  "on",
  "to",
  "the",
  "a",
  "an",
  "for",
  "please",
  "instead",
  "make",
  "change",
  "move",
  "update",
  "rather",
  "now",
  "just",
  "sorry",
  "oops",
  "be",
  "was",
  "about",
]);

type Admin = ReturnType<typeof getServiceRoleClient>;

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

/** Not waiting on the parent. The shared lifecycle decides; a note or an untyped row is never open work. */
function closed(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return true;
  const proposal = raw as { type?: string };
  if (!proposal.type || proposal.type === "note_only") return true;
  return !isLiveProposal(raw);
}

function liveText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const proposal = raw as { revised_text?: unknown; draft?: unknown };
  const revised = typeof proposal.revised_text === "string" ? proposal.revised_text.trim() : "";
  const draft = typeof proposal.draft === "string" ? proposal.draft.trim() : "";
  return (revised || draft).replace(/\s+/g, " ").slice(0, 180);
}

function childNamedIn(text: string): string | null {
  const match = text.match(/\b([A-Za-z][a-z]{1,20})'s\b/);
  if (!match) return null;
  const name = match[1];
  if (NOT_A_CHILD.has(name.toLowerCase())) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function clockLabel(total: number): string {
  const hour24 = Math.floor(total / 60) % 24;
  const minute = total % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function shortDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(dt);
}

function field(label: string, value: string | null): string | null {
  return value ? `${label}=${value}` : null;
}

/** Structured block prepended to a chat observation. Empty sections stay explicit. */
export function formatConversationContext(ctx: ConversationContext): string {
  const eventParts = [
    field("subject", ctx.event.subject),
    field("child", ctx.event.child),
    ctx.event.date ? `date=${ctx.event.date} (${shortDate(ctx.event.date)})` : null,
    field("time", ctx.event.time),
  ].filter((part): part is string => !!part);
  const open =
    ctx.open_proposals.length > 0
      ? ctx.open_proposals.map((p) => `- ${p.type}: ${p.text}`).join("\n")
      : "none";
  return [
    "[conversation]",
    `thread: ${ctx.thread_subject?.trim() || "none"}`,
    `event: ${eventParts.length > 0 ? eventParts.join("; ") : "none"}`,
    "open:",
    open,
    "[/conversation]",
  ].join("\n");
}

function contentWords(text: string): string[] {
  let s = text.toLowerCase();
  s = s.replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/g, " ");
  s = s.replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g, " ");
  s = s.replace(/\b\d+(?:\.\d{1,2})?\s*(?:dollars?|usd)\b/g, " ");
  s = s.replace(
    /\b(?:mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday|today|tomorrow|yesterday)\b/g,
    " "
  );
  s = s.replace(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/g,
    " "
  );
  s = s.replace(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/g, " ");
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  return s
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 1 && !FILLER.has(word));
}

/**
 * A turn that names a time, date, place, or amount and nothing else.
 * Naming an event ("the track meet is at 9") is not bare.
 */
export function bareCorrection(text: string): BareCorrection | null {
  const raw = text.trim();
  if (!raw || eventSubjectFromTexts([raw])) return null;
  const words = contentWords(raw);
  if (words.length > 0) {
    if (words.length <= 4 && !parseClockMinutes(raw)) {
      const place = raw.match(/\b(?:at|in)\s+([a-z][\w\s]{1,40})$/i);
      if (place) {
        const phrase = place[1].replace(/^(?:the|a|an)\s+/i, "").trim();
        if (phrase && !/^\d/.test(phrase)) return { kind: "place", phrase };
      }
    }
    return null;
  }
  const timeToken = raw.match(/\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i);
  if (timeToken && parseClockMinutes(raw) != null) {
    return { kind: "time", phrase: timeToken[1].replace(/\s+/g, "") };
  }
  const amount = raw.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?|\b\d+(?:\.\d{1,2})?\s*(?:dollars?|usd)\b/i);
  if (amount) return { kind: "amount", phrase: amount[0].replace(/\s+/g, " ").trim() };
  const dateToken = raw.match(
    /\b(?:today|tomorrow|yesterday|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/i
  );
  if (dateToken) return { kind: "date", phrase: dateToken[0] };
  return null;
}

export function missingEventQuestion(correction: BareCorrection): string {
  if (correction.kind === "time") return `Which event is at ${correction.phrase}?`;
  if (correction.kind === "date") return `Which event is on ${correction.phrase}?`;
  if (correction.kind === "place") return `Which event is at ${correction.phrase}?`;
  return `Which event is ${correction.phrase}?`;
}

export function hasEstablishedEvent(ctx: ConversationContext | null | undefined): boolean {
  if (!ctx) return false;
  return Boolean(ctx.event.subject) || ctx.open_proposals.length > 0;
}

export async function loadConversationContext(
  admin: Admin,
  sessionId: string,
  userId: string,
  timezone: string,
  today: Date = new Date()
): Promise<ConversationContext> {
  const empty: ConversationContext = {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: [],
    memory: emptyWorkingMemory(),
  };
  const { data: sessionRow } = await admin
    .from("sage_sessions")
    .select("title")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  const thread =
    sessionRow && typeof (sessionRow as { title?: unknown }).title === "string"
      ? (sessionRow as { title: string }).title.trim() || null
      : null;

  const { data: journals, error: journalErr } = await admin
    .from("sage_journal_messages")
    .select("sage_item_id")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .not("sage_item_id", "is", null);
  if (journalErr || !journals) {
    return { ...empty, thread_subject: thread };
  }
  const itemIds = [
    ...new Set(
      (journals as { sage_item_id?: string | null }[])
        .map((row) => row.sage_item_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  if (itemIds.length === 0) return { ...empty, thread_subject: thread };

  const { data: items, error: itemErr } = await admin
    .from("sage_items")
    .select("id, item_type, summary, evidence_excerpt, plan, tool_input, created_at")
    .in("id", itemIds)
    .eq("visible_to", userId)
    .order("created_at", { ascending: false });
  if (itemErr || !items) return { ...empty, thread_subject: thread };

  let subject: string | null = null;
  let child: string | null = null;
  let date: string | null = null;
  let time: string | null = null;
  let eventId: string | null = null;
  let recentDocument: OpenProposalContext["document"] = null;
  const open: OpenProposalContext[] = [];
  const memorySources: MemorySource[] = [];

  for (const row of items as {
    id?: string | null;
    item_type?: string | null;
    summary?: string | null;
    evidence_excerpt?: string | null;
    plan?: { proposals?: unknown[] } | null;
    tool_input?: {
      resolved_dates?: unknown;
      event_subject?: unknown;
      children?: unknown;
    } | null;
  }[]) {
    const proposals = Array.isArray(row.plan?.proposals) ? row.plan.proposals : [];
    memorySources.push({
      itemId: typeof row.id === "string" ? row.id : null,
      itemType: typeof row.item_type === "string" ? row.item_type : null,
      proposals,
    });
    if (!eventId) {
      const saved = savedEventPointer(proposals);
      if (saved) {
        eventId = saved.id;
        if (!time && saved.time) time = saved.time;
      }
    }
    const texts: string[] = [row.summary ?? "", row.evidence_excerpt ?? ""];
    const proposalTypes = proposals.map((raw) =>
      raw && typeof raw === "object" && typeof (raw as { type?: unknown }).type === "string"
        ? (raw as { type: string }).type
        : ""
    );
    const expenseOnly =
      proposalTypes.includes("log_expense") &&
      !proposalTypes.some((type) => type === "calendar_update" || type === "calendar");
    const documentOnly =
      proposalTypes.includes("log_document") &&
      !proposalTypes.some((type) => type === "calendar_update" || type === "calendar");
    const skipEventDate = expenseOnly || documentOnly;
    if (!skipEventDate && !date && row.tool_input && Array.isArray(row.tool_input.resolved_dates)) {
      for (const entry of row.tool_input.resolved_dates) {
        if (!entry || typeof entry !== "object") continue;
        const rec = entry as { status?: unknown; iso?: unknown };
        const iso = isoDate(rec.iso);
        if (rec.status === "resolved" && iso) {
          date = iso;
          break;
        }
      }
    }
    if (!child && Array.isArray(row.tool_input?.children)) {
      for (const entry of row.tool_input.children) {
        if (!entry || typeof entry !== "object") continue;
        const name = (entry as { name?: unknown }).name;
        if (typeof name === "string" && name.trim()) {
          child = name.trim();
          break;
        }
      }
    }
    const storedSubject =
      typeof row.tool_input?.event_subject === "string" ? row.tool_input.event_subject : "";
    for (const raw of proposals) {
      const snapshot = documentSnapshot(raw);
      if (!recentDocument && snapshot?.executed) recentDocument = snapshot.document;
      if (closed(raw)) continue;
      const text = liveText(raw);
      if (!text && !snapshot) continue;
      const type =
        raw && typeof raw === "object" && typeof (raw as { type?: unknown }).type === "string"
          ? (raw as { type: string }).type
          : "proposal";
      open.push({
        type,
        text: text || snapshot?.document.title || "Document",
        ...(snapshot && !snapshot.executed ? { document: snapshot.document } : {}),
      });
      texts.push(text);
      if (!skipEventDate && !date) {
        const stamped = isoDate((raw as { date?: unknown }).date);
        if (stamped) date = stamped;
      }
      if (!documentOnly && !time) {
        const minutes = parseClockMinutes(text);
        if (minutes != null) time = clockLabel(minutes);
      }
      if (!documentOnly && !child) child = childNamedIn(text);
    }
    if (!documentOnly) {
      subject = preferEventSubject(subject, resolveEventSubject(storedSubject, texts));
    }
    if (!skipEventDate && !date) {
      const blob = texts.filter(Boolean).join(" ");
      if (/\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b/i.test(blob)) {
        const resolved = resolveDate(blob, today, timezone, blob);
        if (resolved.status === "resolved" && resolved.iso) date = resolved.iso;
      }
    }
  }

  return {
    thread_subject: thread,
    event: { subject, child, date, time, eventId },
    open_proposals: preferDocumentProposals(open),
    ...(recentDocument ? { recent_document: recentDocument } : {}),
    memory: deriveWorkingMemory(memorySources),
  };
}

function preferDocumentProposals(open: OpenProposalContext[]): OpenProposalContext[] {
  const documents = open.filter((item) => item.type === "log_document" || item.type === "file_document");
  const others = open
    .filter((item) => item.type !== "log_document" && item.type !== "file_document")
    .slice(0, 6);
  return [...documents, ...others].slice(0, 12);
}

function documentSnapshot(raw: unknown): {
  executed: boolean;
  document: NonNullable<OpenProposalContext["document"]>;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const proposal = raw as {
    type?: unknown;
    executed?: unknown;
    key?: unknown;
    title?: unknown;
    description?: unknown;
    category?: unknown;
    visibility?: unknown;
    attached_file_name?: unknown;
    attached_document_id?: unknown;
    updatesExisting?: unknown;
    document_child_name?: unknown;
    document_child_id?: unknown;
  };
  if (proposal.type !== "log_document") return null;
  const visibility: "private" | "parents_only" | "family" =
    proposal.visibility === "private" ||
    proposal.visibility === "family" ||
    proposal.visibility === "parents_only"
      ? proposal.visibility
      : "parents_only";
  const document = {
    key: typeof proposal.key === "string" && proposal.key.trim() ? proposal.key : "pending-document",
    title:
      (typeof proposal.title === "string" && proposal.title.trim()) ||
      (typeof proposal.attached_file_name === "string" && proposal.attached_file_name.trim()) ||
      (typeof proposal.description === "string" && proposal.description.trim()) ||
      "",
    description: typeof proposal.description === "string" ? proposal.description : "",
    category: typeof proposal.category === "string" && proposal.category.trim() ? proposal.category : "other",
    visibility,
    childName: typeof proposal.document_child_name === "string" ? proposal.document_child_name : null,
    childId: typeof proposal.document_child_id === "string" ? proposal.document_child_id : null,
    fileName: typeof proposal.attached_file_name === "string" ? proposal.attached_file_name : null,
    documentId: typeof proposal.attached_document_id === "string" ? proposal.attached_document_id : null,
    requiresApproval: true as const,
    updatesExisting: proposal.updatesExisting === true,
  };
  if (!document.title && !document.description && !document.fileName && !document.documentId) return null;
  return { executed: proposal.executed === true, document };
}
