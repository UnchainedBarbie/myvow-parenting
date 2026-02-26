import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

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
      split_percent,
      receipt_file_id,
    } = body as {
      case_id?: string;
      description?: string;
      amount?: number;
      category?: string;
      child_id?: string;
      split_percent?: number;
      receipt_file_id?: string;
    };
    if (!case_id || !description || amount == null) {
      return NextResponse.json(
        { message: "Missing case_id, description, or amount" },
        { status: 400 }
      );
    }
    const admin = getServiceRoleClient();
    const amountNum = Number(amount);
    const { data: caseRow } = await admin
      .from("cases")
      .select("custody_split_percent")
      .eq("id", case_id)
      .single();
    const splitPct = split_percent ?? caseRow?.custody_split_percent ?? 50;
    const amountOwed = amountNum * (Number(splitPct) / 100);
    const { data: expense, error } = await admin
      .from("expenses")
      .insert({
        case_id,
        submitted_by: user.id,
        description,
        amount: amountNum,
        category: category ?? "other",
        child_id: child_id ?? null,
        split_percent: split_percent ?? null,
        amount_owed: amountOwed,
        receipt_file_id: receipt_file_id ?? null,
        status: "submitted",
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
