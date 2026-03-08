import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/kids-invite/accept
 * Body: { token: string, pin: string }
 * Validate token, hash PIN, save to case_member.kids_pin_hash, mark invite accepted,
 * create kid_session, set cookie, return { success: true }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { token?: string; pin?: string };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";

    if (!token || token.length < 10) {
      return NextResponse.json(
        { message: "Invalid or missing token" },
        { status: 400 }
      );
    }
    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { message: "PIN must be 4–6 digits" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: invite, error: inviteErr } = await admin
      .from("kids_invites")
      .select("id, case_id, child_member_id, expires_at, accepted_at")
      .eq("token", token)
      .maybeSingle();

    if (inviteErr || !invite) {
      return NextResponse.json(
        { message: "Invalid or expired link" },
        { status: 404 }
      );
    }

    const inv = invite as { accepted_at?: string | null; expires_at?: string | null; child_member_id?: string };
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

    const { data: member } = await admin
      .from("case_members")
      .select("id, child_id")
      .eq("id", inv.child_member_id)
      .maybeSingle();

    const childId = (member as { child_id?: string | null } | null)?.child_id ?? null;
    if (!childId) {
      return NextResponse.json(
        { message: "Invalid invite" },
        { status: 400 }
      );
    }

    const pinHash = await bcrypt.hash(pin, 10);

    await admin
      .from("case_members")
      .update({
        kids_pin_hash: pinHash,
        kids_invite_status: "accepted",
      })
      .eq("id", inv.child_member_id);

    await admin
      .from("kids_invites")
      .update({ accepted_at: new Date().toISOString(), status: "accepted" })
      .eq("token", token);

    const sessionToken = randomUUID();
    const expiresAtSession = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error: sessionErr } = await admin.from("kid_sessions").insert({
      kid_id: childId,
      session_token: sessionToken,
      expires_at: expiresAtSession,
    });

    if (sessionErr) {
      return NextResponse.json(
        { message: "Failed to create session" },
        { status: 500 }
      );
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set("kid_session_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return res;
  } catch (e) {
    console.error("[kids-invite/accept POST]", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to complete setup" },
      { status: 500 }
    );
  }
}
