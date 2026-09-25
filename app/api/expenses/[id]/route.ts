import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { computeAllocationFromParentingPlan, allocationStatusForDb } from "@/lib/expenses-allocation";
import { expenseWorkflowStatus } from "@/lib/expenses-share";

function parseChildIds(childIdsRaw: unknown, childId?: string | null): string[] {
  if (Array.isArray(childIdsRaw)) {
    return [
      ...new Set(
        childIdsRaw
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean)
      ),
    ];
  }
  if (typeof childId === "string" && childId.trim()) return [childId.trim()];
  return [];
}

async function replaceExpenseChildren(
  admin: ReturnType<typeof getServiceRoleClient>,
  expenseId: string,
  childIds: string[]
): Promise<{ error: string | null }> {
  const { error: delErr } = await admin
    .from("expense_children")
    .delete()
    .eq("expense_id", expenseId);
  if (delErr) return { error: delErr.message };
  if (childIds.length === 0) return { error: null };
  const { error: insErr } = await admin.from("expense_children").insert(
    childIds.map((child_id) => ({ expense_id: expenseId, child_id }))
  );
  if (insErr) return { error: insErr.message };
  return { error: null };
}

/**
 * GET /api/expenses/[id] — child links for the edit modal (does not change ledger reads).
 */
export async function GET(
  _request: NextRequest,
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
      .select("id, case_id, child_id, deleted_at")
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

    const { data: rows, error: junctionError } = await admin
      .from("expense_children")
      .select("child_id")
      .eq("expense_id", expenseId);
    if (junctionError) {
      const fallback =
        typeof expense.child_id === "string" && expense.child_id
          ? [expense.child_id]
          : [];
      return NextResponse.json({ child_ids: fallback });
    }
    const child_ids = (rows ?? [])
      .map((r) => (typeof r.child_id === "string" ? r.child_id : ""))
      .filter(Boolean);
    if (child_ids.length === 0 && typeof expense.child_id === "string" && expense.child_id) {
      return NextResponse.json({ child_ids: [expense.child_id] });
    }
    return NextResponse.json({ child_ids });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Load failed" },
      { status: 500 }
    );
  }
}

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
      .select(
        "id, case_id, submitted_by, amount, amount_owed, split_percent, allocation_status, status, category, child_id, deleted_at"
      )
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
      child_ids?: unknown;
      category_description?: string | null;
      incurred_date?: string | null;
      status?: string;
      dispute_reason?: string | null;
      paid_at?: string | null;
      payment_method?: string | null;
      payment_reference?: string | null;
      payment_notes?: string | null;
    };

    const isOwner = expense.submitted_by === user.id;
    const now = new Date().toISOString();
    const childrenProvided =
      isOwner && (Array.isArray(body.child_ids) || body.child_id !== undefined);
    const childIds = childrenProvided
      ? parseChildIds(body.child_ids, body.child_id)
      : null;
    const primaryChildId =
      childIds != null ? childIds[0] ?? null : undefined;

    const updates: Record<string, unknown> = {};

    if (isOwner) {
      if (body.description !== undefined) updates.description = body.description;
      if (body.amount !== undefined) updates.amount = body.amount;
      if (body.category !== undefined) updates.category = body.category;
      if (primaryChildId !== undefined) updates.child_id = primaryChildId;
      if (body.incurred_date !== undefined) {
        updates.incurred_date = body.incurred_date || null;
      }
      if (body.category_description !== undefined) {
        updates.category_description = body.category_description || null;
      }
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

    if (isOwner && (body.amount !== undefined || body.category !== undefined || childrenProvided)) {
      const amountNum = Number(body.amount ?? expense.amount);
      const allocation = await computeAllocationFromParentingPlan({
        caseId: expense.case_id,
        amount: amountNum,
        category: body.category ?? (expense as { category?: string }).category ?? "other",
        childId:
          primaryChildId !== undefined
            ? primaryChildId
            : ((expense as { child_id?: string | null }).child_id ?? null),
      });
      updates.split_percent = allocation.other_parent_percent;
      updates.amount_owed = allocation.other_parent_share;
      updates.other_parent_percent = allocation.other_parent_percent;
      updates.other_parent_share = allocation.other_parent_share;
      updates.split_label = allocation.split_label;
      updates.allocation_status = allocationStatusForDb(
        allocation.allocation_status
      );
      const currentStatus = String(
        (updates.status as string | undefined) ??
          (expense as { status?: string }).status ??
          ""
      );
      if (currentStatus === "submitted" || currentStatus === "resolved") {
        updates.status = expenseWorkflowStatus({
          otherParentShare: allocation.other_parent_share,
        });
      }
    }

    const { error: updateError } = await admin
      .from("expenses")
      .update(updates)
      .eq("id", expenseId);

    if (updateError) {
      return NextResponse.json({ message: updateError.message }, { status: 500 });
    }

    if (childIds != null) {
      const { error: junctionError } = await replaceExpenseChildren(
        admin,
        expenseId,
        childIds
      );
      if (junctionError) {
        console.error(
          "[expenses/PATCH] expense_children replace failed:",
          junctionError
        );
        return NextResponse.json(
          { message: "Expense updated, but linking children failed." },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Update failed" },
      { status: 500 }
    );
  }
}
