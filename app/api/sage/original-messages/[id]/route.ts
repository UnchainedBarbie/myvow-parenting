import { NextRequest, NextResponse } from "next/server";
import { documentPreviewNote } from "@/lib/documents-files";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import {
  isMessageId,
  originalMessageAccess,
  originalViewPolicy,
  safeOriginalBody,
  selectOriginalMessage,
  visibleOriginalAttachments,
  type OriginalAttachment,
} from "@/lib/sage/original-message";

/**
 * GET /api/sage/original-messages/[id]
 * Loads one saved incoming message by id. Does not mark it read, send a receipt,
 * approve a proposal, or create a record.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const policy = originalViewPolicy();
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { id } = await context.params;
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isMessageId(id)) {
      return NextResponse.json({ unavailable: true, message: "That original message isn't available." }, { status: 404 });
    }

    const admin = getServiceRoleClient();
    const full = await admin
      .from("messages")
      .select(
        "id, case_id, conversation_id, direction, original_content, created_at, sender_id, sender_external_email, recipient_email, recipient_cc"
      )
      .eq("id", id)
      .limit(1);
    type SavedMessage = {
      id: string;
      case_id: string | null;
      conversation_id: string | null;
      direction: string | null;
      original_content: string | null;
      created_at: string | null;
      sender_id: string | null;
      sender_external_email: string | null;
      recipient_email: string | null;
      recipient_cc: string | null;
    };
    const asSaved = (row: Record<string, unknown>): SavedMessage => ({
      id: String(row.id ?? ""),
      case_id: typeof row.case_id === "string" ? row.case_id : null,
      conversation_id: typeof row.conversation_id === "string" ? row.conversation_id : null,
      direction: typeof row.direction === "string" ? row.direction : null,
      original_content: typeof row.original_content === "string" ? row.original_content : null,
      created_at: typeof row.created_at === "string" ? row.created_at : null,
      sender_id: typeof row.sender_id === "string" ? row.sender_id : null,
      sender_external_email:
        typeof row.sender_external_email === "string" ? row.sender_external_email : null,
      recipient_email: typeof row.recipient_email === "string" ? row.recipient_email : null,
      recipient_cc: typeof row.recipient_cc === "string" ? row.recipient_cc : null,
    });
    let rows = ((full.data ?? []) as Record<string, unknown>[]).map(asSaved);
    if (full.error && /recipient_email|recipient_cc/i.test(full.error.message ?? "")) {
      const retry = await admin
        .from("messages")
        .select(
          "id, case_id, conversation_id, direction, original_content, created_at, sender_id, sender_external_email"
        )
        .eq("id", id)
        .limit(1);
      rows = ((retry.data ?? []) as Record<string, unknown>[]).map(asSaved);
      if (retry.error) {
        return NextResponse.json({ error: retry.error.message }, { status: 500 });
      }
    } else if (full.error) {
      return NextResponse.json({ error: full.error.message }, { status: 500 });
    }

    const message = selectOriginalMessage(id, rows);
    if (!message) {
      return NextResponse.json(
        { unavailable: true, message: "The original message isn't available." },
        { status: 404 }
      );
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id, role")
      .eq("case_id", message.case_id as string)
      .eq("user_id", user.id)
      .maybeSingle();
    const access = originalMessageAccess({
      signedIn: true,
      role: (membership as { role?: string | null } | null)?.role ?? null,
      memberCaseId: (membership as { case_id?: string | null } | null)?.case_id ?? null,
      messageCaseId: (message.case_id as string | null) ?? null,
      direction: (message.direction as string | null) ?? null,
      found: true,
    });
    if (access === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (access !== "ok") {
      return NextResponse.json(
        { unavailable: true, message: "The original message isn't available." },
        { status: 404 }
      );
    }

    const conversationId = (message.conversation_id as string | null) ?? null;
    let subject: string | null = null;
    if (conversationId) {
      const { data: conversation } = await admin
        .from("conversations")
        .select("id, subject")
        .eq("id", conversationId)
        .maybeSingle();
      subject = ((conversation as { subject?: string | null } | null)?.subject ?? "").trim() || null;
    }

    let sender = ((message.sender_external_email as string | null) ?? "").trim();
    const senderId = ((message.sender_id as string | null) ?? "").trim();
    if (senderId) {
      const { data: senderRow } = await admin
        .from("users")
        .select("id, full_name, email")
        .eq("id", senderId)
        .maybeSingle();
      const name = ((senderRow as { full_name?: string | null } | null)?.full_name ?? "").trim();
      const email = ((senderRow as { email?: string | null } | null)?.email ?? "").trim();
      sender = name || sender || email;
    }

    const { data: links } = await admin
      .from("message_documents")
      .select("document_id")
      .eq("message_id", id);
    const documentIds = (links ?? [])
      .map((row) => (row as { document_id?: string }).document_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    const stored: OriginalAttachment[] = [];
    if (documentIds.length > 0) {
      const { data: docs } = await admin
        .from("documents")
        .select("id, file_name, mime_type, visibility, uploaded_by")
        .in("id", documentIds);
      for (const doc of docs ?? []) {
        const row = doc as {
          id?: string;
          file_name?: string | null;
          mime_type?: string | null;
          visibility?: string | null;
          uploaded_by?: string | null;
        };
        if (!row.id || !row.file_name?.trim()) continue;
        stored.push({
          id: row.id,
          fileName: row.file_name.trim(),
          mimeType: row.mime_type ?? null,
          visibility: row.visibility ?? null,
          uploadedBy: row.uploaded_by ?? null,
        });
      }
    }
    const attachments = visibleOriginalAttachments(stored, {
      userId: user.id,
      role: (membership as { role?: string | null } | null)?.role ?? null,
    }).map((file) => ({
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      previewNote: documentPreviewNote(file.fileName, file.mimeType),
    }));

    if (policy.markRead || policy.sendReceipt || policy.approve) {
      return NextResponse.json({ error: "Unsupported" }, { status: 500 });
    }

    return NextResponse.json({
      unavailable: false,
      id: message.id,
      sender: sender || "Co-parent",
      to: ((message.recipient_email as string | null) ?? "").trim() || null,
      cc: ((message.recipient_cc as string | null) ?? "").trim() || null,
      sentAt: (message.created_at as string | null) ?? null,
      subject,
      body: safeOriginalBody((message.original_content as string | null) ?? ""),
      attachments,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load the original message" },
      { status: 500 }
    );
  }
}
