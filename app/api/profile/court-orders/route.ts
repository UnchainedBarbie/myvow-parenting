import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";

const INBOX_BUCKET = "inbox";

/**
 * POST /api/profile/court-orders
 * Body (JSON): { document_type, case_number, jurisdiction, effective_date, description?, status?, title?, file_path?, file_name? }
 * Body (multipart): optional "file" + same fields as form fields. If file is present, it is uploaded to inbox storage
 *   and file_path/file_name are set on the new row. Title should be AI-extracted or filename without extension.
 * Creates a court order (parenting_plans row). If status is "active", any other
 * active court orders for the same case are set to is_active: false.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership?.case_id) return NextResponse.json({ error: "No case found" }, { status: 403 });

    const case_id = membership.case_id;
    let body: Record<string, unknown> = {};
    let file_path: string | null = null;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      body = {
        title: formData.get("title") ?? undefined,
        document_type: formData.get("document_type") ?? undefined,
        case_number: formData.get("case_number") ?? undefined,
        jurisdiction: formData.get("jurisdiction") ?? undefined,
        effective_date: formData.get("effective_date") ?? undefined,
        description: formData.get("description") ?? undefined,
        status: formData.get("status") ?? undefined,
        userId: formData.get("userId") ?? undefined,
      };
      if (file && file instanceof File && file.size > 0) {
        const timestamp = Date.now();
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
        const storagePath = `${case_id}/${user.id}/${timestamp}-${safeName}`;
        const buf = Buffer.from(await file.arrayBuffer());
        const contentTypeFile = file.type || "application/octet-stream";
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
          .upload(storagePath, buf, { contentType: contentTypeFile, upsert: false });
        if (uploadError) {
          return NextResponse.json({ error: uploadError.message }, { status: 500 });
        }
        file_path = storagePath;
      }
    } else {
      body = await req.json().catch(() => ({}));
    }

    const document_type = typeof body.document_type === "string" ? body.document_type : "other";
    const court_case_number = body.case_number != null ? String(body.case_number).trim() || null : null;
    const court_jurisdiction = body.jurisdiction != null ? String(body.jurisdiction).trim() || null : null;
    const effective_date = body.effective_date != null ? String(body.effective_date).slice(0, 10) || null : null;
    const description = body.description != null ? String(body.description).trim() || null : null;
    const status = typeof body.status === "string" ? body.status : "active";
    const title = body.title != null ? String(body.title).trim() || null : court_case_number;
    const is_active = status === "active";
    const uploaded_by = typeof body.userId === "string" ? body.userId : user.id;

    const insertPayload: Record<string, unknown> = {
      case_id,
      custody_type: document_type,
      uploaded_by,
      title: title ?? court_case_number ?? "Court Order",
      court_case_number,
      court_jurisdiction,
      effective_date,
      schedule_description: description,
      is_active,
    };
    if (file_path) insertPayload.file_path = file_path;

    const { data: row, error: insertErr } = await admin
      .from("parenting_plans")
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr) {
      console.error("[profile/court-orders] Insert error:", insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    if (is_active) {
      const { error: updateErr } = await admin
        .from("parenting_plans")
        .update({ is_active: false })
        .eq("case_id", case_id)
        .neq("id", row.id)
        .eq("is_active", true);
      if (updateErr) {
        console.error("[profile/court-orders] Supersede update error:", updateErr);
      }
    }

    return NextResponse.json(row);
  } catch (e) {
    console.error("[profile/court-orders] Error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
