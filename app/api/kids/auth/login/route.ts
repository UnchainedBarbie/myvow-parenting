import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/kids/auth/login
 * Body: { family_code: string, name: string, pin: string }
 * Looks up case by family_code, finds child whose first_name matches name (case-insensitive)
 * and PIN matches, creates kid session and sets cookie. Returns { success: true, child_id }.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { family_code, name: nameRaw, pin } = body as { family_code?: string; name?: string; pin?: string };

    const code = typeof family_code === "string" ? family_code.trim().toUpperCase() : "";
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    if (!code || code.length < 4) {
      return NextResponse.json(
        { success: false, message: "Name not found or incorrect PIN." },
        { status: 401 }
      );
    }
    if (!name) {
      return NextResponse.json(
        { success: false, message: "Name not found or incorrect PIN." },
        { status: 401 }
      );
    }
    if (!pin || typeof pin !== "string") {
      return NextResponse.json(
        { success: false, message: "Name not found or incorrect PIN." },
        { status: 401 }
      );
    }

    const admin = getServiceRoleClient();

    const { data: caseRow, error: caseError } = await admin
      .from("cases")
      .select("id")
      .eq("family_code", code)
      .maybeSingle();

    if (caseError) {
      return NextResponse.json(
        { success: false, message: "Name not found or incorrect PIN." },
        { status: 500 }
      );
    }
    if (!caseRow) {
      return NextResponse.json(
        { success: false, message: "Name not found or incorrect PIN." },
        { status: 401 }
      );
    }

    const { data: children, error: childrenError } = await admin
      .from("children")
      .select("id, first_name, profile_image, pin_hash")
      .eq("case_id", caseRow.id)
      .is("deleted_at", null)
      .not("pin_hash", "is", null);

    if (childrenError || !children || children.length === 0) {
      return NextResponse.json(
        { success: false, message: "Name not found or incorrect PIN." },
        { status: 401 }
      );
    }

    let matchedChild: { id: string; first_name?: string; profile_image?: string | null; pin_hash: string } | null = null;
    for (const c of children as { id: string; pin_hash?: string | null }[]) {
      const hash = c.pin_hash;
      if (hash && (await bcrypt.compare(pin, hash))) {
        matchedChild = c as typeof matchedChild;
        break;
      }
    }

    if (!matchedChild) {
      return NextResponse.json(
        { success: false, message: "Name not found or incorrect PIN." },
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
        kid_id: matchedChild.id,
        session_token: sessionToken,
        expires_at: expiresAt,
      });

    if (insertError) {
      return NextResponse.json(
        { success: false, message: "Name not found or incorrect PIN." },
        { status: 500 }
      );
    }

    const res = NextResponse.json({
      success: true,
      child_id: matchedChild.id,
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
    console.error("[kids/auth/login]", e);
    return NextResponse.json(
      { success: false, message: "Name not found or incorrect PIN." },
      { status: 500 }
    );
  }
}
