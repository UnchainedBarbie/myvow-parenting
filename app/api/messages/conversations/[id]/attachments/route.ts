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
      type?: "document" | "expense";
      document_id?: string;
      expense_id?: string;
    };

    if (body.type === "document" && body.document_id) {
      const { error } = await admin.from("conversation_attachments").insert({
        conversation_id: conversationId,
        document_id: body.document_id,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else if (body.type === "expense" && body.expense_id) {
      const { error } = await admin.from("conversation_attachments").insert({
        conversation_id: conversationId,
        expense_id: body.expense_id,
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

