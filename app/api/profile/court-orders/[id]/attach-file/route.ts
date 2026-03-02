import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { runClassify } from "@/lib/ai-classify";
import { syncChildrenFromExtraction } from "@/lib/sync-children-from-extraction";

const INBOX_BUCKET = "inbox";

/**
 * POST /api/profile/court-orders/[id]/attach-file
 * Body: multipart/form-data with "file".
 * Uploads file to inbox storage and updates parenting_plans.file_path only.
 * Returns { file_path } for the client to update state.
 */
export async function POST(
  req: NextRequest,
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
      .select("id, case_id")
      .eq("id", id)
      .single();
    if (planErr || !plan) return NextResponse.json({ error: "Court order not found" }, { status: 404 });

    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", plan.case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const case_id = plan.case_id as string;
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const storagePath = `${case_id}/${user.id}/${timestamp}-${safeName}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";

    const bucketList = await admin.storage.listBuckets();
    const bucketExists = bucketList?.data?.some((b: { name: string }) => b.name === INBOX_BUCKET);
    if (!bucketExists) {
      try {
        await admin.storage.createBucket(INBOX_BUCKET, { public: false });
      } catch {
        // bucket may already exist
      }
    }
    const { error: uploadError } = await admin.storage
      .from(INBOX_BUCKET)
      .upload(storagePath, buf, { contentType, upsert: false });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { error: updateErr } = await admin
      .from("parenting_plans")
      .update({ file_path: storagePath })
      .eq("id", id);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    try {
      const payload = await runClassify(buf, contentType, file.name);
      await syncChildrenFromExtraction(admin, case_id, payload);
    } catch (e) {
      console.warn("[court-orders attach-file] Child extraction/sync failed:", e);
    }

    return NextResponse.json({ file_path: storagePath });
  } catch (e) {
    console.error("[court-orders attach-file]", e);
    return NextResponse.json({ error: "Failed to attach file" }, { status: 500 });
  }
}
