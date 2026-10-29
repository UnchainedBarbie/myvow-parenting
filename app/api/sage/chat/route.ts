import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { processChatMessage } from "@/lib/sage/chat";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { loadCalendarContext } from "@/lib/sage/calendar-chat";
import { loadKnownCoparents } from "@/lib/sage/known-coparents";
import { AMBIGUOUS_CASE_MESSAGE, resolveActiveCase } from "@/lib/cases/resolve-active-case";

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
      case_id?: unknown;
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
    const activeCase = await resolveActiveCase(admin, user.id, {
      requestedCaseId: typeof body?.case_id === "string" ? body.case_id : null,
    });
    if (activeCase.status === "error") {
      console.error("[sage/chat] membership error:", activeCase.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (activeCase.status === "ambiguous") {
      return NextResponse.json({ error: AMBIGUOUS_CASE_MESSAGE, code: "case_ambiguous" }, { status: 409 });
    }
    if (!activeCase.caseId) {
      return NextResponse.json({ error: "No case found" }, { status: 403 });
    }

    const caseId = activeCase.caseId;

    const { data: profile } = await admin
      .from("users")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();

    const timezone =
      profile && typeof (profile as { timezone?: string }).timezone === "string"
        ? (profile as { timezone: string }).timezone.trim() || "America/Denver"
        : "America/Denver";

    const coparents = await loadKnownCoparents(admin, caseId, user.id);
    const calendarContext = await loadCalendarContext(admin, caseId, user.id);
    const context = body?.conversation_context;
    const conversation =
      context && typeof context === "object"
        ? (context as ConversationContext)
        : null;
    const { reply, actions, result } = await processChatMessage({
      message,
      case_id: caseId,
      timezone,
      conversation,
      coparents,
      children: calendarContext.children,
      events: calendarContext.events,
      viewerId: user.id,
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
        amounts: result.interpretation.entities.amounts,
        dates: result.interpretation.entities.dates,
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
