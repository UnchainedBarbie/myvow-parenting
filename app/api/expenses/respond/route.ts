import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { expenseVisibleToViewer, readExpenses } from "@/lib/expenses-visibility";
import { coparentShareInvolves } from "@/lib/expenses-share";
import {
  canonicalExpenseStatus,
  payableCoparentShare,
  parsePaymentAmount,
  paymentAmountError,
  paymentCoversShare,
} from "@/lib/expenses-tab";

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
    const { expense_id, action, dispute_reason, paid_at, paid_amount, payment_method, payment_reference, payment_notes } = body as {
      expense_id?: string;
      action?: "approve" | "dispute" | "resolve" | "mark_paid" | "update_payment";
      dispute_reason?: string;
      paid_at?: string;
      paid_amount?: number | string;
      payment_method?: string;
      payment_reference?: string;
      payment_notes?: string;
    };
    if (!expense_id || !action) {
      return NextResponse.json(
        { message: "Missing expense_id or action" },
        { status: 400 }
      );
    }
    const admin = getServiceRoleClient();
    const paymentColumns =
      "id, case_id, deleted_at, status, amount_owed, other_parent_share, split_label, paid_at, paid_amount, payment_method, payment_reference, payment_notes";
    const loadRow = (columns: string) =>
      readExpenses(
        (selected) => admin.from("expenses").select(selected).eq("id", expense_id).limit(1),
        columns
      );
    let loaded = await loadRow(paymentColumns);
    if (loaded.error && /paid_amount/i.test(loaded.error.message ?? "")) {
      loaded = await loadRow(paymentColumns.replace(", paid_amount", ""));
    }
    const expense = loaded.rows[0] as {
      case_id?: string;
      deleted_at?: string | null;
      visibility?: string | null;
      submitted_by?: string | null;
      status?: string | null;
      amount_owed?: number | string | null;
      other_parent_share?: number | string | null;
      split_label?: string | null;
      paid_at?: string | null;
      paid_amount?: number | string | null;
      payment_method?: string | null;
      payment_reference?: string | null;
      payment_notes?: string | null;
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
          status: "approved",
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
    } else if (action === "mark_paid" || action === "update_payment") {
      const share = payableCoparentShare(expense);
      if (!coparentShareInvolves(share)) {
        return NextResponse.json(
          { message: "A personal expense has no co-parent share to pay." },
          { status: 400 }
        );
      }
      const amount = parsePaymentAmount(paid_amount);
      const amountError = paymentAmountError(amount, share);
      if (amountError || amount == null) {
        return NextResponse.json(
          { message: amountError ?? "Enter the amount paid." },
          { status: 400 }
        );
      }
      let paidAt: string | null = null;
      if (typeof paid_at === "string" && paid_at.trim()) {
        const parsed = new Date(paid_at.trim());
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ message: "Enter a valid date paid." }, { status: 400 });
        }
        paidAt = parsed.toISOString();
      }
      if (!paidAt) {
        return NextResponse.json({ message: "Enter the date paid." }, { status: 400 });
      }
      const method = typeof payment_method === "string" ? payment_method.trim() : "";
      const reference = typeof payment_reference === "string" ? payment_reference.trim() : "";
      const notes = typeof payment_notes === "string" ? payment_notes.trim() : "";
      const now = new Date().toISOString();
      const nextStatus = paymentCoversShare(amount, share) ? "paid" : "approved";
      const updates: Record<string, string | number | null> = {
        paid_at: paidAt,
        paid_amount: amount,
        payment_method: method || null,
        payment_reference: reference || null,
        payment_notes: notes || null,
        status: nextStatus,
      };
      if (action === "mark_paid") {
        if (nextStatus === "paid") {
          updates.approved_by = user.id;
          updates.approved_at = now;
        }
      } else {
        const currentStatus = canonicalExpenseStatus(expense.status);
        if (currentStatus !== "paid" && currentStatus !== "approved") {
          return NextResponse.json(
            { message: "Only an approved or paid expense has a payment record to edit." },
            { status: 400 }
          );
        }
        const storedAmount = parsePaymentAmount(expense.paid_amount);
        const storedAt = expense.paid_at ? new Date(expense.paid_at).getTime() : null;
        const nextAt = paidAt ? new Date(paidAt).getTime() : null;
        const changed =
          storedAmount !== amount ||
          storedAt !== nextAt ||
          (expense.payment_method ?? "").trim() !== method ||
          (expense.payment_reference ?? "").trim() !== reference ||
          (expense.payment_notes ?? "").trim() !== notes ||
          currentStatus !== nextStatus;
        if (!changed) {
          return NextResponse.json({ ok: true });
        }
        updates.payment_edited_by = user.id;
        updates.payment_edited_at = now;
        if (nextStatus === "paid" && currentStatus !== "paid") {
          updates.approved_by = user.id;
          updates.approved_at = now;
        }
      }
      const { error } = await admin
        .from("expenses")
        .update(updates)
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
          disputed_by: user.id,
          disputed_at: new Date().toISOString(),
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
        { message: "Action must be approve, dispute, resolve, mark_paid, or update_payment" },
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
