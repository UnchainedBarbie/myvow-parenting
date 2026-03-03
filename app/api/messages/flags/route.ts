import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const messageId = (body as { message_id?: string }).message_id;

    if (!messageId) {
      return NextResponse.json(
        { error: "message_id is required" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    // Ensure message belongs to a conversation in the user's case
    const { data: msg, error: msgError } = await admin
      .from("messages")
      .select("id, conversation_id")
      .eq("id", messageId)
      .maybeSingle();

    if (msgError || !msg) {
      return NextResponse.json(
        { error: msgError?.message ?? "Message not found" },
        { status: 404 }
      );
    }

    if (!msg.conversation_id) {
      return NextResponse.json(
        { error: "Message is not part of a conversation" },
        { status: 400 }
      );
    }

    const { data: conv, error: convError } = await admin
      .from("conversations")
      .select("case_id")
      .eq("id", msg.conversation_id)
      .maybeSingle();

    if (convError || !conv) {
      return NextResponse.json(
        { error: convError?.message ?? "Conversation not found" },
        { status: 404 }
      );
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("id")
      .eq("case_id", conv.case_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: upsertError } = await admin
      .from("message_user_flags")
      .upsert(
        {
          message_id: messageId,
          user_id: user.id,
          flag_type: "bookmark",
        },
        { onConflict: "message_id, user_id, flag_type" }
      );

    if (upsertError) {
      return NextResponse.json(
        { error: upsertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to flag message" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get("message_id");

    if (!messageId) {
      return NextResponse.json(
        { error: "message_id is required" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { error: delError } = await admin
      .from("message_user_flags")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", user.id)
      .eq("flag_type", "bookmark");

    if (delError) {
      return NextResponse.json(
        { error: delError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to unflag message" },
      { status: 500 }
    );
  }
}

