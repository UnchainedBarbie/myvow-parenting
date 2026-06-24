import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { classifyInboundUpload, extractTokenFromTo } from "@/lib/inbound-classify";

const INBOUND_BUCKET = "inbound";

/** Webhook payload shape (provider-specific; adapt as needed). */
type InboundEmailPayload = {
  to?: string;
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename?: string;
    content?: string; // base64
    content_base64?: string;
    content_type?: string;
  }>;
};

export async function POST(request: NextRequest) {
  try {
    // TODO: Validate webhook signature (provider-specific: e.g. Resend, SendGrid, Mailgun)
    // const signature = request.headers.get("x-webhook-signature");
    // if (!verifySignature(signature, await request.text())) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

    const body = (await request.json()) as InboundEmailPayload;
    const to = body.to ?? "";
    const token = extractTokenFromTo(to);
    if (!token) {
      return NextResponse.json(
        { error: "Invalid or missing 'to' address; expected uploads+{token}@in.myvowparenting.com" },
        { status: 400 }
      );
    }

    const admin = getServiceRoleClient();
    const { data: tokenRow, error: tokenErr } = await admin
      .from("user_inbound_tokens")
      .select("user_id")
      .eq("token", token)
      .maybeSingle();
    if (tokenErr || !tokenRow) {
      return NextResponse.json({ error: "Unknown inbound token" }, { status: 404 });
    }
    const userId = tokenRow.user_id as string;

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const caseId = (membership as { case_id: string } | null)?.case_id ?? null;
    if (!caseId) {
      return NextResponse.json({ error: "User has no case" }, { status: 400 });
    }

    const { data: children } = await admin
      .from("children")
      .select("id, first_name")
      .eq("case_id", caseId)
      .is("deleted_at", null);
    const childrenList = (children ?? []) as { id: string; first_name: string }[];

    const subject = body.subject ?? "";
    const bodyText = body.text ?? "";
    const bodyHtml = body.html ?? "";
    const attachments = body.attachments ?? [];
    const fileNames: string[] = [];
    const storagePaths: { file_name: string; mime_type: string | null; file_size_bytes: number | null; storage_path: string }[] = [];

    const prefix = `${caseId}/${userId}/${Date.now()}`;
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      const raw = att.content_base64 ?? att.content;
      const filename = (att.filename ?? `attachment-${i}`).replace(/[^a-zA-Z0-9._-]/g, "_");
      const contentType = att.content_type ?? "application/octet-stream";
      if (!raw) continue;

      const buf = Buffer.from(raw, "base64");
      const ext = filename.includes(".") ? "" : (contentType.startsWith("image/") ? ".jpg" : "");
      const storagePath = `${prefix}/${filename}${ext}`;
      const { error: uploadErr } = await admin.storage
        .from(INBOUND_BUCKET)
        .upload(storagePath, buf, { contentType, upsert: false });
      if (uploadErr) {
        console.error("[inbound/email] storage upload failed:", uploadErr.message);
        return NextResponse.json({ error: "Failed to store attachment" }, { status: 500 });
      }
      fileNames.push(filename);
      storagePaths.push({
        file_name: filename,
        mime_type: contentType,
        file_size_bytes: buf.length,
        storage_path: storagePath,
      });
    }

    const classification = classifyInboundUpload({
      subject,
      bodyText,
      bodyHtml,
      fileNames,
      children: childrenList,
    });

    const { data: uploadRow, error: insertErr } = await admin
      .from("inbound_uploads")
      .insert({
        user_id: userId,
        case_id: caseId,
        status: "pending_review",
        from_email: body.from ?? null,
        subject: subject || null,
        body_text: bodyText || null,
        body_html: bodyHtml || null,
        suggested_child_id: classification.suggested_child_id ?? null,
        suggested_category: classification.suggested_category,
        suggested_visibility: classification.suggested_visibility,
        suggested_description: classification.suggested_description,
        suggested_expense: classification.suggested_expense,
        suggested_amount: classification.suggested_amount,
        suggested_expense_date: classification.suggested_expense_date,
        suggestion_confidence: classification.suggestion_confidence,
      })
      .select("id")
      .single();
    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
    const inboundUploadId = (uploadRow as { id: string }).id;

    if (storagePaths.length > 0) {
      const fileRows = storagePaths.map((p) => ({
        inbound_upload_id: inboundUploadId,
        file_name: p.file_name,
        mime_type: p.mime_type,
        file_size_bytes: p.file_size_bytes,
        storage_path: p.storage_path,
      }));
      const { error: filesErr } = await admin.from("inbound_upload_files").insert(fileRows);
      if (filesErr) {
        console.error("[inbound/email] inbound_upload_files insert failed:", filesErr.message);
      }
    }

    return NextResponse.json({
      ok: true,
      inbound_upload_id: inboundUploadId,
      attachments_stored: storagePaths.length,
    });
  } catch (e) {
    console.error("[inbound/email]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Inbound email processing failed" },
      { status: 500 }
    );
  }
}
