import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { Resend } from "resend";

const RESEND_FROM = process.env.RESEND_FROM ?? "MyVow <onboarding@resend.dev>";

/**
 * POST /api/kids-invites
 * Body: { child_id: string, email: string, kids_label_user: string }
 * Parent auth. Creates or gets case_member for child, creates invite, sends email.
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

    const body = await request.json().catch(() => ({})) as {
      child_id?: string;
      email?: string;
      kids_label_user?: string;
    };
    const childId = typeof body.child_id === "string" ? body.child_id.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const kidsLabelUser = typeof body.kids_label_user === "string" ? body.kids_label_user.trim() : "Your parent";

    if (!childId || !email) {
      return NextResponse.json(
        { message: "child_id and email are required" },
        { status: 400 }
      );
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { message: "Invalid email address" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    const caseId = (membership as { case_id?: string } | null)?.case_id ?? null;
    if (!caseId) {
      return NextResponse.json({ message: "No case found" }, { status: 404 });
    }

    const { data: child } = await admin
      .from("children")
      .select("id, first_name")
      .eq("id", childId)
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!child) {
      return NextResponse.json({ message: "Child not found" }, { status: 404 });
    }

    // Get or create case_member row for this child (for email invite)
    let { data: childMember } = await admin
      .from("case_members")
      .select("id")
      .eq("case_id", caseId)
      .eq("child_id", childId)
      .maybeSingle();

    if (!childMember) {
      const { data: inserted, error: insertErr } = await admin
        .from("case_members")
        .insert({
          case_id: caseId,
          user_id: null,
          display_name: (child as { first_name?: string }).first_name ?? "Child",
          child_id: childId,
          kids_email: email,
          kids_invite_status: "pending",
        })
        .select("id")
        .single();
      if (insertErr || !inserted) {
        return NextResponse.json(
          { message: insertErr?.message ?? "Failed to create invite record" },
          { status: 500 }
        );
      }
      childMember = inserted;
    } else {
      await admin
        .from("case_members")
        .update({
          kids_email: email,
          kids_invite_status: "pending",
        })
        .eq("id", (childMember as { id: string }).id);
    }

    const token = randomUUID();
    const { error: inviteErr } = await admin.from("kids_invites").insert({
      case_id: caseId,
      child_member_id: (childMember as { id: string }).id,
      email,
      token,
      status: "pending",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (inviteErr) {
      return NextResponse.json(
        { message: inviteErr.message ?? "Failed to create invite" },
        { status: 500 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://app.myvowparenting.com";
    const inviteLink = `${baseUrl}/kids-invite?token=${encodeURIComponent(token)}`;

    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey) {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from: RESEND_FROM,
        to: email,
        subject: "You've been invited to MyVow",
        text: `${kidsLabelUser} invited you to view your family calendar. Click here to get started: ${inviteLink}`,
      });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[kids-invites POST]", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to send invite" },
      { status: 500 }
    );
  }
}
