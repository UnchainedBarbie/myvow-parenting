import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function PATCH(
  request: NextRequest,
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
    const body = await request.json().catch(() => ({}));
    const nextStatus = (body as { status?: string }).status;

    const allowed = new Set(["open", "archived"]);
    if (!nextStatus || !allowed.has(nextStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

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

    const { error: updateError } = await admin
      .from("conversations")
      .update({ status: nextStatus })
      .eq("id", conversationId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message ?? "Failed to update status" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update status" },
      { status: 500 }
    );
  }
}

