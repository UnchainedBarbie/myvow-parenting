import { NextRequest, NextResponse } from "next/server";
import { originalDocumentName } from "@/lib/documents-files";
import { documentAuthorizedForViewer } from "@/lib/documents-tab";
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
      .select("id, case_id, storage_path, file_name, visibility, uploaded_by")
      .eq("id", id)
      .eq("status", "active")
      .is("deleted_at", null)
      .single();
    if (docErr || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id, role")
      .eq("case_id", doc.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (
      !documentAuthorizedForViewer(
        { visibility: doc.visibility as string | null, uploadedBy: doc.uploaded_by as string | null },
        { userId: user.id, role: membership.role as string | null }
      )
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const downloadName = originalDocumentName(String(doc.file_name ?? "")) || "document";
    const { data: signed } = await admin.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60, { download: downloadName });
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
