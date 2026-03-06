import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

async function getUserAndCaseId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, caseId: null as string | null };
  }

  const admin = getServiceRoleClient();
  const { data: membership, error: membershipError } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.case_id) {
    return { user, caseId: null as string | null };
  }

  return { user, caseId: membership.case_id as string };
}

function generateFamilyCode(): string {
  const raw = randomUUID().replace(/-/g, "");
  return raw.slice(0, 6).toUpperCase();
}

export async function GET(_request: NextRequest) {
  try {
    const { user, caseId } = await getUserAndCaseId();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (!caseId) {
      return NextResponse.json(
        { message: "No case found for user" },
        { status: 404 }
      );
    }

    const admin = getServiceRoleClient();
    const { data: row, error } = await admin
      .from("cases")
      .select("family_code")
      .eq("id", caseId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      family_code: (row as { family_code?: string | null } | null)?.family_code ?? null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[family/code] GET error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load family code" },
      { status: 500 }
    );
  }
}

export async function PATCH(_request: NextRequest) {
  try {
    const { user, caseId } = await getUserAndCaseId();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (!caseId) {
      return NextResponse.json(
        { message: "No case found for user" },
        { status: 404 }
      );
    }

    const newCode = generateFamilyCode();

    const admin = getServiceRoleClient();
    const { error } = await admin
      .from("cases")
      .update({ family_code: newCode })
      .eq("id", caseId);

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ family_code: newCode });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[family/code] PATCH error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to rotate family code" },
      { status: 500 }
    );
  }
}

