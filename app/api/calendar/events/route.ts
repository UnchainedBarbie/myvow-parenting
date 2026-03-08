import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/** CalendarEventRow shape returned by this API (matches components/calendar/calendar-month.tsx). */
export type CalendarEventRow = {
  id: string;
  title: string;
  description: string | null;
  event_type: string | null;
  child_id: string | null;
  child_name: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  status: string | null;
  isPrivate: boolean;
  isMine: boolean;
  created_at: string;
  created_by_name: string | null;
  recurring_rule?: string | null;
  visibility?: "family" | "parents_only" | "just_me_and_kids" | "private" | "family_read_only" | null;
  kid_title?: string | null;
  is_system?: boolean;
};

/**
 * GET /api/calendar/events?start=ISO&end=ISO
 * Returns calendar_events for the case in the date range, merged with auto-generated birthday events from children.date_of_birth.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");
    if (!startParam || !endParam) {
      return NextResponse.json(
        { error: "Query params start and end (ISO date strings) are required" },
        { status: 400 }
      );
    }

    const start = new Date(startParam);
    const end = new Date(endParam);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid start or end date" }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const caseId = membership?.case_id ?? null;
    if (!caseId) {
      return NextResponse.json({ error: "No case found" }, { status: 403 });
    }

    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const { data: eventsRaw } = await admin
      .from("calendar_events")
      .select(
        "id, title, description, event_type, child_id, start_time, end_time, all_day, status, visibility, kid_title, created_by, created_at, recurring_rule, deleted_at"
      )
      .eq("case_id", caseId)
      .gte("start_time", startIso)
      .lte("start_time", endIso)
      .is("deleted_at", null)
      .order("start_time", { ascending: true });

    const childIds = Array.from(
      new Set((eventsRaw ?? []).map((e) => e.child_id).filter(Boolean))
    ) as string[];
    const { data: childRows } =
      childIds.length > 0
        ? await admin.from("children").select("id, first_name, profile_image").in("id", childIds)
        : { data: [] };
    const childMap = (childRows ?? []).reduce(
      (acc, c) => {
        acc[c.id] = {
          first_name: c.first_name as string,
          profile_image: (c.profile_image as string | null) ?? null,
        };
        return acc;
      },
      {} as Record<string, { first_name: string; profile_image: string | null }>
    );

    const creatorIds = Array.from(
      new Set((eventsRaw ?? []).map((e) => e.created_by).filter(Boolean))
    ) as string[];
    const { data: creatorRows } =
      creatorIds.length > 0
        ? await admin.from("users").select("id, full_name").in("id", creatorIds)
        : { data: [] };
    const creatorMap = (creatorRows ?? []).reduce(
      (acc, u) => {
        acc[u.id] = u.full_name;
        return acc;
      },
      {} as Record<string, string>
    );

    const events: CalendarEventRow[] = (eventsRaw ?? [])
      .filter((e) => {
        const visibility = (e as { visibility?: string }).visibility;
        const legacyPrivate = e.description?.startsWith("[PRIVATE]") ?? false;
        if (visibility === "private") return e.created_by === user.id;
        if (visibility === "just_me_and_kids") return e.created_by === user.id;
        if (!visibility && legacyPrivate) return e.created_by === user.id;
        return true;
      })
      .map((e) => {
        const visibility = (e as { visibility?: string }).visibility as
          | "family"
          | "parents_only"
          | "just_me_and_kids"
          | "private"
          | "family_read_only"
          | null
          | undefined;
        const legacyPrivate = e.description?.startsWith("[PRIVATE]") ?? false;
        const isPrivate =
          visibility === "private" || (!visibility && legacyPrivate);
        const desc =
          !visibility && legacyPrivate
            ? e.description?.replace(/^\[PRIVATE\]\s*/, "") ?? null
            : e.description;
        return {
          id: e.id,
          title: e.title,
          description: desc,
          event_type: e.event_type,
          child_id: e.child_id,
          child_name: e.child_id ? childMap[e.child_id]?.first_name ?? null : null,
          start_time: e.start_time,
          end_time: e.end_time,
          all_day: e.all_day ?? false,
          status: (e as { status?: string }).status ?? null,
          isPrivate,
          isMine: e.created_by === user.id,
          created_at: e.created_at,
          created_by_name: creatorMap[e.created_by] ?? null,
          recurring_rule: e.recurring_rule ?? null,
          visibility: visibility ?? null,
          kid_title: (e as { kid_title?: string }).kid_title ?? null,
        };
      });

    const { data: childrenWithDob } = await admin
      .from("children")
      .select("id, first_name, date_of_birth")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .not("date_of_birth", "is", null);

    const startYear = start.getUTCFullYear();
    const endYear = end.getUTCFullYear();

    for (const child of childrenWithDob ?? []) {
      const dob = child.date_of_birth as string;
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
      if (!match) continue;
      const [, , mm, dd] = match;
      const first_name = (child.first_name as string) ?? "Child";

      for (let year = startYear; year <= endYear; year++) {
        const startTime = `${year}-${mm}-${dd}T00:00:00.000Z`;
        const endTime = `${year}-${mm}-${dd}T23:59:59.999Z`;
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        if (endDate < start || startDate > end) continue;

        const birthdayRow: CalendarEventRow = {
          id: `birthday-${child.id}-${year}`,
          title: `🎂 ${first_name}'s Birthday`,
          description: null,
          event_type: "birthday",
          child_id: child.id,
          child_name: first_name,
          start_time: startTime,
          end_time: endTime,
          all_day: true,
          status: null,
          isPrivate: false,
          isMine: false,
          created_at: startTime,
          created_by_name: null,
          recurring_rule: null,
          visibility: "family",
          kid_title: `🎂 ${first_name}'s Birthday`,
          is_system: true,
        };
        events.push(birthdayRow);
      }
    }

    events.sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    return NextResponse.json({ events });
  } catch (e) {
    console.error("[calendar/events]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load events" },
      { status: 500 }
    );
  }
}
