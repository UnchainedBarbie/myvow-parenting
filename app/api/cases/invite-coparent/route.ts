import { NextRequest, NextResponse } from "next/server";
import { saveAndInviteCoparent } from "@/lib/cases/send-coparent-invitation";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/cases/invite-coparent
 * Body: { email: string; name?: string }
 * Saves the pending co-parent, then asks the email provider to send one invitation.
 * The co-parent record is kept when delivery fails.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    const caseId = (membership as { case_id?: string } | null)?.case_id;
    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email : "";
    const name = typeof body.name === "string" ? body.name.trim() || null : null;

    const { data: inviter } = await admin
      .from("users")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();
    const inviterName = ((inviter as { full_name?: string | null } | null)?.full_name ?? "").trim();

    const saved = await saveAndInviteCoparent(admin, {
      caseId,
      userId: user.id,
      userEmail: user.email ?? null,
      email,
      name,
      inviterName,
      origin: req.nextUrl.origin,
    });
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
    return NextResponse.json({
      ok: true,
      emailSent: saved.emailSent,
      error: saved.error,
    });
  } catch {
    console.error("[cases/invite-coparent] save failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
