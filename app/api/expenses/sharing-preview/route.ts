import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { computeAllocationFromParentingPlan } from "@/lib/expenses-allocation";
import { planExpenseEntry, type ExpenseLoggingIntent, type ExpensePayer } from "@/lib/expenses-sharing";

/** Preview the same sharing decision a save will use. Nothing is written. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = (await request.json()) as {
      case_id?: string;
      amount?: number;
      category?: string;
      child_id?: string | null;
      sharing_intent?: ExpenseLoggingIntent | null;
      stated_percent?: number | null;
      paid_by?: ExpensePayer | null;
      notify_coparent?: boolean | null;
    };
    const amount = Number(body.amount);
    if (!body.case_id || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ message: "Missing case or amount" }, { status: 400 });
    }
    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .eq("case_id", body.case_id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }
    const allocation = await computeAllocationFromParentingPlan({
      caseId: body.case_id,
      amount,
      category: body.category ?? "other",
      childId: body.child_id ?? null,
    });
    const intent: ExpenseLoggingIntent =
      body.sharing_intent === "personal" || body.sharing_intent === "shared"
        ? body.sharing_intent
        : "unspecified";
    const plan = planExpenseEntry({
      intent,
      statedPercent:
        typeof body.stated_percent === "number" && Number.isFinite(body.stated_percent)
          ? body.stated_percent
          : null,
      notifyOverride: typeof body.notify_coparent === "boolean" ? body.notify_coparent : null,
      allocation,
      amount,
      payer: body.paid_by === "coparent" ? "coparent" : "self",
    });
    return NextResponse.json({
      mode: plan.mode,
      notifyCoparent: plan.notifyCoparent,
      needsPercent: plan.needsPercent,
      ruleApplied: plan.ruleApplied,
      review: plan.review,
      splitLabel: plan.fields?.split_label ?? null,
      otherParentShare: plan.fields?.other_parent_share ?? null,
      amountOwed: plan.fields?.amount_owed ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Preview failed" },
      { status: 500 }
    );
  }
}
