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

/** Calendar updates always need an explicit chosen_date before Agree — don't suppress via unrelated resolved_dates. */
export function needsDateField(p: SageProposal): boolean {
  return p.type === "calendar_update" && !p.chosen_date;
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

export function buildCalendarTitle(item: SageItem): string {
  const names = childNamesFromItem(item);
  const name = names[0]?.trim();
  const base = "Pickup change";
  if (!name) return base;
  return `${base} – ${name}`.slice(0, 40);
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
    (chosenDate ?? proposal.chosen_date ?? "").trim() || undefined;
  const startTime = parseTargetTimeFromDraft(
    [draftSource, summary].filter(Boolean).join(" ")
  );
  return {
    childId,
    date,
    ...(startTime ? { startTime } : {}),
    title: buildCalendarTitle(item),
    eventType: "custody_exchange",
    description: summary || undefined,
  };
}
