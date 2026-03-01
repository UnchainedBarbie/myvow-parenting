import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * PATCH /api/profile/court-orders/[id]
 * Body: { custody_type?, court_case_number?, court_jurisdiction?, effective_date?, schedule_description?, is_active?, history?: { field_changed, old_value, new_value }[] }
 * Updates parenting_plans and appends to court_order_history.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: plan, error: planErr } = await admin
      .from("parenting_plans")
      .select("id, case_id")
      .eq("id", id)
      .single();
    if (planErr || !plan) return NextResponse.json({ error: "Court order not found" }, { status: 404 });

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", plan.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { history: historyEntries, ...rest } = body;
    const updates: Record<string, unknown> = {};

    if (rest.custody_type != null) updates.custody_type = String(rest.custody_type);
    if (rest.court_case_number !== undefined) updates.court_case_number = rest.court_case_number === "" || rest.court_case_number == null ? null : String(rest.court_case_number).trim();
    if (rest.court_jurisdiction !== undefined) updates.court_jurisdiction = rest.court_jurisdiction === "" || rest.court_jurisdiction == null ? null : String(rest.court_jurisdiction).trim();
    if (rest.effective_date !== undefined) updates.effective_date = rest.effective_date === "" || rest.effective_date == null ? null : String(rest.effective_date).slice(0, 10);
    if (rest.schedule_description !== undefined) updates.schedule_description = rest.schedule_description === "" || rest.schedule_description == null ? null : String(rest.schedule_description).trim();
    if (rest.is_active !== undefined) updates.is_active = !!rest.is_active;
    if (rest.title !== undefined) updates.title = rest.title === "" || rest.title == null ? null : String(rest.title).trim();

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { error: updateErr } = await admin
      .from("parenting_plans")
      .update(updates)
      .eq("id", id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    if (Array.isArray(historyEntries) && historyEntries.length > 0) {
      const rows = historyEntries.map((h: { field_changed: string; old_value?: string | null; new_value?: string | null }) => ({
        parenting_plan_id: id,
        changed_by: user.id,
        field_changed: h.field_changed,
        old_value: h.old_value ?? null,
        new_value: h.new_value ?? null,
      }));
      const { error: historyErr } = await admin.from("court_order_history").insert(rows);
      if (historyErr) {
        console.warn("[court-orders PATCH] court_order_history insert failed:", historyErr.message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[court-orders PATCH] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/profile/court-orders/[id]
 * Soft-deletes the court order (sets deleted_at on parenting_plans).
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: plan, error: planErr } = await admin
      .from("parenting_plans")
      .select("id, case_id")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (planErr || !plan) return NextResponse.json({ error: "Court order not found" }, { status: 404 });

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", plan.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const deletedAt = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("parenting_plans")
      .update({ deleted_at: deletedAt })
      .eq("id", id);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[court-orders DELETE] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
