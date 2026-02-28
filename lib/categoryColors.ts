/**
 * Shared category color palette for Calendar (event_type) and Documents (category).
 * Single source of truth: add or change colors here only.
 */

export type CategoryColorClasses = {
  stripeClass: string;
  pillBgClass: string;
  pillTextClass: string;
  dotClass: string;
  /** Calendar event block background (slightly stronger tint than pill). */
  calendarBgClass: string;
};

/** Color family definitions (same hex palette as Calendar). */
const COLOR_FAMILIES: Record<string, CategoryColorClasses> = {
  blue: {
    stripeClass: "border-l-[#7BA3C9]",
    pillBgClass: "bg-[#7BA3C9]/10",
    pillTextClass: "text-[#5a7a99]",
    dotClass: "bg-[#7BA3C9]",
    calendarBgClass: "bg-[#7BA3C9]/15",
  },
  sage: {
    stripeClass: "border-l-[#7B9E87]",
    pillBgClass: "bg-[#7B9E87]/10",
    pillTextClass: "text-[#5a735a]",
    dotClass: "bg-[#7B9E87]",
    calendarBgClass: "bg-[#7B9E87]/15",
  },
  purple: {
    stripeClass: "border-l-[#9B8EC4]",
    pillBgClass: "bg-[#9B8EC4]/10",
    pillTextClass: "text-[#6b6a9a]",
    dotClass: "bg-[#9B8EC4]",
    calendarBgClass: "bg-[#9B8EC4]/15",
  },
  gold: {
    stripeClass: "border-l-[#C9A97B]",
    pillBgClass: "bg-[#C9A97B]/12",
    pillTextClass: "text-[#9a7d5a]",
    dotClass: "bg-[#C9A97B]",
    calendarBgClass: "bg-[#C9A97B]/20",
  },
  teal: {
    stripeClass: "border-l-[#7BC9B5]",
    pillBgClass: "bg-[#7BC9B5]/12",
    pillTextClass: "text-[#5a9a8a]",
    dotClass: "bg-[#7BC9B5]",
    calendarBgClass: "bg-[#7BC9B5]/20",
  },
  rose: {
    stripeClass: "border-l-[#C97B7B]",
    pillBgClass: "bg-[#C97B7B]/10",
    pillTextClass: "text-[#9a5a5a]",
    dotClass: "bg-[#C97B7B]",
    calendarBgClass: "bg-[#C97B7B]/15",
  },
  other: {
    stripeClass: "border-l-gray-300",
    pillBgClass: "bg-gray-100",
    pillTextClass: "text-gray-700",
    dotClass: "bg-gray-400",
    calendarBgClass: "bg-gray-100",
  },
};

/**
 * Maps category key (calendar event_type or document category) to color family.
 * Add new categories here to assign a color; unknown keys fall back to "other".
 */
const CATEGORY_TO_FAMILY: Record<string, keyof typeof COLOR_FAMILIES> = {
  // Calendar event_type
  medical: "blue",
  school: "sage",
  extracurricular: "purple",
  custody_exchange: "gold",
  therapy: "teal",
  missed_visit: "rose",
  conflict: "rose",
  other: "other",
  // Document category (align with calendar where overlapping)
  court_order: "gold",
  legal: "gold",
  custody: "gold",
  expenses: "sage",
  financial: "sage",
  messages: "purple",
  communication: "purple",
  photos: "purple",
  incident: "rose",
};

const DEFAULT_FAMILY = "other";

/**
 * Returns Tailwind classes for stripe, pill, and dot for a category.
 * Use for Documents table (left stripe + category pill) and Calendar (bg + dot).
 * Unknown or null/undefined category returns "other" (neutral gray).
 */
export function getCategoryColor(
  category: string | null | undefined
): CategoryColorClasses {
  const key =
    category != null && String(category).trim() !== ""
      ? String(category).toLowerCase()
      : null;
  const family = key ? CATEGORY_TO_FAMILY[key] ?? DEFAULT_FAMILY : DEFAULT_FAMILY;
  return COLOR_FAMILIES[family];
}

/**
 * Calendar backward compatibility: returns { bg, dot } for event blocks.
 * Same palette as getCategoryColor (bg = light tint, dot = solid).
 */
export function getCalendarEventColors(
  eventType: string | null | undefined
): { bg: string; dot: string } {
  const c = getCategoryColor(eventType);
  return { bg: c.calendarBgClass, dot: c.dotClass };
}
