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

export function appointmentTitle(child: string | null, subject: string | null): string {
  const label = (subject ?? "").trim() || "Appointment";
  if (child?.trim()) return `${child.trim()} — ${label}`.slice(0, 120);
  return label.slice(0, 120);
}
