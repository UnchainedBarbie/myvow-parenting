import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * PATCH /api/expenses/[id] — update expense. Role-based: owner can edit all fields; co-parent can edit status, dispute_reason, and payment fields only.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: expenseId } = await context.params;
    if (!expenseId) {
      return NextResponse.json({ message: "Missing expense id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    const { data: expense, error: fetchError } = await admin
      .from("expenses")
      .select("id, case_id, submitted_by, amount, amount_owed, split_percent, deleted_at")
      .eq("id", expenseId)
      .maybeSingle();

    if (fetchError || !expense) {
      return NextResponse.json({ message: "Expense not found" }, { status: 404 });
    }
    if (expense.deleted_at) {
      return NextResponse.json({ message: "Expense not found" }, { status: 404 });
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .eq("case_id", expense.case_id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      description?: string;
      amount?: number;
      category?: string;
      child_id?: string | null;
      status?: string;
      dispute_reason?: string | null;
      paid_at?: string | null;
      payment_method?: string | null;
      payment_reference?: string | null;
      payment_notes?: string | null;
    };

    const isOwner = expense.submitted_by === user.id;
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = {};

    if (isOwner) {
      if (body.description !== undefined) updates.description = body.description;
      if (body.amount !== undefined) updates.amount = body.amount;
      if (body.category !== undefined) updates.category = body.category;
      if (body.child_id !== undefined) updates.child_id = body.child_id;
    }

    if (body.status !== undefined) updates.status = body.status;
    if (body.dispute_reason !== undefined) updates.dispute_reason = body.dispute_reason;
    if (body.paid_at !== undefined) updates.paid_at = body.paid_at || null;
    if (body.payment_method !== undefined) updates.payment_method = body.payment_method || null;
    if (body.payment_reference !== undefined) updates.payment_reference = body.payment_reference || null;
    if (body.payment_notes !== undefined) updates.payment_notes = body.payment_notes || null;

    if (body.status === "resolved" || body.status === "paid") {
      updates.approved_by = user.id;
      updates.approved_at = now;
    }

    if (isOwner && body.amount !== undefined) {
      const { data: caseRow } = await admin
        .from("cases")
        .select("custody_split_percent")
        .eq("id", expense.case_id)
        .single();
      const splitPct = Number(expense.split_percent ?? caseRow?.custody_split_percent ?? 50);
      const amountNum = Number(body.amount);
      updates.amount_owed = amountNum * (splitPct / 100);
    }

    const { error: updateError } = await admin
      .from("expenses")
      .update(updates)
      .eq("id", expenseId);

    if (updateError) {
      return NextResponse.json({ message: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Update failed" },
      { status: 500 }
    );
  }
}
