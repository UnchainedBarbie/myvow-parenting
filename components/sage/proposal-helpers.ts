import type { AddEventFormInitialValues } from "@/components/calendar/add-event-form";
import type { SageItem, SageProposal } from "./proposal-types";

export function proposalTypeLabel(type: string): string {
  switch (type) {
    case "ask_clarification":
      return "Ask Co-Parent";
    case "reply_coparent":
      return "Reply to Co-Parent";
    case "calendar_update":
      return "Update calendar";
    case "log_expense":
      return "Log expense";
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
  return (
    p.type !== "note_only" &&
    p.approved !== true &&
    !isWaived(p) &&
    !isBlocked(p)
  );
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
        return (rec.iso as string).trim();
      }
    }
  }
  const dates = input?.dates;
  if (Array.isArray(dates)) {
    for (const d of dates) {
      if (!d || typeof d !== "object") continue;
      const val = (d as { value?: unknown }).value;
      if (isIsoDate(typeof val === "string" ? val : null)) return (val as string).trim();
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
  if (p.type !== "calendar_update") return false;
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
const SCHOOL_RE = /school|teacher|classroom|\bpta\b|parent-teacher/;
const ACTIVITY_RE = /soccer|practice|dance|sport|recital|\bgame\b|extracurricular/;
const CUSTODY_RE = /pickup|pick-up|drop.?off|custody|handoff|exchange|visitation/;

/** Map domain / provider / wording → calendar event_type. Never default to custody_exchange. */
export function inferCalendarEventType(
  item: SageItem,
  proposal?: SageProposal
): string {
  const domain = (item.domain ?? "").toLowerCase();
  const blob = eventCorpus(item, proposal);

  if (domain === "medical" || MEDICAL_RE.test(blob)) return "medical";
  if (domain === "school" || SCHOOL_RE.test(blob)) return "school";
  if (THERAPY_RE.test(blob)) return "therapy";
  if (ACTIVITY_RE.test(blob)) return "extracurricular";
  if (CUSTODY_RE.test(blob)) return "custody_exchange";
  return "other";
}

function eventKindLabel(
  item: SageItem,
  proposal: SageProposal | undefined,
  eventType: string
): string {
  const providers = namedValues(toolInputRecord(item), "providers");
  if (providers[0]) return toTitleCase(providers[0]);
  const blob = eventCorpus(item, proposal);
  if (/dentist|dental/.test(blob)) return "Dentist";
  if (/orthodont/.test(blob)) return "Orthodontist";
  if (/doctor|pediatric|physician/.test(blob)) return "Doctor";
  if (eventType === "medical") return "Medical appointment";
  if (eventType === "school") return "School";
  if (eventType === "therapy") return "Therapy";
  if (eventType === "extracurricular") return "Activity";
  if (eventType === "custody_exchange") return "Pickup change";
  return "Calendar event";
}

export function buildCalendarTitle(
  item: SageItem,
  proposal?: SageProposal
): string {
  const name = childNamesFromItem(item)[0]?.trim();
  const eventType = inferCalendarEventType(item, proposal);
  const kind = eventKindLabel(item, proposal, eventType);
  const title = name ? `${kind} – ${name}` : kind;
  return title.slice(0, 40);
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
