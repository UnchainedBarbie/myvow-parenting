import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Release buffered messages for the current user when their cool-off has ended.
 * Call on app load and on an interval (e.g. every 60s) so messages appear after cool-off.
 * Does not expose cool-off to the other parent; only updates delivery_status for the recipient.
 */
export async function POST(request: NextRequest) {
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

    const { data: coolRows } = await admin
      .from("cool_off")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .lt("ends_at", now);

    if (!coolRows?.length) {
      return NextResponse.json({ released: 0 });
    }

    await admin
      .from("cool_off")
      .update({ is_active: false })
      .eq("user_id", user.id)
      .eq("is_active", true);

    const { data: caseMember } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!caseMember?.case_id) {
      return NextResponse.json({ released: 0 });
    }

    const { data: updated } = await admin
      .from("messages")
      .update({
        delivery_status: "delivered",
        delivered_at: now,
      })
      .eq("case_id", caseMember.case_id)
      .eq("direction", "incoming")
      .eq("delivery_status", "buffered")
      .select("id");

    return NextResponse.json({ released: updated?.length ?? 0 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Release failed" },
      { status: 500 }
    );
  }
}
