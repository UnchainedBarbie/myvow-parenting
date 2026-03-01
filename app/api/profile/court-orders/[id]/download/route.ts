import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

const INBOX_BUCKET = "inbox";

/**
 * GET /api/profile/court-orders/[id]/download
 * Returns a signed URL for the court order file (from inbox storage) if the
 * parenting_plan has file_path set.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: plan, error: planErr } = await admin
      .from("parenting_plans")
      .select("id, case_id, file_path")
      .eq("id", id)
      .single();
    if (planErr || !plan) return NextResponse.json({ error: "Court order not found" }, { status: 404 });

    const filePath = plan.file_path as string | null;
    if (!filePath || typeof filePath !== "string") {
      return NextResponse.json({ error: "No file attached to this court order" }, { status: 404 });
    }

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", plan.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const fileName = filePath.split("/").pop() || "document";
    const { data: signed } = await admin.storage
      .from(INBOX_BUCKET)
      .createSignedUrl(filePath, 60, { download: fileName });
    if (!signed?.signedUrl) {
      return NextResponse.json({ error: "Could not generate download URL" }, { status: 500 });
    }

    return NextResponse.json({ url: signed.signedUrl });
  } catch (e) {
    console.error("[court-orders download]", e);
    return NextResponse.json({ error: "Failed to get download URL" }, { status: 500 });
  }
}
