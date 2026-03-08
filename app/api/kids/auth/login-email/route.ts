import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/kids/auth/login-email
 * Body: { email: string, pin: string }
 * Match case_members by kids_email, verify kids_pin_hash, create kid_session (kid_id = case_member.child_id), set cookie.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { email?: string; pin?: string };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const pin = typeof body.pin === "string" ? body.pin : "";

    if (!email) {
      return NextResponse.json(
        { success: false, message: "Email and PIN are required." },
        { status: 401 }
      );
    }
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { success: false, message: "Email and PIN are required." },
        { status: 401 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: member, error: memberErr } = await admin
      .from("case_members")
      .select("id, child_id, kids_email, kids_pin_hash, kids_invite_status")
      .eq("kids_email", email)
      .not("child_id", "is", null)
      .maybeSingle();

    if (memberErr || !member) {
      return NextResponse.json(
        { success: false, message: "Email or PIN is incorrect." },
        { status: 401 }
      );
    }

    const m = member as { kids_invite_status?: string | null; kids_pin_hash?: string | null; child_id?: string | null };
    if (m.kids_invite_status !== "accepted") {
      return NextResponse.json(
        { success: false, message: "Email or PIN is incorrect." },
        { status: 401 }
      );
    }

    const hash = m.kids_pin_hash;
    if (!hash || !(await bcrypt.compare(pin, hash))) {
      return NextResponse.json(
        { success: false, message: "Email or PIN is incorrect." },
        { status: 401 }
      );
    }

    const childId = m.child_id;
    if (!childId) {
      return NextResponse.json(
        { success: false, message: "Email or PIN is incorrect." },
        { status: 401 }
      );
    }

    const sessionToken = randomUUID();
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error: insertError } = await admin
      .from("kid_sessions")
      .insert({
        kid_id: childId,
        session_token: sessionToken,
        expires_at: expiresAt,
      });

    if (insertError) {
      return NextResponse.json(
        { success: false, message: "Email or PIN is incorrect." },
        { status: 500 }
      );
    }

    const res = NextResponse.json({
      success: true,
      child_id: childId,
    });

    res.cookies.set("kid_session_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return res;
  } catch (e) {
    console.error("[kids/auth/login-email]", e);
    return NextResponse.json(
      { success: false, message: "Email or PIN is incorrect." },
      { status: 500 }
    );
  }
}
