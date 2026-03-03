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
    const { conversation_id, content } = body as {
      conversation_id?: string;
      content?: string;
      context?: unknown;
    };

    if (!conversation_id || !content || typeof content !== "string") {
      return NextResponse.json(
        { error: "conversation_id and content are required" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    // Verify the user belongs to the case for this conversation
    const { data: conv, error: convError } = await admin
      .from("conversations")
      .select("id, case_id")
      .eq("id", conversation_id)
      .maybeSingle();

    if (convError) {
      return NextResponse.json({ error: convError.message }, { status: 500 });
    }
    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
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

    const userMessageContent = content.trim();
    if (!userMessageContent) {
      return NextResponse.json({ error: "Content is empty" }, { status: 400 });
    }

    // Insert user sage message
    const { data: userMsg, error: userMsgError } = await admin
      .from("sage_messages")
      .insert({
        conversation_id,
        user_id: user.id,
        role: "user",
        content: userMessageContent,
      })
      .select("id, role, content, created_at")
      .single();

    if (userMsgError) {
      return NextResponse.json({ error: userMsgError.message }, { status: 500 });
    }

    // Placeholder Sage response - AI wiring can come later
    const sageReply =
      "I hear you. Let me think about how to help with this.";

    const { data: sageMsg, error: sageMsgError } = await admin
      .from("sage_messages")
      .insert({
        conversation_id,
        user_id: user.id,
        role: "sage",
        content: sageReply,
      })
      .select("id, role, content, created_at")
      .single();

    if (sageMsgError) {
      return NextResponse.json({ error: sageMsgError.message }, { status: 500 });
    }

    return NextResponse.json({
      user_message: userMsg,
      sage_message: sageMsg,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sage chat failed" },
      { status: 500 }
    );
  }
}

