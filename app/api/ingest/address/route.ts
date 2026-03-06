import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function getUserAndCaseId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null as null, caseId: null as string | null };
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
      .select("ingest_email")
      .eq("id", caseId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ingest_email: (row as { ingest_email?: string | null } | null)?.ingest_email ?? null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[ingest/address] GET error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load ingest email" },
      { status: 500 }
    );
  }
}

