import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { computeAllocationFromParentingPlan, allocationStatusForDb } from "@/lib/expenses-allocation";
import { expenseWorkflowStatus } from "@/lib/expenses-share";

/**
 * Submit expense with optional receipt. Service role for writes.
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
    const {
      case_id,
      description,
      amount,
      category,
      child_id,
      receipt_file_id,
      notify_coparent,
      incurred_date,
      category_description,
    } = body as {
      case_id?: string;
      description?: string;
      amount?: number;
      category?: string;
      child_id?: string;
      receipt_file_id?: string;
      notify_coparent?: boolean;
      incurred_date?: string | null;
      category_description?: string | null;
    };
    const descTrimmed = (description ?? "").trim();
    if (!case_id || !descTrimmed || amount == null) {
      return NextResponse.json(
        { message: "Missing case_id, description, or amount" },
        { status: 400 }
      );
    }
    if (descTrimmed.length > 80) {
      return NextResponse.json(
        { message: "Description must be 80 characters or less." },
        { status: 400 }
      );
    }
    const admin = getServiceRoleClient();
    const amountNum = Number(amount);

    const allocation = await computeAllocationFromParentingPlan({
      caseId: case_id,
      amount: amountNum,
      category: category ?? "other",
      childId: child_id ?? null,
    });
    const notifyCoparent = notify_coparent === true;
    const status = expenseWorkflowStatus({
      otherParentShare: allocation.other_parent_share,
      notifyCoparent,
    });
    const { data: expense, error } = await admin
      .from("expenses")
      .insert({
        case_id,
        submitted_by: user.id,
        description: descTrimmed,
        amount: amountNum,
        category: category ?? "other",
        child_id: child_id ?? null,
        split_percent: allocation.other_parent_percent,
        amount_owed: allocation.other_parent_share,
        allocation_status: allocationStatusForDb(allocation.allocation_status),
        other_parent_percent: allocation.other_parent_percent,
        other_parent_share: allocation.other_parent_share,
        split_label: allocation.split_label,
        receipt_file_id: receipt_file_id ?? null,
        incurred_date: incurred_date || null,
        category_description: category_description || null,
        status,
      })
      .select("id")
      .single();
    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ expense_id: expense.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Submit failed" },
      { status: 500 }
    );
  }
}
