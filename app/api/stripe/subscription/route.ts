import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!membership?.case_id) {
      return NextResponse.json(
        {
          subscription_status: null,
          subscription_tier: null,
          subscription_period_end: null,
          pilot_user: null,
        },
        { status: 200 }
      );
    }

    const { data: caseRow, error: caseError } = await admin
      .from("cases")
      .select(
        "subscription_status, subscription_tier, subscription_period_end, pilot_user"
      )
      .eq("id", membership.case_id)
      .maybeSingle();

    if (caseError || !caseRow) {
      return NextResponse.json(
        {
          subscription_status: null,
          subscription_tier: null,
          subscription_period_end: null,
          pilot_user: null,
        },
        { status: 200 }
      );
    }

    const row = caseRow as {
      subscription_status?: string | null;
      subscription_tier?: string | null;
      subscription_period_end?: string | null;
      pilot_user?: boolean | null;
    };

    return NextResponse.json(
      {
        subscription_status: row.subscription_status ?? null,
        subscription_tier: row.subscription_tier ?? null,
        subscription_period_end: row.subscription_period_end ?? null,
        pilot_user: row.pilot_user ?? null,
      },
      { status: 200 }
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[stripe/subscription] error:", e);
      return NextResponse.json(
        {
          subscription_status: null,
          subscription_tier: null,
          subscription_period_end: null,
          pilot_user: null,
        },
        { status: 200 }
      );
  }
}

