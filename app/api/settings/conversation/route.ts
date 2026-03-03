import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversation_id");
    if (!conversationId) {
      return NextResponse.json(
        { error: "conversation_id is required" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const { data: convRow } = await admin
      .from("conversations")
      .select("id, case_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!convRow) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const { data: member } = await admin
      .from("case_members")
      .select("id")
      .eq("case_id", convRow.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: row } = await admin
      .from("conversation_settings")
      .select("proactive_sage_enabled, structured_pause_enabled")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json({
      proactive_sage_enabled: row?.proactive_sage_enabled ?? null,
      structured_pause_enabled: row?.structured_pause_enabled ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const conversationId = body.conversation_id as string | undefined;
    if (!conversationId) {
      return NextResponse.json(
        { error: "conversation_id is required" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const { data: conv } = await admin
      .from("conversations")
      .select("id, case_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const { data: member } = await admin
      .from("case_members")
      .select("id")
      .eq("case_id", conv.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: existing } = await admin
      .from("conversation_settings")
      .select("proactive_sage_enabled, structured_pause_enabled")
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();

    const updates: { proactive_sage_enabled?: boolean; structured_pause_enabled?: boolean } = {};
    if (typeof body.proactive_sage_enabled === "boolean") {
      updates.proactive_sage_enabled = body.proactive_sage_enabled;
    }
    if (typeof body.structured_pause_enabled === "boolean") {
      updates.structured_pause_enabled = body.structured_pause_enabled;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        proactive_sage_enabled: existing?.proactive_sage_enabled ?? null,
        structured_pause_enabled: existing?.structured_pause_enabled ?? null,
      });
    }

    for (const [field, newVal] of Object.entries(updates)) {
      const oldVal = (existing as Record<string, unknown>)?.[field] ?? null;
      if (oldVal === newVal) continue;
      await admin.from("edit_history").insert({
        user_id: user.id,
        scope: "conversation",
        conversation_id: conversationId,
        field,
        old_value: oldVal,
        new_value: newVal,
      });
    }

    const { data: updated, error } = await admin
      .from("conversation_settings")
      .upsert(
        {
          conversation_id: conversationId,
          user_id: user.id,
          ...updates,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "conversation_id,user_id" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      proactive_sage_enabled: updated.proactive_sage_enabled ?? null,
      structured_pause_enabled: updated.structured_pause_enabled ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update settings" },
      { status: 500 }
    );
  }
}
