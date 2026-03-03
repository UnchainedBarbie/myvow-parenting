import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

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
    if (action === "approve" || action === "resolve") {
      const { error } = await admin
        .from("expenses")
        .update({
          status: "resolved",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", expense_id);
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
        .eq("id", expense_id);
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
        .eq("id", expense_id);
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
