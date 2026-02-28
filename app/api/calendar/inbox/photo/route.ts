import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { extractEventFromImageBase64 } from "@/lib/calendar/extract-from-image";

const BUCKET = "calendar-inbox";

/**
 * POST /api/calendar/inbox/photo
 * Upload image, store in calendar-inbox bucket, create inbox message, run OCR extraction.
 * Returns { message_id, draft: { title, date, start_time, end_time, ... } } for form prefilling.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const case_id = formData.get("case_id") as string | null;
    if (!file || !case_id) return NextResponse.json({ error: "Missing file or case_id" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin.from("case_members").select("case_id").eq("user_id", user.id).eq("case_id", case_id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "Case not found" }, { status: 404 });

    const path = `${case_id}/${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { data: bucketList } = await admin.storage.listBuckets();
    const bucketExists = bucketList?.some((b: { name: string }) => b.name === BUCKET);
    if (!bucketExists) {
      try {
        await admin.storage.createBucket(BUCKET, { public: false });
      } catch {
        // bucket may already exist
      }
    }
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: file.type, upsert: false });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

    const fileUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    const base64 = buf.toString("base64");
    let extracted: Awaited<ReturnType<typeof extractEventFromImageBase64>>;
    try {
      extracted = await extractEventFromImageBase64(base64, file.type || "image/jpeg");
    } catch (e) {
      extracted = {
        title: "",
        date: null,
        start_time: null,
        end_time: null,
        location: null,
        notes: null,
        category: "other",
        child_name: null,
        confidence: 0,
      };
    }

    const parseStatus = extracted.confidence >= 0.8 ? "parsed" : "needs_review";
    const { data: msg, error: insertErr } = await admin
      .from("calendar_inbox_messages")
      .insert({
        user_id: user.id,
        case_id,
        source: "photo",
        received_at: new Date().toISOString(),
        raw_payload_json: { file_url: fileUrl, storage_path: path, file_name: file.name },
        parse_status: parseStatus,
        parse_confidence: extracted.confidence,
        parsed_title: extracted.title || null,
        parsed_date: extracted.date,
        parsed_notes: extracted.notes,
        parsed_category: extracted.category,
        parsed_visibility: "family",
      })
      .select("id")
      .single();

    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    const draft = {
      message_id: msg.id,
      title: extracted.title,
      date: extracted.date,
      start_time: extracted.start_time,
      end_time: extracted.end_time,
      location: extracted.location,
      notes: extracted.notes,
      category: extracted.category,
      child_name: extracted.child_name,
      confidence: extracted.confidence,
    };

    return NextResponse.json({ message_id: msg.id, draft });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 500 });
  }
}
