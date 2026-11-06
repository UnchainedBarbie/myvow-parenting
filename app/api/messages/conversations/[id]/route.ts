import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { presentMessageForViewer } from "@/lib/messages/parent-message-visibility";
import {
  parseChildIds,
  replaceConversationChildren,
} from "@/lib/messages/conversation-children";
import { isMissingRelation } from "@/lib/record/record-categories";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const conversationId = params.id;

    const { data: conv, error: convError } = await admin
      .from("conversations")
      .select("id, case_id, subject, child_id, category, created_by, created_at, updated_at")
      .eq("id", conversationId)
      .maybeSingle();

    if (convError) {
      return NextResponse.json(
        { error: convError.message },
        { status: 500 }
      );
    }
    if (!conv) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("id")
      .eq("case_id", conv.case_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: rawMessages, error: msgError } = await admin
      .from("messages")
      .select(
        "id, sender_id, direction, original_content, ai_rewritten_content, category, sub_category, current_status, external_comm_id, created_at, ai_classification, emotional_intensity_score, ai_rewritten, intensity_score, intensity_flag, delivery_status, delivered_at, is_emergency"
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (msgError) {
      return NextResponse.json(
        { error: msgError.message },
        { status: 500 }
      );
    }

    const baseMessages = (rawMessages ?? []).flatMap((m) => {
      const view = presentMessageForViewer(
        m as {
          sender_id?: string | null;
          direction?: string | null;
          delivery_status?: string | null;
          delivered_at?: string | null;
        },
        user.id
      );
      if (!view.show) return [];
      return [{ ...m, direction: view.direction }];
    });

    const messageIds = baseMessages.map((m) => m.id as string);
    let flaggedIds = new Set<string>();

    if (messageIds.length > 0) {
      const { data: flags } = await admin
        .from("message_user_flags")
        .select("message_id")
        .eq("user_id", user.id)
        .in("message_id", messageIds);

      if (flags) {
        flaggedIds = new Set(flags.map((f: { message_id: string }) => f.message_id));
      }
    }

    const messages = baseMessages.map((m) => ({
      ...m,
      flagged_by_me: flaggedIds.has(m.id),
    }));

    return NextResponse.json({
      conversation: conv,
      messages,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load conversation" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const conversationId = params.id;
    const body = (await request.json().catch(() => ({}))) as {
      subject?: unknown;
      child_ids?: unknown;
    };
    const hasSubject = Object.prototype.hasOwnProperty.call(body, "subject");
    const hasChildren = Array.isArray(body.child_ids);
    if (!hasSubject && !hasChildren) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    const subject = hasSubject && typeof body.subject === "string" ? body.subject.trim() : "";
    if (hasSubject && !subject) {
      return NextResponse.json({ error: "A title is required." }, { status: 400 });
    }
    const childIds = hasChildren ? parseChildIds(body.child_ids) : null;

    const { data: conv, error: convError } = await admin
      .from("conversations")
      .select("id, case_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (convError) {
      return NextResponse.json({ error: convError.message }, { status: 500 });
    }
    if (!conv) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("id")
      .eq("case_id", conv.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (childIds && childIds.length > 0) {
      const { data: caseChildren, error: childError } = await admin
        .from("children")
        .select("id")
        .eq("case_id", conv.case_id)
        .is("deleted_at", null)
        .in("id", childIds);
      if (childError) {
        return NextResponse.json({ error: childError.message }, { status: 500 });
      }
      const found = new Set((caseChildren ?? []).map((row) => (row as { id: string }).id));
      if (childIds.some((id) => !found.has(id))) {
        return NextResponse.json({ error: "That child is not on this case." }, { status: 400 });
      }
    }

    if (childIds) {
      const replaced = await replaceConversationChildren(admin, conversationId, childIds);
      if (replaced.error) {
        const status = replaced.missing || isMissingRelation({ message: replaced.error }) ? 503 : 500;
        return NextResponse.json(
          {
            error:
              status === 503
                ? "Assigning children needs the conversation children update applied first."
                : replaced.error,
          },
          { status }
        );
      }
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (hasSubject) updates.subject = subject;
    if (childIds) updates.child_id = childIds[0] ?? null;

    const { data: updated, error: updateError } = await admin
      .from("conversations")
      .update(updates)
      .eq("id", conversationId)
      .select("id, subject, child_id")
      .single();
    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message ?? "Could not update the conversation." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      conversation: {
        ...updated,
        ...(childIds ? { child_ids: childIds } : {}),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not rename the conversation." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const conversationId = params.id;

    const { data: conv, error: convError } = await admin
      .from("conversations")
      .select("id, case_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (convError) {
      return NextResponse.json(
        { error: convError.message },
        { status: 500 }
      );
    }
    if (!conv) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("id")
      .eq("case_id", conv.case_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // First delete all messages in this conversation so we can safely
    // remove the conversation row (messages.conversation_id FK is not ON DELETE CASCADE).
    const { error: deleteMessagesError } = await admin
      .from("messages")
      .delete()
      .eq("conversation_id", conversationId);

    if (deleteMessagesError) {
      return NextResponse.json(
        { error: deleteMessagesError.message },
        { status: 500 }
      );
    }

    // Best-effort cleanup of related tables
    try {
      await admin
        .from("conversation_settings")
        .delete()
        .eq("conversation_id", conversationId);
    } catch {
      // ignore if table doesn't exist or other non-critical errors
    }

    try {
      await admin
        .from("conversation_attachments")
        .delete()
        .eq("conversation_id", conversationId);
    } catch {
      // ignore if table doesn't exist or other non-critical errors
    }

    const { error: deleteError } = await admin
      .from("conversations")
      .delete()
      .eq("id", conversationId);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete conversation" },
      { status: 500 }
    );
  }
}

