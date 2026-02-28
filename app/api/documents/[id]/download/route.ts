import { NextRequest, NextResponse } from "next/server";
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
      .select("id, case_id, storage_path, file_name")
      .eq("id", id)
      .single();
    if (docErr || !doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", doc.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: signed } = await admin.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
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
