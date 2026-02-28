import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/calendar/inbox — list inbox messages for the current user's case.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const { data: messages, error } = await admin
      .from("calendar_inbox_messages")
      .select(
        "id, source, from_email, subject, body_text, received_at, parse_status, parse_error, parse_confidence, parsed_title, parsed_date, parsed_start_time, parsed_end_time, parsed_location, parsed_notes, parsed_category, parsed_visibility, created_event_id, created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const withChildName = (messages ?? []).map((m) => ({
      ...m,
      parsed_child_id: (m as any).parsed_child_id,
    }));

    return NextResponse.json({ messages: withChildName });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
