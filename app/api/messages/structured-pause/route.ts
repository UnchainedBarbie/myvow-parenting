import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

const MUTUAL_WINDOW_MS = 10 * 60 * 1000;

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
    const { data: conv } = await admin
      .from("conversations")
      .select("id, case_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
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

    const now = new Date().toISOString();
    const { data: active } = await admin
      .from("structured_pauses")
      .select("id, mode, starts_at, ends_at, created_by")
      .eq("conversation_id", conversationId)
      .gt("ends_at", now)
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!active) {
      return NextResponse.json({ active: null });
    }

    const blocksSending =
      active.mode === "auto" ||
      active.mode === "user_mutual" ||
      (active.mode === "user_unilateral" && active.created_by === user.id);

    return NextResponse.json({
      active: {
        id: active.id,
        mode: active.mode,
        starts_at: active.starts_at,
        ends_at: active.ends_at,
        blocks_sending: blocksSending,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load pause" },
      { status: 500 }
    );
  }
}

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
    const conversationId = body.conversation_id as string | undefined;
    const durationKey = body.duration as string | undefined;

    if (!conversationId || !durationKey) {
      return NextResponse.json(
        { error: "conversation_id and duration are required" },
        { status: 400 }
      );
    }

    const durationMinutes: Record<string, number> = {
      "30min": 30,
      "2hours": 120,
      "until_tomorrow": 12 * 60,
    };
    const minutes = durationMinutes[durationKey];
    if (minutes == null) {
      return NextResponse.json(
        { error: "Invalid duration. Use 30min, 2hours, or until_tomorrow" },
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
      return NextResponse.json({ error: "Not found" }, { status: 404 });
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

    const now = new Date();
    const endsAt = new Date(now.getTime() + minutes * 60 * 1000);

    const { data: otherPause } = await admin
      .from("structured_pauses")
      .select("id, created_by, created_at")
      .eq("conversation_id", conversationId)
      .gt("ends_at", now.toISOString())
      .neq("created_by", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let mode: "user_unilateral" | "user_mutual" = "user_unilateral";
    if (otherPause) {
      const otherCreated = new Date(otherPause.created_at).getTime();
      if (now.getTime() - otherCreated <= MUTUAL_WINDOW_MS) {
        mode = "user_mutual";
        await admin
          .from("structured_pauses")
          .update({ mode: "user_mutual", ends_at: endsAt.toISOString() })
          .eq("id", otherPause.id);
      }
    }

    const { data: created, error } = await admin
      .from("structured_pauses")
      .insert({
        conversation_id: conversationId,
        created_by: user.id,
        mode,
        ends_at: endsAt.toISOString(),
      })
      .select("id, mode, ends_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id: created.id,
      mode: created.mode,
      ends_at: created.ends_at,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create pause" },
      { status: 500 }
    );
  }
}
