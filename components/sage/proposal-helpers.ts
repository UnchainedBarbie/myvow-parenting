import type { AddEventFormInitialValues } from "@/components/calendar/add-event-form";
import type { DocumentRow } from "@/components/documents/document-detail-modal";
import type { ExpenseFormInitialValues } from "@/components/expenses/expense-form";
import {
  inferExpenseCategoryFromText,
  mapExpenseCategoryFromClassify,
  parseExpenseAmountFromText,
} from "@/lib/expenses-share";
import { appointmentTitle, calendarCategory, visibilityForCategory } from "@/lib/sage/calendar-labels";
import { eventSubjectFromTexts, formatClockLabel } from "@/lib/sage/event-subject";
import { splitSchedule } from "@/lib/sage/outbound-facts";
import { isCalendarUpdateProposal, isFormExecuteProposal, isLogDocumentProposal } from "@/lib/sage/proposal-kind";
import { isSupersededProposal } from "@/lib/sage/proposal-lifecycle";
import type { SageItem, SageProposal } from "./proposal-types";

export {
  isCalendarUpdateProposal,
  isFormExecuteProposal,
  isLogExpenseProposal,
  isLogDocumentProposal,
} from "@/lib/sage/proposal-kind";

export function proposalTypeLabel(
  type: string,
  proposal?: {
    calendar_intent?: string | null;
    audience?: string | null;
    recipient_name?: string | null;
    recipient_email?: string | null;
  }
): string {
  switch (type) {
    case "ask_clarification":
      return proposal?.audience === "parent" ? "Ask you" : "Ask Co-Parent";
    case "reply_coparent":
      return proposal?.recipient_name || proposal?.recipient_email
        ? "Send message"
        : "Reply to Co-Parent";
    case "calendar_update":
      return proposal?.calendar_intent === "offer" ? "Add to calendar" : "Update calendar";
    case "expense":
    case "log_expense":
      return "Log expense";
    case "log_document":
    case "file_document":
      return "File document";
    case "force_expense":
      return "Log as expense";
    case "force_event":
      return "Add to calendar";
    case "force_document":
      return "File as document";
    case "note_only":
      return "Note";
    default:
      return type;
  }
}

export function childNamesFromItem(item: SageItem): string[] {
  const names: string[] = [];
  const input = item.tool_input;
  if (input && typeof input === "object" && input !== null) {
    const children = (input as { children?: unknown }).children;
    if (Array.isArray(children)) {
      for (const c of children) {
        if (c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string") {
          const name = ((c as { name: string }).name ?? "").trim();
          if (name) names.push(name);
        }
      }
    }
  }
  return names;
}

export function isWaived(p: SageProposal): boolean {
  const status = (p.status ?? "").toLowerCase();
  return status === "waived_by_user" || status === "canceled" || status === "cancelled";
}

export function isBlocked(p: SageProposal): boolean {
  return (
    p.depends_on != null &&
    String(p.depends_on).trim() !== "" &&
    p.unblocked !== true
  );
}

/** A calendar proposal is committed only when execute stored the event row id. */
export function isCommitted(p: SageProposal): boolean {
  if (isCalendarUpdateProposal(p.type)) {
    return (
      p.executed === true &&
      typeof p.result_event_id === "string" &&
      p.result_event_id.trim().length > 0
    );
  }
  return p.executed === true;
}

export function isActionable(p: SageProposal): boolean {
  if (p.type === "note_only" || isWaived(p) || isBlocked(p) || isSupersededProposal(p)) return false;
  if (isCalendarUpdateProposal(p.type)) return !isCommitted(p);
  if (p.executed === true) return false;
  // Calendar / expense stay actionable until the form actually creates the record.
  if (isFormExecuteProposal(p.type)) return true;
  return p.approved !== true;
}

/** "Sat, Oct 17" for a stored YYYY-MM-DD. Other strings are returned trimmed. */
export function formatCardDate(value: string): string {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value.trim();
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(dt);
}

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function toolInputRecord(
  item: SageItem | null | undefined
): Record<string, unknown> | null {
  const input = item?.tool_input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function namedValues(input: Record<string, unknown> | null, key: string): string[] {
  if (!input) return [];
  const raw = input[key];
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
      const name = ((entry as { name: string }).name ?? "").trim();
      if (name) names.push(name);
    }
  }
  return names;
}

/** Never prefill a calendar date in a prior year (invented ISO like 2024-09-15). */
function upcomingIso(iso: string): string {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso.trim();
  const y = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  const cd = now.getDate();
  if (y >= cy) return iso.trim();
  const thisYearStillUpcoming = month > cm || (month === cm && day >= cd);
  const year = thisYearStillUpcoming ? cy : cy + 1;
  return `${year}-${m[2]}-${m[3]}`;
}

/** First engine-resolved calendar date (YYYY-MM-DD), if any. */
export function resolvedCalendarIso(
  item: SageItem | null | undefined
): string | undefined {
  const input = toolInputRecord(item);
  const resolved = input?.resolved_dates;
  if (Array.isArray(resolved)) {
    for (const d of resolved) {
      if (!d || typeof d !== "object") continue;
      const rec = d as { status?: unknown; iso?: unknown };
      if (rec.status === "resolved" && isIsoDate(typeof rec.iso === "string" ? rec.iso : null)) {
        return upcomingIso((rec.iso as string).trim());
      }
    }
  }
  const dates = input?.dates;
  if (Array.isArray(dates)) {
    for (const d of dates) {
      if (!d || typeof d !== "object") continue;
      const val = (d as { value?: unknown }).value;
      if (isIsoDate(typeof val === "string" ? val : null)) {
        return upcomingIso((val as string).trim());
      }
    }
  }
  return undefined;
}

/**
 * Show the manual date field only when a calendar_update has no chosen_date
 * AND the engine did not already resolve a real date.
 * date_supplied is set only by the chat-fold path when it clears a gate.
 */
export function needsDateField(
  p: SageProposal,
  item?: SageItem | null
): boolean {
  const forceType = (p as SageProposal & { force_type?: unknown }).force_type;
  if (
    forceType === "expense" ||
    forceType === "event" ||
    forceType === "document"
  ) {
    return false;
  }
  if (isCalendarUpdateProposal(p.type)) return false;
  if (isLogDocumentProposal(p.type)) return false;
  if ((p.chosen_date ?? "").trim()) return false;
  if (resolvedCalendarIso(item)) return false;
  if (p.date_supplied === true) return false;
  return true;
}

/** Strip misleading "on YYYY-MM-DD" from drafts when the user must pick the date. */
export function displayDraft(p: SageProposal, showDateField: boolean): string {
  const source =
    typeof p.revised_text === "string" && p.revised_text.trim()
      ? p.revised_text.trim()
      : (p.draft ?? "").trim();
  let text = source;
  if (showDateField && !p.chosen_date) {
    text = text.replace(/\s+on\s+\d{4}-\d{2}-\d{2}/gi, "").trim();
  }
  return text;
}

export function canUndo(p: SageProposal): boolean {
  if (p.executed === true || isSupersededProposal(p)) return false;
  return p.approved === true || p.status === "waived_by_user";
}

export function isRevisable(p: SageProposal): boolean {
  return (
    (p.type === "reply_coparent" || p.type === "ask_clarification") &&
    isActionable(p)
  );
}

export function dateKey(itemId: string, index: number): string {
  return `${itemId}:${index}`;
}

/**
 * Extract the TARGET time from a schedule/pickup proposal draft (HH:MM 24h).
 * Prefers "to 5:30" / "from ... to ..."; avoids the "from" time. Returns undefined if unsure.
 */
export function parseTargetTimeFromDraft(draft: string): string | undefined {
  const text = draft.trim();
  if (!text) return undefined;

  type Hit = { h: number; min: string; ampm: string };

  const to24 = (hit: Hit, assumeAfternoonPm: boolean): string | undefined => {
    let h = hit.h;
    if (Number.isNaN(h) || h < 0 || h > 23) return undefined;
    const ampm = hit.ampm;
    if (ampm.startsWith("p")) {
      if (h < 12) h += 12;
    } else if (ampm.startsWith("a")) {
      if (h === 12) h = 0;
    } else if (h >= 1 && h <= 7 && assumeAfternoonPm) {
      // Ambiguous 1-7 in pickup/afternoon context -> PM
      h += 12;
    } else if (!ampm && h >= 1 && h <= 12) {
      // Ambiguous without meridian - don't guess
      return undefined;
    }
    if (h > 23) return undefined;
    return `${String(h).padStart(2, "0")}:${hit.min}`;
  };

  const pickupish =
    /pickup|pick-up|drop.?off|schedule|exchange|custody|afternoon/i.test(text);

  // "from 4:00 ... to 5:30 PM" - take the "to" time only
  const fromTo = text.match(
    /\bfrom\s+\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?\s+.*?to\s+(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/i
  );
  if (fromTo) {
    return to24(
      {
        h: parseInt(fromTo[1], 10),
        min: fromTo[2],
        ampm: (fromTo[3] ?? "").toLowerCase().replace(/\./g, ""),
      },
      pickupish
    );
  }

  // "to 5:30" / "to 5:30 PM"
  const toOnly = text.match(
    /\bto\s+(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/i
  );
  if (toOnly) {
    return to24(
      {
        h: parseInt(toOnly[1], 10),
        min: toOnly[2],
        ampm: (toOnly[3] ?? "").toLowerCase().replace(/\./g, ""),
      },
      pickupish
    );
  }

  // Explicit times with AM/PM - prefer the last one (often the target)
  const withMeridian = [
    ...text.matchAll(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)\b/gi),
  ];
  if (withMeridian.length > 0) {
    const last = withMeridian[withMeridian.length - 1];
    return to24(
      {
        h: parseInt(last[1], 10),
        min: last[2],
        ampm: (last[3] ?? "").toLowerCase().replace(/\./g, ""),
      },
      false
    );
  }

  // "2pm" / "2 PM" without minutes
  const hourMeridian = [...text.matchAll(/\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b/gi)];
  if (hourMeridian.length > 0) {
    const last = hourMeridian[hourMeridian.length - 1];
    return to24(
      {
        h: parseInt(last[1], 10),
        min: "00",
        ampm: (last[2] ?? "").toLowerCase().replace(/\./g, ""),
      },
      false
    );
  }

  // Single bare time only if pickup context allows afternoon PM heuristic
  const bare = [...text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)];
  if (bare.length === 1 && pickupish) {
    return to24(
      { h: parseInt(bare[0][1], 10), min: bare[0][2], ampm: "" },
      true
    );
  }

  return undefined;
}

function toTitleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ")
    .trim();
}

function eventCorpus(item: SageItem, proposal?: SageProposal): string {
  const input = toolInputRecord(item);
  const draft =
    (typeof proposal?.revised_text === "string" && proposal.revised_text.trim()
      ? proposal.revised_text
      : proposal?.draft) ?? "";
  return [
    item.summary ?? "",
    item.domain ?? "",
    item.item_type ?? "",
    draft,
    namedValues(input, "providers").join(" "),
    namedValues(input, "merchants").join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

const MEDICAL_RE =
  /dentist|dental|orthodont|doctor|pediatric|physician|clinic|hospital|checkup|vaccine|medical|optometr|ophthalm/;
const THERAPY_RE = /therap|counsel/;
const SCHOOL_RE =
  /school|teacher|classroom|\bpta\b|parent-?teacher|\bconference\b/;
const ACTIVITY_RE =
  /concert|choir|music|\bband\b|recital|rehearsal|tournament|soccer|practice|dance|\bsports?\b|\bgame\b|extracurricular|lesson/;
const CUSTODY_RE = /pickup|pick-up|drop.?off|custody|handoff|exchange|visitation/;

/** Map domain / provider / wording -> calendar event_type. Never default to custody_exchange. */
export function inferCalendarEventType(
  item: SageItem,
  proposal?: SageProposal
): string {
  const domain = (item.domain ?? "").toLowerCase();
  const blob = eventCorpus(item, proposal);

  if (domain === "medical" || MEDICAL_RE.test(blob)) return "medical";
  if (ACTIVITY_RE.test(blob)) return "extracurricular";
  if (domain === "school" || SCHOOL_RE.test(blob)) return "school";
  if (THERAPY_RE.test(blob)) return "therapy";
  if (CUSTODY_RE.test(blob)) return "custody_exchange";
  return "other";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pull the actual event name from the understood request (e.g. "choir concert").
 * Returns null when nothing extractable - caller falls back to "Calendar event".
 */
export function extractEventName(
  item: SageItem,
  proposal?: SageProposal
): string | null {
  const childNames = childNamesFromItem(item);
  const providers = namedValues(toolInputRecord(item), "providers");
  const draft =
    (typeof proposal?.revised_text === "string" && proposal.revised_text.trim()
      ? proposal.revised_text
      : proposal?.draft) ?? "";
  const texts = [item.summary ?? "", draft].filter((t) => t.trim());

  for (const text of texts) {
    const extracted = eventNameFromText(text, childNames);
    if (extracted) return extracted;
  }

  if (providers[0]) return toTitleCase(providers[0]);

  const blob = eventCorpus(item, proposal);
  if (/dentist|dental/.test(blob)) return "Dentist";
  if (/orthodont/.test(blob)) return "Orthodontist";
  if (/doctor|pediatric|physician/.test(blob)) return "Doctor";
  return null;
}

function eventNameFromText(text: string, childNames: string[]): string | null {
  let s = text.trim();
  if (!s) return null;

  s = s.replace(/\b(at|@)\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?/gi, " ");
  s = s.replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, " ");
  s = s.replace(/\bon\s+\d{4}-\d{2}-\d{2}\b/gi, " ");
  s = s.replace(/\bon\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/gi, " ");
  s = s.replace(
    /\bon\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/gi,
    " "
  );
  s = s.replace(/\b(?:to|on|in)\s+your\s+calendar\b/gi, " ");
  s = s.replace(/\bcalendar\s+event\b/gi, " ");

  for (const n of childNames) {
    const e = escapeRegExp(n);
    s = s.replace(new RegExp(`\\b${e}(?:'s)?\\b`, "gi"), " ");
  }

  s = s.replace(
    /\b(you[']d like to|you would like to|please|create|add|schedule|make|put|set up|include)\b/gi,
    " "
  );
  s = s.replace(
    /\b(a|an|the|your|their|this|that|for|to|from|with|about)\b/gi,
    " "
  );
  s = s.replace(/\b(event|appointment|calendar)\b/gi, " ");
  s = s.replace(/[.,;:!?]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  if (s.length < 3) return null;
  if (/^(other|update|change|item|something)$/i.test(s)) return null;
  return toTitleCase(s);
}

function displayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (trimmed === trimmed.toLowerCase()) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
  return trimmed;
}

function storedEventSubject(item: SageItem): string | null {
  const subject = toolInputRecord(item)?.event_subject;
  return typeof subject === "string" && subject.trim() ? subject.trim() : null;
}

export function buildCalendarTitle(
  item: SageItem,
  proposal?: SageProposal
): string {
  const proposed = typeof proposal?.title === "string" ? proposal.title.trim() : "";
  if (proposed) return proposed.slice(0, 120);
  const name = displayName(childNamesFromItem(item)[0] ?? "");
  const eventName =
    storedEventSubject(item) ||
    eventSubjectFromTexts([item.evidence_excerpt ?? ""]) ||
    eventSubjectFromTexts([item.summary ?? ""]) ||
    "Calendar event";
  return appointmentTitle(name || null, eventName).slice(0, 120);
}

function hhmmField(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

function childOnProposal(item: SageItem, text: string): string {
  const named = displayName(childNamesFromItem(item)[0] ?? "");
  if (named) return named;
  const match = text.match(/\b([A-Za-z][a-z]{1,20})'s\b/);
  if (!match) return "";
  if (/^(it|that|there|what|let|here|she|he|we|who)$/i.test(match[1])) return "";
  return displayName(match[1]);
}

/** Arrival and pickup are details. They are not the event start or the event end. */
function detailLines(child: string, arrival: string | null, pickup: string | null): string {
  const lines: string[] = [];
  if (arrival) {
    const when = formatClockLabel(arrival);
    lines.push(child ? `${child} needs to be there by ${when}.` : `Needs to be there by ${when}.`);
  }
  if (pickup) {
    lines.push(`Pickup at ${formatClockLabel(pickup)}.`);
  }
  return lines.join(" ");
}

export function buildCalendarInitialValues(
  item: SageItem,
  proposal: SageProposal,
  chosenDate?: string
): AddEventFormInitialValues {
  const childId =
    Array.isArray(item.child_ids) && item.child_ids[0]
      ? item.child_ids[0]
      : undefined;
  const draftSource =
    (typeof proposal.revised_text === "string" && proposal.revised_text.trim()
      ? proposal.revised_text
      : proposal.draft) ?? "";
  const summary = (item.summary ?? "").trim();
  const date =
    (chosenDate ?? proposal.chosen_date ?? proposal.date ?? resolvedCalendarIso(item) ?? "").trim() ||
    undefined;
  const blob = [draftSource, item.evidence_excerpt ?? "", summary].filter(Boolean).join("\n");
  const carried = {
    start: hhmmField(proposal.event_start),
    arrival: hhmmField(proposal.arrival_time),
    pickup: hhmmField(proposal.pickup_time),
  };
  const parsed =
    carried.start || carried.arrival || carried.pickup ? carried : splitSchedule(blob);
  const startTime = parsed.start ?? undefined;
  const titled = buildCalendarTitle(item, proposal);
  const storedCategory = calendarCategory(proposal.category);
  const eventType = storedCategory ?? inferCalendarEventType(item, proposal);
  const visibility = visibilityForCategory(eventType);
  const details = detailLines(
    childOnProposal(item, blob),
    parsed.arrival,
    parsed.pickup
  );
  const proposedDescription =
    typeof proposal.description === "string" ? proposal.description.trim() : "";
  const description = [proposedDescription, details].filter(Boolean).join("\n");
  const kidVisible = visibility === "family";
  return {
    childId,
    date,
    ...(startTime ? { startTime } : {}),
    ...(proposal.all_day ? { allDay: true } : {}),
    title: titled,
    eventType,
    visibility,
    description,
    ...(kidVisible ? { kidTitle: titled } : {}),
    ...(proposal.event_status ? { eventStatus: proposal.event_status } : {}),
    ...(proposal.calendar_event_id
      ? { eventId: proposal.calendar_event_id }
      : {}),
  };
}

function amountFromToolInput(item: SageItem): number | undefined {
  const input = toolInputRecord(item);
  const amounts = input?.amounts;
  if (Array.isArray(amounts)) {
    for (const entry of amounts) {
      if (!entry || typeof entry !== "object") continue;
      const value = (entry as { value?: unknown }).value;
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const stored = input?.amount;
  const storedN = typeof stored === "number" ? stored : Number(stored);
  if (Number.isFinite(storedN) && storedN > 0) return storedN;
  return undefined;
}

/** First engine-resolved date (YYYY-MM-DD) as stored - no roll-forward. */
function resolvedExpenseIso(item: SageItem | null | undefined): string | undefined {
  const input = toolInputRecord(item);
  const resolved = input?.resolved_dates;
  if (Array.isArray(resolved)) {
    for (const d of resolved) {
      if (!d || typeof d !== "object") continue;
      const rec = d as { status?: unknown; iso?: unknown };
      if (rec.status === "resolved" && isIsoDate(typeof rec.iso === "string" ? rec.iso : null)) {
        return (rec.iso as string).trim();
      }
    }
  }
  const dates = input?.dates;
  if (Array.isArray(dates)) {
    for (const d of dates) {
      if (!d || typeof d !== "object") continue;
      const val = (d as { value?: unknown }).value;
      if (isIsoDate(typeof val === "string" ? val : null)) {
        return (val as string).trim();
      }
    }
  }
  return undefined;
}

function inferExpenseCategory(item: SageItem, proposal?: SageProposal): string {
  const proposed = mapExpenseCategoryFromClassify(proposal?.category);
  if (typeof proposal?.category === "string" && proposal.category.trim() && proposed !== "other") {
    return proposed;
  }
  const stored = toolInputRecord(item)?.expense_category;
  if (typeof stored === "string" && stored.trim()) {
    return stored.trim().toLowerCase();
  }
  return inferExpenseCategoryFromText(eventCorpus(item, proposal), item.domain);
}

function expenseDescriptionFromText(text: string): string | null {
  let s = text.trim();
  if (!s) return null;
  s = s.replace(/\$\s*\d[\d,]*(?:\.\d{1,2})?/g, " ");
  s = s.replace(/\b\d+(?:\.\d{1,2})?\s*(?:dollars?|usd)\b/gi, " ");
  s = s.replace(/\b(at|@)\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?/gi, " ");
  s = s.replace(/\bon\s+\d{4}-\d{2}-\d{2}\b/gi, " ");
  s = s.replace(/\bon\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/gi, " ");
  s = s.replace(
    /\bon\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?/gi,
    " "
  );
  s = s.replace(
    /\b(you[']d like to|you would like to|please|create|add|log|record|submit|propose logging expense from co-parent)\b/gi,
    " "
  );
  s = s.replace(/\b(a|an|the|this|that)\s+(expense|receipt)\b/gi, " ");
  s = s.replace(/\b(expense|receipt)\b/gi, " ");
  s = s.replace(/[.,;:!?]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^(for|from|to)\s+/i, "").trim();
  if (s.length < 3) return null;
  return toTitleCase(s).slice(0, 80);
}

export function buildExpenseInitialValues(
  item: SageItem,
  proposal: SageProposal,
  chosenDate?: string
): ExpenseFormInitialValues {
  const childIds = Array.isArray(item.child_ids)
    ? item.child_ids.filter((id): id is string => typeof id === "string" && !!id)
    : [];
  const childId = childIds[0];
  const draftSource =
    (typeof proposal.revised_text === "string" && proposal.revised_text.trim()
      ? proposal.revised_text
      : proposal.draft) ?? "";
  const summary = (item.summary ?? "").trim();
  const blob = [summary, draftSource].filter(Boolean).join(" ");
  const proposalAmount =
    typeof proposal.amount === "number" && proposal.amount > 0 ? proposal.amount : undefined;
  const amount = proposalAmount ?? amountFromToolInput(item) ?? parseExpenseAmountFromText(blob);
  const proposedDescription =
    typeof proposal.description === "string" ? proposal.description.trim() : "";
  const description =
    proposedDescription ||
    expenseDescriptionFromText(summary) ||
    expenseDescriptionFromText(draftSource) ||
    namedValues(toolInputRecord(item), "providers")[0] ||
    namedValues(toolInputRecord(item), "merchants")[0] ||
    "Expense";
  const proposalDate = isIsoDate(typeof proposal.date === "string" ? proposal.date : null)
    ? proposal.date?.trim()
    : "";
  const date =
    (chosenDate ?? proposal.chosen_date ?? proposalDate ?? resolvedExpenseIso(item) ?? "").trim() ||
    undefined;
  const attachedFile = attachedFileFrom(item, proposal);
  return {
    description: toTitleCase(description).slice(0, 80),
    ...(amount != null ? { amount } : {}),
    incurredDate: date,
    category: inferExpenseCategory(item, proposal),
    ...(proposal.split_review?.trim() ? { splitReview: proposal.split_review.trim() } : {}),
    ...(proposal.paid_by === "coparent" ? { paidBy: "coparent" as const } : {}),
    ...(childId ? { childId } : {}),
    ...(childIds.length > 0 ? { childIds } : {}),
    ...(attachedFile ? { attachedFile } : {}),
  };
}

function attachedFileFrom(
  item: SageItem,
  proposal: SageProposal
): ExpenseFormInitialValues["attachedFile"] {
  const input = toolInputRecord(item);
  const fromProposal =
    typeof proposal.attached_document_id === "string"
      ? proposal.attached_document_id.trim()
      : "";
  const fromInput =
    typeof input?.attached_document_id === "string"
      ? input.attached_document_id.trim()
      : "";
  const document_id = fromProposal || fromInput;
  if (!document_id) return undefined;
  const file_name =
    (typeof proposal.attached_file_name === "string" &&
      proposal.attached_file_name.trim()) ||
    (typeof input?.attached_file_name === "string" &&
      input.attached_file_name.trim()) ||
    "Receipt";
  const url =
    (typeof proposal.attached_file_url === "string" &&
      proposal.attached_file_url.trim()) ||
    (typeof input?.attached_file_url === "string" &&
      input.attached_file_url.trim()) ||
    `/api/documents/${document_id}/download`;
  return { document_id, file_name, url };
}

const VAULT_DOCUMENT_CATEGORIES = new Set([
  "court_order",
  "school",
  "medical",
  "expenses",
  "therapy",
  "legal",
  "custody",
  "photos",
  "communication",
  "incident",
  "other",
]);

function mapDocumentCategory(raw?: string | null): string {
  const c = (raw ?? "").trim().toLowerCase();
  if (VAULT_DOCUMENT_CATEGORIES.has(c)) return c;
  if (
    c === "parenting_plan" ||
    c === "modification" ||
    c === "custody_order" ||
    c === "restraining_order"
  ) {
    return "court_order";
  }
  if (c === "financial_order") return "expenses";
  return "other";
}

/** Prefill the document review modal from classify + the already-uploaded file. */
export function buildDocumentReviewRow(
  item: SageItem,
  proposal: SageProposal
): DocumentRow | null {
  const attached = attachedFileFrom(item, proposal);
  if (!attached) return null;
  const input = toolInputRecord(item);
  const classify =
    input?.classify && typeof input.classify === "object" && input.classify !== null
      ? (input.classify as Record<string, unknown>)
      : null;
  const title =
    (typeof proposal.title === "string" && proposal.title.trim()) ||
    (typeof classify?.title === "string" && classify.title.trim()) ||
    attached.file_name;
  const description =
    (typeof proposal.description === "string" && proposal.description.trim()) ||
    (typeof classify?.description === "string" && classify.description.trim()) ||
    "";
  const category = mapDocumentCategory(
    (typeof proposal.category === "string" && proposal.category) ||
      (typeof classify?.category === "string" && classify.category) ||
      null
  );
  const visibilityRaw =
    typeof input?.visibility === "string" ? input.visibility.trim() : "";
  const visibility =
    visibilityRaw === "private" || visibilityRaw === "family"
      ? visibilityRaw
      : "parents_only";
  const childIds = Array.isArray(item.child_ids)
    ? item.child_ids.filter((id): id is string => typeof id === "string" && !!id)
    : [];
  return {
    id: attached.document_id,
    title,
    file_name: attached.file_name,
    file_size_bytes: null,
    mime_type: null,
    category,
    child_id: childIds[0] ?? null,
    child_ids: childIds,
    child_name: childNamesFromItem(item)[0] ?? null,
    description,
    created_at: item.created_at,
    visibility,
    related_comm_id: null,
  };
}

/** Hide executed File-document cards - the chat confirmation is the resolved UI. */
export function hasVisibleProposalCards(proposals: SageProposal[]): boolean {
  return proposals.some(
    (p) => !(isLogDocumentProposal(p.type) && p.executed === true)
  );
}
