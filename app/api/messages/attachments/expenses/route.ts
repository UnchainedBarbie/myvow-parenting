import { NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { loadVisibleExpenses } from "@/lib/expenses-visibility";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();

    const {
      data: membership,
      error: membershipError,
    } = await admin
      .from("case_members")
      .select("case_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { error: membershipError.message },
        { status: 500 }
      );
    }

    const caseId = membership?.case_id as string | null;
    if (!caseId) {
      return NextResponse.json({ expenses: [] });
    }

    const loaded = await loadVisibleExpenses(
      (columns) =>
        admin
          .from("expenses")
          .select(columns)
          .eq("case_id", caseId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
      "id, description, amount, category, status, created_at",
      { userId: user.id, role: membership?.role ?? null }
    );

    if (loaded.error) {
      return NextResponse.json({ error: loaded.error.message }, { status: 500 });
    }

    return NextResponse.json({ expenses: loaded.rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load expenses" },
      { status: 500 }
    );
  }
}

