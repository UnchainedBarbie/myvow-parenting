import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/kids-invite?token=...
 * Validate token (not expired), return { child_name, case_id } for the invite page.
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token || typeof token !== "string" || token.length < 10) {
      return NextResponse.json(
        { message: "Invalid or missing token" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: invite, error: inviteErr } = await admin
      .from("kids_invites")
      .select("id, case_id, child_member_id, email, expires_at, accepted_at")
      .eq("token", token)
      .maybeSingle();

    if (inviteErr || !invite) {
      return NextResponse.json(
        { message: "Invalid or expired link" },
        { status: 404 }
      );
    }

    const inv = invite as { expires_at?: string | null; accepted_at?: string | null; child_member_id?: string };
    if (inv.accepted_at) {
      return NextResponse.json(
        { message: "This invite has already been used" },
        { status: 400 }
      );
    }
    const expiresAt = inv.expires_at ? new Date(inv.expires_at) : null;
    if (expiresAt && expiresAt <= new Date()) {
      return NextResponse.json(
        { message: "This invite has expired" },
        { status: 400 }
      );
    }

    // child_member_id is case_members.id; get case_member to find child_id
    const { data: member } = await admin
      .from("case_members")
      .select("child_id")
      .eq("id", inv.child_member_id)
      .maybeSingle();

    const childId = (member as { child_id?: string | null } | null)?.child_id ?? null;
    if (!childId) {
      return NextResponse.json(
        { message: "Invalid invite" },
        { status: 400 }
      );
    }

    const { data: child } = await admin
      .from("children")
      .select("first_name")
      .eq("id", childId)
      .maybeSingle();

    const childName = (child as { first_name?: string | null } | null)?.first_name ?? "there";

    return NextResponse.json({
      child_name: childName,
      case_id: (invite as { case_id?: string }).case_id,
    });
  } catch (e) {
    console.error("[kids-invite GET]", e);
    return NextResponse.json(
      { message: "Something went wrong" },
      { status: 500 }
    );
  }
}
