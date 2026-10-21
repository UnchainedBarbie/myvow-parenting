import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { computeAllocationFromParentingPlan, allocationStatusForDb } from "@/lib/expenses-allocation";
import { planExpenseEntry, type ExpenseLoggingIntent, type ExpensePayer } from "@/lib/expenses-sharing";
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
      child_ids: childIdsRaw,
      receipt_file_id,
      notify_coparent,
      incurred_date,
      category_description,
      paid_by,
      sharing_intent,
      stated_percent,
    } = body as {
      case_id?: string;
      description?: string;
      amount?: number;
      category?: string;
      child_id?: string;
      child_ids?: unknown;
      receipt_file_id?: string;
      notify_coparent?: boolean;
      incurred_date?: string | null;
      category_description?: string | null;
      paid_by?: ExpensePayer | null;
      sharing_intent?: ExpenseLoggingIntent | null;
      stated_percent?: number | null;
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
    const childIds = parseChildIds(childIdsRaw, child_id);
    const primaryChildId = childIds[0] ?? null;
    const admin = getServiceRoleClient();
    const amountNum = Number(amount);

    const allocation = await computeAllocationFromParentingPlan({
      caseId: case_id,
      amount: amountNum,
      category: category ?? "other",
      childId: primaryChildId,
    });
    const payer: ExpensePayer = paid_by === "coparent" ? "coparent" : "self";
    const intent: ExpenseLoggingIntent =
      sharing_intent === "personal" || sharing_intent === "shared" ? sharing_intent : "unspecified";
    const statedPercent =
      typeof stated_percent === "number" && Number.isFinite(stated_percent) ? stated_percent : null;
    const plan = planExpenseEntry({
      intent,
      statedPercent,
      notifyOverride: typeof notify_coparent === "boolean" ? notify_coparent : null,
      allocation,
      amount: amountNum,
      payer,
    });
    if (!plan.fields) {
      return NextResponse.json(
        { message: plan.review, sharing_mode: plan.mode },
        { status: 422 }
      );
    }
    const notifyCoparent = plan.notifyCoparent;
    const status = expenseWorkflowStatus({
      otherParentShare: plan.fields.other_parent_share,
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
        child_id: primaryChildId,
        split_percent: plan.fields.other_parent_percent,
        amount_owed: plan.fields.amount_owed,
        allocation_status: allocationStatusForDb(plan.fields.allocation_status),
        other_parent_percent: plan.fields.other_parent_percent,
        other_parent_share: plan.fields.other_parent_share,
        split_label: plan.fields.split_label,
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
    if (childIds.length > 0) {
      const { error: junctionError } = await admin.from("expense_children").insert(
        childIds.map((cid) => ({ expense_id: expense.id, child_id: cid }))
      );
      if (junctionError) {
        console.error(
          "[expenses/submit] expense_children insert failed:",
          junctionError.message
        );
        return NextResponse.json(
          { message: "Expense saved, but linking children failed." },
          { status: 500 }
        );
      }
    }
    return NextResponse.json({ expense_id: expense.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Submit failed" },
      { status: 500 }
    );
  }
}
