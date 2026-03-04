import { NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const conversationId = params.id;

    const { data: conv, error: convError } = await admin
      .from("conversations")
      .select("id, case_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (convError || !conv) {
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

    const { error: insertError } = await admin
      .from("conversation_user_flags")
      .upsert(
        { user_id: user.id, conversation_id: conversationId },
        { onConflict: "user_id,conversation_id" }
      );

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message ?? "Failed to flag" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to flag conversation" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const conversationId = params.id;

    const { error } = await admin
      .from("conversation_user_flags")
      .delete()
      .eq("user_id", user.id)
      .eq("conversation_id", conversationId);

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to remove flag" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to remove flag" },
      { status: 500 }
    );
  }
}
