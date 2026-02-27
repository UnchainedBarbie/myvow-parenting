import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Update calendar event status (completed, no_show, conflict).
 * Uses calendar_events.swap_status to store the status string.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { event_id, status } = body as {
      event_id?: string;
      status?: string | null;
    };
    if (!event_id) {
      return NextResponse.json(
        { message: "Missing event_id" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    // Load event and case to verify membership
    const { data: eventRow, error: eventError } = await admin
      .from("calendar_events")
      .select("id, case_id")
      .eq("id", event_id)
      .single();
    if (eventError || !eventRow) {
      return NextResponse.json(
        { message: "Event not found" },
        { status: 404 }
      );
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

    const { error: updateError } = await admin
      .from("calendar_events")
      .update({ swap_status: status ?? null })
      .eq("id", event_id);
    if (updateError) {
      return NextResponse.json(
        { message: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Status update failed" },
      { status: 500 }
    );
  }
}

