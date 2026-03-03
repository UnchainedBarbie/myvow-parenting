import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

const MAX_HOURS = 48;

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const now = new Date().toISOString();
    const { data: active } = await admin
      .from("cool_off")
      .select("id, starts_at, ends_at, is_active")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .gt("ends_at", now)
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!active) {
      return NextResponse.json({ active: null });
    }

    return NextResponse.json({
      active: {
        id: active.id,
        starts_at: active.starts_at,
        ends_at: active.ends_at,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load cool-off" },
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

    if (body.end_early === true) {
      const admin = getServiceRoleClient();
      const now = new Date().toISOString();
      await admin
        .from("cool_off")
        .update({ is_active: false, cancelled_at: now })
        .eq("user_id", user.id)
        .eq("is_active", true);
      return NextResponse.json({ ended: true });
    }

    const hours = typeof body.hours === "number" ? body.hours : (body.hours != null ? Number(body.hours) : null);

    if (hours == null || hours < 0.5 || hours > MAX_HOURS) {
      return NextResponse.json(
        { error: `hours must be between 0.5 and ${MAX_HOURS}` },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const now = new Date();
    const endsAt = new Date(now.getTime() + hours * 60 * 60 * 1000);

    await admin
      .from("cool_off")
      .update({ is_active: false, cancelled_at: now.toISOString() })
      .eq("user_id", user.id)
      .eq("is_active", true);

    const { data: created, error } = await admin
      .from("cool_off")
      .insert({
        user_id: user.id,
        ends_at: endsAt.toISOString(),
      })
      .select("id, starts_at, ends_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id: created.id,
      starts_at: created.starts_at,
      ends_at: created.ends_at,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start cool-off" },
      { status: 500 }
    );
  }
}
