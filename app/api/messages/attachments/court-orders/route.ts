import { NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/messages/attachments/court-orders
 * Returns court orders (parenting_plans) for the current user's case, for use in the "Reference Court Order" modal.
 */
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
      .select("case_id")
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
      return NextResponse.json({ court_orders: [] });
    }

    const { data, error } = await admin
      .from("parenting_plans")
      .select("id, title, custody_type, effective_date, created_at")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ court_orders: data ?? [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load court orders" },
      { status: 500 }
    );
  }
}
