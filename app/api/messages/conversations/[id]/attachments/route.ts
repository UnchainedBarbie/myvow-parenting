import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";

export async function POST(
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

    const body = (await request.json().catch(() => ({}))) as {
      type?: "document" | "expense" | "court_order";
      attachment_id?: string;
      document_id?: string;
      expense_id?: string;
      court_order_id?: string;
    };

    if (body.type === "document" && (body.attachment_id ?? body.document_id)) {
      const { error } = await admin.from("conversation_attachments").insert({
        conversation_id: conversationId,
        attachment_id: body.attachment_id ?? body.document_id,
        attachment_type: "document",
        created_by: user.id,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else if (body.type === "expense" && (body.attachment_id ?? body.expense_id)) {
      const { error } = await admin.from("conversation_attachments").insert({
        conversation_id: conversationId,
        attachment_id: body.attachment_id ?? body.expense_id,
        attachment_type: "expense",
        created_by: user.id,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else if (body.type === "court_order" && body.court_order_id) {
      const { error } = await admin.from("conversation_attachments").insert({
        conversation_id: conversationId,
        attachment_id: body.court_order_id,
        attachment_type: "court_order",
        created_by: user.id,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      return NextResponse.json(
        { error: "Invalid attachment payload" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Failed to attach document or expense",
      },
      { status: 500 }
    );
  }
}

