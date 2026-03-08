import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

/**
 * GET /api/kids/custody-schedule — custody schedule for the kid's case (kid session auth).
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
      return NextResponse.json(
        { message: "No family case found" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const { data, error } = await admin
      .from("custody_schedules")
      .select("id, case_id, schedule_type, rotation_start_date, user_starts_first, manual_pattern")
      .eq("case_id", caseId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { message: error.message ?? "Failed to load schedule" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error ? e.message : "Failed to load custody schedule",
      },
      { status: 500 }
    );
  }
}
