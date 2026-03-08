import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/case-details — return case fields for profile (e.g. kids_label_user, kids_label_coparent). Parent auth.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership?.case_id) {
      return NextResponse.json({ kids_label_user: null, kids_label_coparent: null });
    }

    const { data, error } = await admin
      .from("cases")
      .select("kids_label_user, kids_label_coparent")
      .eq("id", membership.case_id)
      .single();

    if (error || !data) {
      return NextResponse.json({ kids_label_user: null, kids_label_coparent: null });
    }

    const row = data as { kids_label_user?: string | null; kids_label_coparent?: string | null };
    return NextResponse.json({
      kids_label_user: row.kids_label_user ?? null,
      kids_label_coparent: row.kids_label_coparent ?? null,
    });
  } catch (e) {
    console.error("[case-details GET]", e);
    return NextResponse.json({ error: "Failed to load case details" }, { status: 500 });
  }
}

/**
 * PATCH /api/case-details — update kids_label_user, kids_label_coparent for the user's case. Parent auth.
 */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership?.case_id) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const body = await req.json().catch(() => ({})) as { kids_label_user?: string | null; kids_label_coparent?: string | null };
    const updates: Record<string, string | null> = {};
    if (body.kids_label_user !== undefined) {
      updates.kids_label_user = body.kids_label_user == null || body.kids_label_user === "" ? null : String(body.kids_label_user).trim();
    }
    if (body.kids_label_coparent !== undefined) {
      updates.kids_label_coparent = body.kids_label_coparent == null || body.kids_label_coparent === "" ? null : String(body.kids_label_coparent).trim();
    }
    if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });

    const { error: updateErr } = await admin
      .from("cases")
      .update(updates)
      .eq("id", membership.case_id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[case-details PATCH]", e);
    return NextResponse.json({ error: "Failed to update case details" }, { status: 500 });
  }
}
