import { NextRequest, NextResponse } from "next/server";
import { documentOpensInline, originalDocumentName } from "@/lib/documents-files";
import { documentDownloadAccess, type DocumentLinkScope } from "@/lib/documents-tab";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/documents/[id]/download — get a signed download URL and log access.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Missing document id" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("id, case_id, storage_path, file_name, mime_type, visibility, uploaded_by, status")
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    if (docErr || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    const status = String((doc as { status?: string | null }).status ?? "");
    const uploadedBy = (doc.uploaded_by as string | null) ?? null;

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id, role")
      .eq("case_id", doc.case_id)
      .eq("user_id", user.id)
      .maybeSingle();

    let link: DocumentLinkScope = "same_case";
    if (status === "pending" && uploadedBy !== user.id) {
      const { data: linked } = await admin
        .from("message_documents")
        .select("message_id")
        .eq("document_id", id)
        .limit(1)
        .maybeSingle();
      const messageId = (linked as { message_id?: string } | null)?.message_id;
      if (!messageId) {
        link = "none";
      } else {
        const { data: message } = await admin
          .from("messages")
          .select("case_id")
          .eq("id", messageId)
          .maybeSingle();
        link = (message as { case_id?: string } | null)?.case_id === doc.case_id ? "same_case" : "other_case";
      }
    }
    const access = documentDownloadAccess({
      found: true,
      status,
      visibility: doc.visibility as string | null,
      uploadedBy,
      viewerId: user.id,
      viewerRole: (membership?.role as string | null) ?? null,
      viewerIsMember: Boolean(membership),
      link,
    });
    if (access === "not_found") return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (access === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const downloadName = originalDocumentName(String(doc.file_name ?? "")) || "document";
    const inline = documentOpensInline(
      downloadName,
      (doc as { mime_type?: string | null }).mime_type,
      request.nextUrl.searchParams.get("preview") === "1"
    );
    const { data: signed } = await admin.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60, inline ? undefined : { download: downloadName });
    if (!signed?.signedUrl) return NextResponse.json({ error: "Could not generate download URL" }, { status: 500 });

    try {
      await admin.from("document_access_log").insert({
        document_id: id,
        user_id: user.id,
        action: "downloaded",
      });
    } catch {
      // non-blocking
    }

    return NextResponse.json({ url: signed.signedUrl });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
