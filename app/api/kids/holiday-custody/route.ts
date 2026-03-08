import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

/**
 * GET /api/kids/holiday-custody — holiday custody for the kid's case (kid session). Query: ?year=
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getKidSession(request);
    if (!session) {
      return NextResponse.json({ message: "Not logged in" }, { status: 401 });
    }

    const child = session.child as { case_id?: string | null };
    const caseId = child.case_id ?? null;
    if (!caseId) {
      return NextResponse.json({ message: "No family case found" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get("year");
    const yearFilter = yearParam != null && yearParam !== "" ? parseInt(yearParam, 10) : null;

    const admin = getServiceRoleClient();
    let query = admin
      .from("holiday_custody")
      .select("id, holiday_name, start_date, end_date, custodial_parent, year")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("start_date", { ascending: true });

    if (yearFilter != null && !Number.isNaN(yearFilter)) {
      query = query.eq("year", yearFilter);
    }

    const { data: rows, error } = await query;

    if (error) {
      return NextResponse.json({ message: error.message ?? "Failed to load holidays" }, { status: 500 });
    }

    return NextResponse.json(rows ?? []);
  } catch (e) {
    console.error("[kids/holiday-custody GET]", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load holidays" },
      { status: 500 }
    );
  }
}
