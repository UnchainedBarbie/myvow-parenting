import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { expenseVisibleToViewer, readExpenses } from "@/lib/expenses-visibility";

/**
 * Approve or dispute expense. Disputes go through AI moderation (Phase 2).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const { expense_id, action, dispute_reason } = body as {
      expense_id?: string;
      action?: "approve" | "dispute" | "resolve" | "mark_paid";
      dispute_reason?: string;
    };
    if (!expense_id || !action) {
      return NextResponse.json(
        { message: "Missing expense_id or action" },
        { status: 400 }
      );
    }
    const admin = getServiceRoleClient();
    const loaded = await readExpenses(
      (columns) => admin.from("expenses").select(columns).eq("id", expense_id).limit(1),
      "id, case_id, deleted_at"
    );
    const expense = loaded.rows[0] as {
      case_id?: string;
      deleted_at?: string | null;
      visibility?: string | null;
      submitted_by?: string | null;
    } | undefined;
    if (loaded.error || !expense?.case_id || expense.deleted_at) {
      return NextResponse.json({ message: "Expense not found" }, { status: 404 });
    }
    const { data: membership } = await admin
      .from("case_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("case_id", expense.case_id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    if (!expenseVisibleToViewer(expense, { userId: user.id, role: membership.role })) {
      return NextResponse.json({ message: "Expense not found" }, { status: 404 });
    }
    if (action === "approve" || action === "resolve") {
      const { error } = await admin
        .from("expenses")
        .update({
          status: "resolved",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", expense_id)
        .eq("case_id", expense.case_id);
      if (error) {
        return NextResponse.json(
          { message: error.message },
          { status: 500 }
        );
      }
    } else if (action === "mark_paid") {
      const { error } = await admin
        .from("expenses")
        .update({
          status: "paid",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", expense_id)
        .eq("case_id", expense.case_id);
      if (error) {
        return NextResponse.json(
          { message: error.message },
          { status: 500 }
        );
      }
    } else if (action === "dispute") {
      const { error } = await admin
        .from("expenses")
        .update({
          status: "disputed",
          dispute_reason: dispute_reason ?? null,
        })
        .eq("id", expense_id)
        .eq("case_id", expense.case_id);
      if (error) {
        return NextResponse.json(
          { message: error.message },
          { status: 500 }
        );
      }
    } else {
      return NextResponse.json(
        { message: "Action must be approve, dispute, resolve, or mark_paid" },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Respond failed" },
      { status: 500 }
    );
  }
}
