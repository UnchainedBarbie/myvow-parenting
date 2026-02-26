import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Create calendar event. Service role for writes.
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
    const {
      case_id,
      title,
      description,
      event_type,
      child_id,
      start_time,
      end_time,
      all_day,
    } = body as {
      case_id?: string;
      title?: string;
      description?: string;
      event_type?: string;
      child_id?: string;
      start_time?: string;
      end_time?: string;
      all_day?: boolean;
    };
    if (!case_id || !title || !start_time) {
      return NextResponse.json(
        { message: "Missing case_id, title, or start_time" },
        { status: 400 }
      );
    }
    const admin = getServiceRoleClient();
    const { data: event, error } = await admin
      .from("calendar_events")
      .insert({
        case_id,
        created_by: user.id,
        title,
        description: description ?? null,
        event_type: event_type ?? null,
        child_id: child_id ?? null,
        start_time,
        end_time: end_time ?? null,
        all_day: all_day ?? false,
      })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ event_id: event.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Create failed" },
      { status: 500 }
    );
  }
}
