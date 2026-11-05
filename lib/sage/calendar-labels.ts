/**
 * Browser-safe calendar labels. No Supabase, no date resolver, no next/headers.
 * Client components may import this file. Server calendar retrieval stays in calendar-chat.ts.
 */

const CATEGORIES = new Set([
  "medical",
  "school",
  "extracurricular",
  "custody_exchange",
  "therapy",
  "other",
]);

export function calendarCategory(value: string | null | undefined): string | null {
  const key = (value ?? "").trim().toLowerCase();
  return CATEGORIES.has(key) ? key : null;
}

/** Family is the calendar form's default. Therapy uses the form's parents-only rule. */
export function visibilityForCategory(
  category: string | null
): "family" | "parents_only" {
  return category === "therapy" ? "parents_only" : "family";
}

const TRAILING_DATE =
  /,\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b.*/i;

/** Event titles name the event. They do not carry the word Draft or a trailing date. */
export function calendarEventTitle(raw: string): string {
  let title = raw.trim().replace(/^add to calendar:\s*/i, "");
  title = title.replace(/\bdraft\b/gi, " ");
  title = title.replace(TRAILING_DATE, "");
  title = title.replace(/\s+/g, " ").replace(/^[—–\-:,\s]+|[—–\-:,\s]+$/g, "").trim();
  return title.slice(0, 120);
}

export function appointmentTitle(child: string | null, subject: string | null): string {
  const label = calendarEventTitle(subject ?? "") || "Appointment";
  const who = (child ?? "").trim();
  if (who && who.toLowerCase() !== "draft") {
    return calendarEventTitle(`${who} — ${label}`).slice(0, 120) || label;
  }
  return label.slice(0, 120);
}
