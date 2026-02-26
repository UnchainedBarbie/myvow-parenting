import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Invite co-parent: add by user_id or set external_email (single-parent mode).
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
    const { case_id, user_id, external_email } = body as {
      case_id?: string;
      user_id?: string;
      external_email?: string;
    };
    if (!case_id) {
      return NextResponse.json(
        { message: "Missing case_id" },
        { status: 400 }
      );
    }
    const admin = getServiceRoleClient();
    if (user_id) {
      const { error } = await admin.from("case_members").insert({
        case_id,
        user_id,
        role: "parent",
        is_primary: false,
        is_participating: true,
      });
      if (error) {
        return NextResponse.json(
          { message: error.message },
          { status: 500 }
        );
      }
    } else if (external_email) {
      const { data: primary } = await admin
        .from("case_members")
        .select("id")
        .eq("case_id", case_id)
        .eq("user_id", user.id)
        .eq("is_primary", true)
        .single();
      if (!primary) {
        return NextResponse.json(
          { message: "Not primary member" },
          { status: 403 }
        );
      }
      const { error } = await admin
        .from("case_members")
        .update({ external_email })
        .eq("id", primary.id);
      if (error) {
        return NextResponse.json(
          { message: error.message },
          { status: 500 }
        );
      }
    } else {
      return NextResponse.json(
        { message: "Provide user_id or external_email" },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Invite failed" },
      { status: 500 }
    );
  }
}
