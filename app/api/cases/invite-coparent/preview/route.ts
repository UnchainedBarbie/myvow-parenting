import { NextRequest, NextResponse } from "next/server";
import { classifyInvite, hashInvitationToken, maskEmail, type InviteRow } from "@/lib/cases/coparent-invitation";
import { normalizeMemberEmail } from "@/lib/cases/register-member-email";
import { getServiceRoleClient } from "@/lib/supabase/server";

/** GET /api/cases/invite-coparent/preview?token= — public. Does not reveal the invited address. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (token.length < 20) {
    return NextResponse.json({ status: "invalid" });
  }
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("case_members")
    .select("id, case_id, user_id, external_email, invitation_status, invitation_token_hash, invitation_expires_at")
    .eq("invitation_token_hash", hashInvitationToken(token))
    .maybeSingle();
  if (error || !data) return NextResponse.json({ status: "invalid" });
  const raw = data as {
    id: string;
    case_id: string;
    user_id: string | null;
    external_email: string | null;
    invitation_status: string | null;
    invitation_token_hash: string | null;
    invitation_expires_at: string | null;
  };
  const row: InviteRow = {
    id: raw.id,
    caseId: raw.case_id,
    userId: raw.user_id,
    status: raw.invitation_status,
    email: raw.external_email ?? "",
    tokenHash: raw.invitation_token_hash,
    expiresAt: raw.invitation_expires_at,
  };
  const status = classifyInvite(row, new Date());
  return NextResponse.json({
    status,
    emailHint: status === "valid" && normalizeMemberEmail(row.email) ? maskEmail(row.email) : null,
  });
}
