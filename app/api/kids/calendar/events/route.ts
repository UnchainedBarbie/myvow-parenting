import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

type KidCalendarEvent = {
  id: string;
  title: string;
  event_type: string | null;
  start_time: string;
  end_time: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json(
        { message: "Not logged in" },
        { status: 401 }
      );
    }

    const child = session.child as { case_id?: string | null };
    const caseId = child.case_id ?? null;

    if (!caseId) {
      return NextResponse.json(
        { message: "No family case found" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: events, error } = await admin
      .from("calendar_events")
      .select(
        "id, title, kid_title, event_type, start_time, end_time, visibility, deleted_at"
      )
      .eq("case_id", caseId)
      .eq("visibility", "family")
      .is("deleted_at", null)
      .order("start_time", { ascending: true });

    if (error) {
      return NextResponse.json(
        { message: error.message ?? "Failed to load events" },
        { status: 500 }
      );
    }

    const items: KidCalendarEvent[] = (events ?? []).map((e) => ({
      id: e.id as string,
      title:
        ((e as { kid_title?: string | null }).kid_title as string | null) ??
        (e.title as string),
      event_type: (e.event_type as string | null) ?? null,
      start_time: e.start_time as string,
      end_time: (e.end_time as string | null) ?? null,
    }));

    return NextResponse.json({ events: items });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error ? e.message : "Failed to load calendar events",
      },
      { status: 500 }
    );
  }
}

