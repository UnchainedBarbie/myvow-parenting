import { NextRequest, NextResponse } from "next/server";
import { acceptanceUpdate, decideAcceptance, hashInvitationToken, type InviteRow } from "@/lib/cases/coparent-invitation";
import { registerEmailsForUser } from "@/lib/cases/register-member-email";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/cases/invite-coparent/accept
 * Body: { token: string }
 * Links the signed-in user to the existing pending case member when the email matches.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ error: "Sign in before accepting this invitation." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (token.length < 20) {
      return NextResponse.json({ error: "This invitation link is not valid." }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const tokenHash = hashInvitationToken(token);
    const { data } = await admin
      .from("case_members")
      .select("id, case_id, user_id, external_email, invitation_status, invitation_token_hash, invitation_expires_at")
      .eq("invitation_token_hash", tokenHash)
      .maybeSingle();
    const raw = data as {
      id: string;
      case_id: string;
      user_id: string | null;
      external_email: string | null;
      invitation_status: string | null;
      invitation_token_hash: string | null;
      invitation_expires_at: string | null;
    } | null;
    const row: InviteRow | null = raw
      ? {
          id: raw.id,
          caseId: raw.case_id,
          userId: raw.user_id,
          status: raw.invitation_status,
          email: raw.external_email ?? "",
          tokenHash: raw.invitation_token_hash,
          expiresAt: raw.invitation_expires_at,
        }
      : null;

    const { data: memberships } = await admin.from("case_members").select("case_id").eq("user_id", user.id);
    const existingCaseIds = ((memberships ?? []) as { case_id?: string }[])
      .map((membership) => membership.case_id)
      .filter((caseId): caseId is string => Boolean(caseId));

    const decision = decideAcceptance({
      row,
      now: new Date(),
      authUserId: user.id,
      authEmail: user.email,
      existingCaseIds,
    });
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });

    const { data: linked, error: linkError } = await admin
      .from("case_members")
      .update(acceptanceUpdate(user.id))
      .eq("id", decision.memberId)
      .eq("case_id", decision.caseId)
      .eq("invitation_token_hash", tokenHash)
      .is("user_id", null)
      .select("id")
      .maybeSingle();
    if (linkError || !linked) {
      return NextResponse.json({ error: "This invitation has already been used." }, { status: 400 });
    }

    const { data: profile } = await admin.from("users").select("id").eq("id", user.id).maybeSingle();
    if (!profile) {
      await admin.from("users").insert({
        id: user.id,
        email: user.email,
        full_name: user.email,
      });
    }
    await registerEmailsForUser(admin, user.id, user.email);
    return NextResponse.json({ ok: true });
  } catch {
    console.error("[cases/invite-coparent/accept] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
