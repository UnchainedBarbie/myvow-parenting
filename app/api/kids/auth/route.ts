import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { getServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { family_code, child_id, pin } = body as {
      family_code?: string;
      child_id?: string;
      pin?: string;
    };

    if (!family_code || typeof family_code !== "string") {
      return NextResponse.json(
        { message: "family_code is required" },
        { status: 400 }
      );
    }
    if (!child_id || typeof child_id !== "string") {
      return NextResponse.json(
        { message: "child_id is required" },
        { status: 400 }
      );
    }
    if (!pin || typeof pin !== "string") {
      return NextResponse.json(
        { message: "PIN is required" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    // Look up case by family_code
    const { data: caseRow, error: caseError } = await admin
      .from("cases")
      .select("id")
      .eq("family_code", family_code)
      .maybeSingle();

    if (caseError) {
      return NextResponse.json(
        { message: caseError.message },
        { status: 500 }
      );
    }
    if (!caseRow) {
      return NextResponse.json(
        { message: "Family not found" },
        { status: 404 }
      );
    }

    // Find child within that case
    const { data: child, error: childError } = await admin
      .from("children")
      .select("id, first_name, profile_image, pin_hash")
      .eq("id", child_id)
      .eq("case_id", caseRow.id)
      .maybeSingle();

    if (childError) {
      return NextResponse.json(
        { message: childError.message },
        { status: 500 }
      );
    }
    if (!child) {
      return NextResponse.json(
        { message: "Child not found" },
        { status: 404 }
      );
    }

    const pinHash = (child as { pin_hash?: string | null }).pin_hash;
    if (!pinHash) {
      return NextResponse.json(
        { message: "Invalid PIN" },
        { status: 401 }
      );
    }

    const ok = await bcrypt.compare(pin, pinHash);
    if (!ok) {
      return NextResponse.json(
        { message: "Invalid PIN" },
        { status: 401 }
      );
    }

    // Create kid session
    const sessionToken = randomUUID();
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error: insertError } = await admin
      .from("kid_sessions")
      .insert({
        kid_id: child.id,
        session_token: sessionToken,
        expires_at: expiresAt,
      });

    if (insertError) {
      return NextResponse.json(
        { message: insertError.message },
        { status: 500 }
      );
    }

    const res = NextResponse.json({
      kid_id: child.id as string,
      name: (child.first_name as string) ?? "",
      avatar_url: (child.profile_image as string | null) ?? null,
    });

    res.cookies.set("kid_session_token", sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
    });

    return res;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[kids/auth login] error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to log in" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = request.cookies.get("kid_session_token")?.value;
    const admin = getServiceRoleClient();

    if (token) {
      await admin
        .from("kid_sessions")
        .delete()
        .eq("session_token", token);
    }

    const res = NextResponse.json({ success: true });
    res.cookies.set("kid_session_token", "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return res;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[kids/auth logout] error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to log out" },
      { status: 500 }
    );
  }
}

