import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Request swap. AI moderated (Phase 2). Service role for writes.
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
      start_time,
      end_time,
      swap_original_message,
    } = body as {
      case_id?: string;
      title?: string;
      start_time?: string;
      end_time?: string;
      swap_original_message?: string;
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
        start_time,
        end_time: end_time ?? null,
        event_type: "swap_request",
        is_swap_request: true,
        swap_status: "requested",
        swap_original_message: swap_original_message ?? null,
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
      { message: e instanceof Error ? e.message : "Swap request failed" },
      { status: 500 }
    );
  }
}
