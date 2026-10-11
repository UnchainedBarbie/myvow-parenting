import { NextRequest, NextResponse } from "next/server";
import { registerCaseMemberEmail } from "@/lib/cases/register-member-email";
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
    const { data: member, error: memberError } = await admin
      .from("case_members")
      .insert({
        case_id: caseRow.id,
        user_id: user.id,
        role: "parent",
        is_primary: true,
        is_participating: true,
      })
      .select("id")
      .single();
    if (memberError || !member) {
      await admin.from("cases").delete().eq("id", caseRow.id);
      return NextResponse.json(
        { message: memberError?.message ?? "Could not add the primary member" },
        { status: 500 }
      );
    }
    const { data: profile, error: profileError } = await admin
      .from("users")
      .select("email")
      .eq("id", user.id)
      .maybeSingle();
    const email = (profile as { email?: string | null } | null)?.email ?? "";
    if (profileError || !email) {
      await admin.from("case_members").delete().eq("id", (member as { id: string }).id);
      await admin.from("cases").delete().eq("id", caseRow.id);
      return NextResponse.json(
        { message: profileError?.message ?? "User has no email" },
        { status: 500 }
      );
    }
    const registered = await registerCaseMemberEmail(admin, {
      caseId: caseRow.id,
      caseMemberId: (member as { id: string }).id,
      email,
    });
    if (!registered.ok) {
      await admin.from("case_members").delete().eq("id", (member as { id: string }).id);
      await admin.from("cases").delete().eq("id", caseRow.id);
      return NextResponse.json({ message: registered.message }, { status: 500 });
    }
    return NextResponse.json({ case_id: caseRow.id });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Create failed" },
      { status: 500 }
    );
  }
}
