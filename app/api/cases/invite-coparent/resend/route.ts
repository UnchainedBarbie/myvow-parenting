import { NextRequest, NextResponse } from "next/server";
import { invitationFailureLog } from "@/lib/cases/coparent-invitation";
import { normalizeMemberEmail } from "@/lib/cases/register-member-email";
import { deliverCoparentInvitation } from "@/lib/cases/send-coparent-invitation";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/cases/invite-coparent/resend
 * Body: { memberId: string }
 * Sends one new invitation for a pending co-parent on the signed-in parent's case.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const memberId = typeof body.memberId === "string" ? body.memberId.trim() : "";
    if (!memberId) return NextResponse.json({ error: "Co-parent is required." }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    const caseId = (membership as { case_id?: string } | null)?.case_id;
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const { data: member } = await admin
      .from("case_members")
      .select("id, case_id, user_id, role, external_email, invitation_status, invitation_sent_at")
      .eq("id", memberId)
      .eq("case_id", caseId)
      .maybeSingle();
    const row = member as {
      user_id?: string | null;
      role?: string | null;
      external_email?: string | null;
      invitation_status?: string | null;
      invitation_sent_at?: string | null;
    } | null;
    const email = normalizeMemberEmail(row?.external_email);
    if (!row || row.role !== "parent" || row.user_id || row.invitation_status === "connected" || !email) {
      return NextResponse.json({ error: "There is no pending co-parent to invite." }, { status: 404 });
    }

    const { data: inviter } = await admin.from("users").select("full_name").eq("id", user.id).maybeSingle();
    const inviterName = ((inviter as { full_name?: string | null } | null)?.full_name ?? "").trim();
    const delivery = await deliverCoparentInvitation(admin, {
      caseId,
      memberId,
      email,
      inviterName,
      origin: req.nextUrl.origin,
      previousSentAt: row.invitation_sent_at ?? null,
    });
    if (!delivery.emailSent) {
      console.error(
        "[cases/invite-coparent/resend] provider rejected",
        invitationFailureLog({
          failure: delivery.failure,
          publicError: delivery.error,
          messageStream: delivery.messageStream,
          from: delivery.from,
          serverTokenConfigured: Boolean(process.env.POSTMARK_SERVER_TOKEN?.trim()),
        })
      );
    }
    return NextResponse.json({ ok: true, emailSent: delivery.emailSent, error: delivery.error });
  } catch {
    console.error("[cases/invite-coparent/resend] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
