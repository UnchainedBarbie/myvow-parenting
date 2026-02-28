import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/calendar/inbox/[id]/discard — mark message as discarded (set parse_status to 'failed' or keep for audit).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: messageId } = await params;
    if (!messageId) {
      return NextResponse.json({ error: "Missing message id" }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: msg, error: fetchErr } = await admin
      .from("calendar_inbox_messages")
      .select("id, created_event_id")
      .eq("id", messageId)
      .eq("user_id", user.id)
      .single();

    if (fetchErr || !msg) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    if ((msg as any).created_event_id) {
      return NextResponse.json({ error: "Event already created; cannot discard" }, { status: 400 });
    }

    await admin
      .from("calendar_inbox_messages")
      .update({ parse_status: "failed", parse_error: "Discarded by user" })
      .eq("id", messageId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
