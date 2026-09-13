import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { processChatMessage } from "@/lib/sage/chat";

export const runtime = "nodejs";

const SAGE_ITEM_SELECT =
  "id, item_type, domain, summary, evidence_excerpt, urgency, action_required, child_ids, tool_input, plan, status, flagged, created_at";

const JOURNAL_SELECT_BASE =
  "id, user_id, role, content, created_at, session_id";
const JOURNAL_SELECT = `${JOURNAL_SELECT_BASE}, sage_item_id`;

function missingSageItemIdColumn(error: { message?: string } | null): boolean {
  return !!error?.message && /sage_item_id/i.test(error.message);
}

const FALLBACK_REPLY =
  "I'm here with you. Take a breath, then tell me what feels most important about this moment for your children.";

type SageMessageRow = {
  id: string;
  user_id: string;
  role: "user" | "sage";
  content: string;
  created_at: string;
  session_id?: string | null;
  sage_item_id?: string | null;
  sage_item?: unknown | null;
};

function timezoneFromProfile(profile: { timezone?: string } | null): string {
  if (profile && typeof profile.timezone === "string") {
    return profile.timezone.trim() || "America/Denver";
  }
  return "America/Denver";
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id") ?? undefined;

    const admin = getServiceRoleClient();
    const loadJournal = async (columns: string) => {
      let q = admin
        .from("sage_journal_messages")
        .select(columns)
        .eq("user_id", user.id);
      q = sessionId ? q.eq("session_id", sessionId) : q.is("session_id", null);
      return q.order("created_at", { ascending: true });
    };

    let { data, error } = await loadJournal(JOURNAL_SELECT);
    if (error && missingSageItemIdColumn(error)) {
      ({ data, error } = await loadJournal(JOURNAL_SELECT_BASE));
    }

    if (error) {
      return NextResponse.json(
        { message: error.message },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as unknown as SageMessageRow[];
    const itemIds = [
      ...new Set(
        rows
          .map((m) => m.sage_item_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ];
    const userMessageIds = rows.filter((m) => m.role === "user").map((m) => m.id);

    const itemsById = new Map<string, unknown>();
    const itemsBySourceId = new Map<string, unknown>();
    if (itemIds.length > 0) {
      const { data: items } = await admin
        .from("sage_items")
        .select(SAGE_ITEM_SELECT)
        .in("id", itemIds)
        .eq("visible_to", user.id);
      for (const item of items ?? []) {
        const id = (item as { id?: string }).id;
        if (id) itemsById.set(id, item);
      }
    }
    if (userMessageIds.length > 0) {
      const { data: chatItems } = await admin
        .from("sage_items")
        .select(`${SAGE_ITEM_SELECT}, source_id`)
        .eq("source_type", "chat")
        .eq("visible_to", user.id)
        .in("source_id", userMessageIds);
      for (const item of chatItems ?? []) {
        const sourceId = (item as { source_id?: string }).source_id;
        if (sourceId) itemsBySourceId.set(sourceId, item);
      }
    }

    const messages: SageMessageRow[] = [];
    let lastUserId: string | null = null;
    for (const m of rows) {
      if (m.role === "user") lastUserId = m.id;
      const linked =
        (m.sage_item_id ? itemsById.get(m.sage_item_id) : null) ??
        (m.role === "sage" && lastUserId
          ? itemsBySourceId.get(lastUserId) ?? null
          : null);
      messages.push({ ...m, sage_item: linked ?? null });
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    const caseId = (membership?.case_id as string | undefined) ?? null;
    let children: { id: string; first_name: string }[] = [];
    if (caseId) {
      const { data: childrenData } = await admin
        .from("children")
        .select("id, first_name")
        .eq("case_id", caseId)
        .order("first_name");
      children = ((childrenData ?? []) as { id: string; first_name: string }[]).map(
        (c) => ({ id: c.id, first_name: c.first_name })
      );
    }

    return NextResponse.json({ messages, case_id: caseId, children });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Failed to load Sage messages" },
      { status: 500 }
    );
  }
}

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
    const { content, session_id: bodySessionId } = body as {
      content?: string;
      session_id?: string;
      category?: string;
    };
    const trimmed = (content ?? "").trim();
    if (!trimmed) {
      return NextResponse.json(
        { message: "Content is required." },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const now = new Date().toISOString();
    const sessionId =
      typeof bodySessionId === "string" && bodySessionId.length > 0
        ? bodySessionId
        : null;

    if (sessionId) {
      const { data: session } = await admin
        .from("sage_sessions")
        .select("id")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!session) {
        return NextResponse.json(
          { message: "Session not found." },
          { status: 404 }
        );
      }
    }

    const { data: membership, error: membershipError } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.error("[sage/messages] membership error:", membershipError);
      return NextResponse.json(
        { message: "Failed to load case." },
        { status: 500 }
      );
    }

    const caseId = (membership?.case_id as string | undefined) ?? null;

    const { data: profile } = await admin
      .from("users")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    const timezone = timezoneFromProfile(
      profile as { timezone?: string } | null
    );

    const insertPayload = {
      user_id: user.id,
      role: "user" as const,
      content: trimmed,
      created_at: now,
      ...(sessionId ? { session_id: sessionId } : {}),
    };

    const { data: userRow, error: insertUserError } = await admin
      .from("sage_journal_messages")
      .insert(insertPayload)
      .select(JOURNAL_SELECT_BASE)
      .single();

    if (insertUserError || !userRow) {
      return NextResponse.json(
        { message: insertUserError?.message ?? "Failed to save message." },
        { status: 500 }
      );
    }

    let sageContent = FALLBACK_REPLY;
    let sageItem: Record<string, unknown> | null = null;

    if (caseId) {
      try {
        const { reply, result } = await processChatMessage({
          message: trimmed,
          case_id: caseId,
          timezone,
          source_id: (userRow as { id: string }).id,
        });
        if (reply.trim()) sageContent = reply;

        const { intent, entities } = result.interpretation;
        const { data: itemRow, error: insertItemError } = await admin
          .from("sage_items")
          .insert({
            case_id: caseId,
            source_type: "chat",
            source_id: (userRow as { id: string }).id,
            visible_to: user.id,
            item_type: intent.item_type,
            domain: intent.domain,
            summary: intent.summary,
            evidence_excerpt: intent.evidence_excerpt,
            tool_name: intent.tool_name,
            action_required: intent.action_required,
            action_type: intent.action_type,
            urgency: intent.urgency,
            confidence: intent.confidence,
            tool_input: { ...entities, resolved_dates: result.resolved_dates },
            child_ids: result.child_ids,
            plan: result.plan,
            status: "pending",
          })
          .select(SAGE_ITEM_SELECT)
          .single();

        if (insertItemError) {
          console.error("[sage/messages] sage_items insert failed:", insertItemError);
        } else {
          sageItem = (itemRow as Record<string, unknown> | null) ?? null;
        }
      } catch (e) {
        console.error("[sage/messages] engine failed:", e);
      }
    }

    const sageItemId =
      sageItem && typeof sageItem.id === "string" ? sageItem.id : null;

    const sagePayload = {
      user_id: user.id,
      role: "sage" as const,
      content: sageContent,
      created_at: new Date().toISOString(),
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(sageItemId ? { sage_item_id: sageItemId } : {}),
    };
    let { data: sageRow, error: insertSageError } = await admin
      .from("sage_journal_messages")
      .insert(sagePayload)
      .select(sageItemId ? JOURNAL_SELECT : JOURNAL_SELECT_BASE)
      .single();

    if (insertSageError && sageItemId && missingSageItemIdColumn(insertSageError)) {
      const { sage_item_id: _omit, ...withoutItemId } = sagePayload;
      ({ data: sageRow, error: insertSageError } = await admin
        .from("sage_journal_messages")
        .insert(withoutItemId)
        .select(JOURNAL_SELECT_BASE)
        .single());
    }

    if (insertSageError || !sageRow) {
      return NextResponse.json(
        { message: insertSageError?.message ?? "Failed to save Sage response." },
        { status: 500 }
      );
    }

    if (sessionId) {
      await admin
        .from("sage_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("user_id", user.id);
    }

    const sageMessage: SageMessageRow = {
      ...(sageRow as unknown as SageMessageRow),
      sage_item: sageItem,
    };

    return NextResponse.json({
      user_message: userRow as SageMessageRow,
      sage_message: sageMessage,
      sage_item: sageItem,
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Sage request failed" },
      { status: 500 }
    );
  }
}
