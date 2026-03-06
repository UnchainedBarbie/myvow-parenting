import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { child_id, pin } = body as { child_id?: string; pin?: string };

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

    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { message: "PIN must be 4–6 digits." },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();

    // Find the parent's case_id.
    const { data: membership, error: membershipError } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { message: membershipError.message },
        { status: 500 }
      );
    }

    const caseId = membership?.case_id as string | null;
    if (!caseId) {
      return NextResponse.json(
        { message: "No case found for user" },
        { status: 404 }
      );
    }

    // Verify the child belongs to this case.
    const { data: child, error: childError } = await admin
      .from("children")
      .select("id, case_id")
      .eq("id", child_id)
      .eq("case_id", caseId)
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

    const pin_hash = await bcrypt.hash(pin, 10);

    const { error: updateError } = await admin
      .from("children")
      .update({
        pin_hash,
        pin_set_at: new Date().toISOString(),
      })
      .eq("id", child_id)
      .eq("case_id", caseId);

    if (updateError) {
      return NextResponse.json(
        { message: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[kids/pin] error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to set PIN" },
      { status: 500 }
    );
  }
}

