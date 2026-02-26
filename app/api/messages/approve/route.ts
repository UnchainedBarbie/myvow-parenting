import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Approve draft and send: insert message (outgoing) and create events.
 * All writes via service role.
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
      original_content,
      ai_rewritten_content,
    } = body as {
      case_id?: string;
      original_content?: string;
      ai_rewritten_content?: string;
    };
    if (!case_id || !original_content || !ai_rewritten_content) {
      return NextResponse.json(
        { message: "Missing case_id, original_content, or ai_rewritten_content" },
        { status: 400 }
      );
    }
    const admin = getServiceRoleClient();
    const { data: message, error: msgError } = await admin
      .from("messages")
      .insert({
        case_id,
        direction: "outgoing",
        sender_id: user.id,
        original_content,
        ai_rewritten_content,
        current_status: "sent",
      })
      .select("id")
      .single();
    if (msgError) {
      return NextResponse.json(
        { message: msgError.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, message_id: message.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Send failed" },
      { status: 500 }
    );
  }
}
