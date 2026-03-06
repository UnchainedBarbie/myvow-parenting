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
      .select("onboarding_completed, onboarding_step, app_mode")
      .eq("id", caseId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    const r = row as {
      onboarding_completed?: boolean | null;
      onboarding_step?: string | number | null;
      app_mode?: string | null;
    } | null;

    return NextResponse.json({
      onboarding_completed: r?.onboarding_completed ?? false,
      onboarding_step: r?.onboarding_step ?? null,
      app_mode: r?.app_mode ?? null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[onboarding] GET error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load onboarding" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
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

    const body = await request.json().catch(() => ({})) as {
      onboarding_completed?: boolean;
      onboarding_step?: string | number;
      app_mode?: string;
    };

    const updates: Record<string, unknown> = {};
    if (body.onboarding_completed !== undefined) {
      updates.onboarding_completed = !!body.onboarding_completed;
    }
    if (body.onboarding_step !== undefined) {
      updates.onboarding_step = body.onboarding_step;
    }
    if (body.app_mode !== undefined) {
      updates.app_mode = body.app_mode;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { message: "No valid fields to update" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const { error } = await admin
      .from("cases")
      .update(updates)
      .eq("id", caseId);

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[onboarding] PATCH error:", e);
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to update onboarding" },
      { status: 500 }
    );
  }
}
