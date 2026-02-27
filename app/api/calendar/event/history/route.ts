import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const eventId = url.searchParams.get("event_id");
    if (!eventId) {
      return NextResponse.json(
        { message: "Missing event_id" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    const { data: eventRow, error: eventError } = await admin
      .from("calendar_events")
      .select("id, case_id")
      .eq("id", eventId)
      .single();

    if (eventError || !eventRow) {
      return NextResponse.json({ message: "Event not found" }, { status: 404 });
    }

    const { data: member } = await admin
      .from("case_members")
      .select("id")
      .eq("case_id", eventRow.case_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const { data: rows, error } = await admin
      .from("calendar_event_history")
      .select("id, event_id, field_name, new_value, note, changed_by, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });

    if (error) {
      // If table does not exist yet, return empty history.
      // Postgres "undefined_table" error code.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = error;
      if (err.code === "42P01") {
        return NextResponse.json([], { status: 200 });
      }
      return NextResponse.json(
        { message: error.message || "Failed to load history" },
        { status: 500 }
      );
    }

    const userIds = [
      ...new Set((rows ?? []).map((r) => r.changed_by).filter(Boolean)),
    ] as string[];

    let nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: userRows } = await admin
        .from("users")
        .select("id, full_name")
        .in("id", userIds);
      nameMap =
        (userRows ?? []).reduce((acc, u) => {
          acc[u.id] = u.full_name;
          return acc;
        }, {} as Record<string, string>) ?? {};
    }

    const payload = (rows ?? []).map((r) => ({
      id: r.id,
      field_name: r.field_name,
      new_value: r.new_value,
      note: r.note,
      changed_by_name: nameMap[r.changed_by] ?? null,
      created_at: r.created_at,
    }));

    return NextResponse.json(payload, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error ? e.message : "Failed to load event history",
      },
      { status: 500 }
    );
  }
}

