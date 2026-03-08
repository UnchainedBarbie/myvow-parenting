import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { getKidSession } from "@/lib/kids-session";

/**
 * GET /api/kids/case-details — case fields for kids UI (e.g. kids_label_user, kids_label_coparent). Kid session auth.
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
      .from("cases")
      .select("kids_label_user, kids_label_coparent")
      .eq("id", caseId)
      .single();

    if (error || !data) {
      return NextResponse.json({
        kids_label_user: null,
        kids_label_coparent: null,
      });
    }

    const row = data as { kids_label_user?: string | null; kids_label_coparent?: string | null };
    return NextResponse.json({
      kids_label_user: row.kids_label_user ?? null,
      kids_label_coparent: row.kids_label_coparent ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error ? e.message : "Failed to load case details",
      },
      { status: 500 }
    );
  }
}
