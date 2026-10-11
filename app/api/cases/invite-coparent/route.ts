import { NextRequest, NextResponse } from "next/server";
import { registerCaseMemberEmail } from "@/lib/cases/register-member-email";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/cases/invite-coparent
 * Body: { email: string; name?: string }
 * Creates or updates the invited co-parent slot for the current user's case.
 * Stores in case_members: external_email, display_name, invitation_status='invited'.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership?.case_id) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
    const name = typeof body.name === "string" ? body.name.trim() || null : null;

    const case_id = membership.case_id;

    const { data: existing } = await admin
      .from("case_members")
      .select("id, external_email, display_name, invitation_status")
      .eq("case_id", case_id)
      .is("user_id", null)
      .maybeSingle();

    let memberId: string;
    if (existing?.id) {
      const previous = existing as {
        id: string;
        external_email: string | null;
        display_name: string | null;
        invitation_status: string | null;
      };
      const { error: updateErr } = await admin
        .from("case_members")
        .update({
          external_email: email,
          display_name: name,
          invitation_status: "invited",
        })
        .eq("id", previous.id);
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
      memberId = previous.id;
      const registered = await registerCaseMemberEmail(admin, {
        caseId: case_id,
        caseMemberId: memberId,
        email,
      });
      if (!registered.ok) {
        await admin
          .from("case_members")
          .update({
            external_email: previous.external_email,
            display_name: previous.display_name,
            invitation_status: previous.invitation_status,
          })
          .eq("id", previous.id);
        return NextResponse.json({ error: registered.message }, { status: 500 });
      }
    } else {
      const { data: created, error: insertErr } = await admin
        .from("case_members")
        .insert({
          case_id,
          user_id: null,
          role: "parent",
          is_primary: false,
          external_email: email,
          display_name: name,
          invitation_status: "invited",
        })
        .select("id")
        .single();
      if (insertErr || !created) {
        return NextResponse.json(
          { error: insertErr?.message ?? "Could not invite co-parent" },
          { status: 500 }
        );
      }
      memberId = (created as { id: string }).id;
      const registered = await registerCaseMemberEmail(admin, {
        caseId: case_id,
        caseMemberId: memberId,
        email,
      });
      if (!registered.ok) {
        await admin.from("case_members").delete().eq("id", memberId);
        return NextResponse.json({ error: registered.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[cases/invite-coparent]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
