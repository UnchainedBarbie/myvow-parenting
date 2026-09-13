import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { processChatMessage } from "@/lib/sage/chat";

export const runtime = "nodejs";

/**
 * POST /api/sage/chat
 * Body: { message: string, conversation_context?: unknown }
 * Propose-only: runs chat message through the shared Sage engine and returns
 * reply + canonical plan.proposals. Does not execute tools or write sage_items.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      message?: unknown;
      conversation_context?: unknown;
    } | null;

    const message =
      typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const { data: membership, error: membershipError } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.error("[sage/chat] membership error:", membershipError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!membership?.case_id) {
      return NextResponse.json({ error: "No case found" }, { status: 403 });
    }

    const caseId = membership.case_id as string;

    const { data: profile } = await admin
      .from("users")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();

    const timezone =
      profile && typeof (profile as { timezone?: string }).timezone === "string"
        ? (profile as { timezone: string }).timezone.trim() || "America/Denver"
        : "America/Denver";

    const { reply, actions, result } = await processChatMessage({
      message,
      case_id: caseId,
      timezone,
      conversation_context: body?.conversation_context,
    });

    return NextResponse.json({
      reply,
      actions,
      // Helpful for debugging / clients; not required by the contract
      meta: {
        item_type: result.interpretation.intent.item_type,
        domain: result.interpretation.intent.domain,
        summary: result.interpretation.intent.summary,
        child_ids: result.child_ids,
        unresolved_children: result.unresolved_children,
        resolved_dates: result.resolved_dates,
        plan_status: result.plan.status,
      },
    });
  } catch (e) {
    console.error("[sage/chat] Unhandled error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    );
  }
}
