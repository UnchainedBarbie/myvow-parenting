import type { AddEventFormInitialValues } from "@/components/calendar/add-event-form";
import type { ExpenseFormInitialValues } from "@/components/expenses/expense-form";
import {
  inferExpenseCategoryFromText,
  parseExpenseAmountFromText,
} from "@/lib/expenses-share";
import { isCalendarUpdateProposal, isFormExecuteProposal, isLogDocumentProposal } from "@/lib/sage/proposal-kind";
import type { SageItem, SageProposal } from "./proposal-types";

export {
  isCalendarUpdateProposal,
  isFormExecuteProposal,
  isLogExpenseProposal,
  isLogDocumentProposal,
} from "@/lib/sage/proposal-kind";

export function proposalTypeLabel(type: string): string {
  switch (type) {
    case "ask_clarification":
      return "Ask Co-Parent";
    case "reply_coparent":
      return "Reply to Co-Parent";
    case "calendar_update":
      return "Update calendar";
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
  return p.status === "waived_by_user";
}

export function isBlocked(p: SageProposal): boolean {
  return (
    p.depends_on != null &&
    String(p.depends_on).trim() !== "" &&
    p.unblocked !== true
  );
}

export function isActionable(p: SageProposal): boolean {
  if (p.type === "note_only" || isWaived(p) || isBlocked(p)) return false;
  if (p.executed === true) return false;
  // Calendar / expense stay actionable until the form actually creates the record.
  if (isFormExecuteProposal(p.type)) return true;
  return p.approved !== true;
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
  if (p.executed === true) return false;
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
 * Prefers "to 5:30" / "from … to …"; avoids the "from" time. Returns undefined if unsure.
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
      // Ambiguous 1–7 in pickup/afternoon context → PM
      h += 12;
    } else if (!ampm && h >= 1 && h <= 12) {
      // Ambiguous without meridian — don't guess
      return undefined;
    }
    if (h > 23) return undefined;
    return `${String(h).padStart(2, "0")}:${hit.min}`;
  };

  const pickupish =
    /pickup|pick-up|drop.?off|schedule|exchange|custody|afternoon/i.test(text);

  // "from 4:00 … to 5:30 PM" — take the "to" time only
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

  // Explicit times with AM/PM — prefer the last one (often the target)
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

/** Map domain / provider / wording → calendar event_type. Never default to custody_exchange. */
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
 * Returns null when nothing extractable — caller falls back to "Calendar event".
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
    /\b(you['’]d like to|you would like to|please|create|add|schedule|make|put|set up|include)\b/gi,
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

export function buildCalendarTitle(
  item: SageItem,
  proposal?: SageProposal
): string {
  const name = childNamesFromItem(item)[0]?.trim();
  const eventName = extractEventName(item, proposal) ?? "Calendar event";
  const title = name ? `${eventName} – ${name}` : eventName;
  return title.slice(0, 60);
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
    (chosenDate ?? proposal.chosen_date ?? resolvedCalendarIso(item) ?? "").trim() ||
    undefined;
  const startTime = parseTargetTimeFromDraft(
    [draftSource, summary].filter(Boolean).join(" ")
  );
  const eventType = inferCalendarEventType(item, proposal);
  return {
    childId,
    date,
    ...(startTime ? { startTime } : {}),
    title: buildCalendarTitle(item, proposal),
    eventType,
    description: summary || undefined,
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

/** First engine-resolved date (YYYY-MM-DD) as stored — no roll-forward. */
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
    /\b(you['’]d like to|you would like to|please|create|add|log|record|submit|propose logging expense from co-parent)\b/gi,
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
  const childId =
    Array.isArray(item.child_ids) && item.child_ids[0]
      ? item.child_ids[0]
      : undefined;
  const draftSource =
    (typeof proposal.revised_text === "string" && proposal.revised_text.trim()
      ? proposal.revised_text
      : proposal.draft) ?? "";
  const summary = (item.summary ?? "").trim();
  const blob = [summary, draftSource].filter(Boolean).join(" ");
  const amount =
    amountFromToolInput(item) ?? parseExpenseAmountFromText(blob);
  const description =
    expenseDescriptionFromText(summary) ??
    expenseDescriptionFromText(draftSource) ??
    namedValues(toolInputRecord(item), "providers")[0] ??
    namedValues(toolInputRecord(item), "merchants")[0] ??
    "Expense";
  const date =
    (chosenDate ?? proposal.chosen_date ?? resolvedExpenseIso(item) ?? "").trim() ||
    undefined;
  const attachedFile = attachedFileFrom(item, proposal);
  return {
    description: toTitleCase(description).slice(0, 80),
    ...(amount != null ? { amount } : {}),
    incurredDate: date,
    category: inferExpenseCategory(item, proposal),
    childId,
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
