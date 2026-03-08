import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Match holiday_name (contains, case-insensitive) to key in extracted_breaks.breaks.
 * Order: more specific first (e.g. "Spring Break" before "Fall").
 */
function breakKeyFromHolidayName(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (lower.includes("spring break")) return "spring_break";
  if (lower.includes("thanksgiving")) return "thanksgiving_break";
  if (lower.includes("winter break") || lower.includes("christmas break")) return "winter_break";
  if (lower.includes("fall break")) return "fall_break";
  if (lower.includes("summer break")) return "summer_break";
  return null;
}

/**
 * POST /api/holiday-custody/resolve-dates
 * Body: { case_id }
 * 1. Fetches active school_calendars (deleted_at IS NULL).
 * 2. Fetches holiday_custody where is_relative = true AND start_date IS NULL.
 * 3. Matches holiday_name to breaks (contains: Spring Break, Thanksgiving, Winter/Christmas Break, Fall Break).
 * 4. Multiple calendars → use earliest start_date and latest end_date for that break.
 * 5. UPDATE holiday_custody SET start_date, end_date. Returns { resolved, unresolved }.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({})) as { case_id?: string };
    const case_id = typeof body.case_id === "string" ? body.case_id.trim() : null;
    if (!case_id) return NextResponse.json({ error: "Missing case_id" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: calendars } = await admin
      .from("school_calendars")
      .select("id, extracted_breaks")
      .eq("case_id", case_id)
      .is("deleted_at", null);

    const { data: relativeHolidays } = await admin
      .from("holiday_custody")
      .select("id, holiday_name")
      .eq("case_id", case_id)
      .is("deleted_at", null)
      .eq("is_relative", true)
      .is("start_date", null);

    if (!relativeHolidays?.length) {
      return NextResponse.json({ resolved: 0, unresolved: [] });
    }

    let resolved = 0;
    const unresolved: string[] = [];

    for (const row of relativeHolidays) {
      const holiday_name = (row.holiday_name as string) ?? "";
      const breakKey = breakKeyFromHolidayName(holiday_name);
      if (!breakKey) {
        unresolved.push(holiday_name);
        continue;
      }

      let bestStart: string | null = null;
      let bestEnd: string | null = null;

      for (const cal of calendars ?? []) {
        const extracted = cal.extracted_breaks as { breaks?: Record<string, { start?: string; end?: string } | null> } | null;
        const breaks = extracted?.breaks ?? {};
        const b = breaks[breakKey];
        if (!b || typeof b !== "object" || !b.start || !b.end) continue;
        const start = b.start.slice(0, 10);
        const end = b.end.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
        if (!bestStart || start < bestStart) bestStart = start;
        if (!bestEnd || end > bestEnd) bestEnd = end;
      }

      if (!bestStart || !bestEnd) {
        unresolved.push(holiday_name);
        continue;
      }

      const { error: updateErr } = await admin
        .from("holiday_custody")
        .update({
          start_date: bestStart,
          end_date: bestEnd,
        })
        .eq("id", row.id);

      if (!updateErr) resolved += 1;
    }

    return NextResponse.json({ resolved, unresolved });
  } catch (e) {
    console.error("[holiday-custody/resolve-dates]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Resolve failed" },
      { status: 500 }
    );
  }
}
