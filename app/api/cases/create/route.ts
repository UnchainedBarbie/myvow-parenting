import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Create case + add primary member. Service role for writes.
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
    const admin = getServiceRoleClient();
    const { data: caseRow, error: caseError } = await admin
      .from("cases")
      .insert({ status: "active" })
      .select("id")
      .single();
    if (caseError) {
      return NextResponse.json(
        { message: caseError.message },
        { status: 500 }
      );
    }
    const { error: memberError } = await admin
      .from("case_members")
      .insert({
        case_id: caseRow.id,
        user_id: user.id,
        role: "parent",
        is_primary: true,
        is_participating: true,
      });
    if (memberError) {
      return NextResponse.json(
        { message: memberError.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ case_id: caseRow.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Create failed" },
      { status: 500 }
    );
  }
}
