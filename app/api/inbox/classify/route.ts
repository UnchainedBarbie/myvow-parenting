import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const BUCKET = "inbox";

const CLASSIFY_PROMPT = `You are an AI assistant for a co-parenting application called MyVow Parenting. Analyze the uploaded file and classify it as one of: document, expense, or event.

Extract relevant fields based on the classification.

Document categories: court_order, school, medical, expenses, therapy, legal, custody, photos, communication, incident, other
Expense categories: medical, clothing, education, extracurricular, childcare, transportation, other  
Event categories: medical, school, extracurricular, custody_exchange, therapy, legal, other

Respond ONLY in JSON format with no other text:
{
  "type": "document" or "expense" or "event",
  "confidence": 0.0 to 1.0,
  "title": "suggested title",
  "description": "brief description",
  "category": "category from the allowed list above",
  "child_names": ["names of children mentioned if any"],
  "date": "YYYY-MM-DD if found",
  "amount": null or number (if expense),
  "vendor": null or "vendor name" (if expense),
  "start_time": null or "ISO datetime" (if event),
  "end_time": null or "ISO datetime" (if event),
  "location": null or "location" (if event),
  "is_all_day": false (if event)
}`;

type ClassifyPayload = {
  type: "document" | "expense" | "event";
  confidence: number;
  title: string;
  description: string;
  category: string;
  child_names: string[];
  date: string | null;
  amount: number | null;
  vendor: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  is_all_day: boolean;
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/jpg", "image/webp", "image/gif"];
const PDF_TYPE = "application/pdf";

function isImage(mime: string): boolean {
  return IMAGE_TYPES.includes(mime) || mime.startsWith("image/");
}

/**
 * POST /api/inbox/classify
 * Multipart form: file (required)
 * Uploads file to inbox storage, sends to AI for classification, creates inbox_items row.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (!membership?.case_id) {
      return NextResponse.json({ error: "No case found" }, { status: 403 });
    }
    const case_id = membership.case_id;

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const storagePath = `${case_id}/${user.id}/${timestamp}-${safeName}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";

    const bucketList = await admin.storage.listBuckets();
    const bucketExists = bucketList?.data?.some((b: { name: string }) => b.name === BUCKET);
    if (!bucketExists) {
      try {
        await admin.storage.createBucket(BUCKET, { public: false });
      } catch {
        // bucket may already exist
      }
    }
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, buf, { contentType, upsert: false });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    let payload: ClassifyPayload;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      payload = {
        type: "document",
        confidence: 0,
        title: file.name,
        description: "No AI classification (ANTHROPIC_API_KEY not set).",
        category: "other",
        child_names: [],
        date: null,
        amount: null,
        vendor: null,
        start_time: null,
        end_time: null,
        location: null,
        is_all_day: false,
      };
    } else {
      const anthropic = new Anthropic({ apiKey });
      let content: string | undefined;

      if (isImage(contentType)) {
        const base64Data = buf.toString("base64");
        const mimeType = contentType;
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
                    data: base64Data,
                  },
                },
                { type: "text", text: CLASSIFY_PROMPT },
              ],
            },
          ],
        });
        const textBlock = message.content.find((b): b is { type: "text"; text: string } => b.type === "text");
        content = textBlock?.text?.trim();
        payload = parseClassifyResponse(content, file.name);
      } else if (contentType === PDF_TYPE) {
        const textPrompt = `Filename: ${file.name}. This is a PDF file (content not extracted). Infer classification and suggested fields from the filename and type. ${CLASSIFY_PROMPT}`;
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: textPrompt }],
        });
        const textBlock = message.content.find((b): b is { type: "text"; text: string } => b.type === "text");
        content = textBlock?.text?.trim();
        payload = parseClassifyResponse(content, file.name);
      } else {
        const textPrompt = `Filename: ${file.name}. File type: ${contentType}. Infer classification and suggested fields from the filename. ${CLASSIFY_PROMPT}`;
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          messages: [{ role: "user", content: textPrompt }],
        });
        const textBlock = message.content.find((b): b is { type: "text"; text: string } => b.type === "text");
        content = textBlock?.text?.trim();
        payload = parseClassifyResponse(content, file.name);
      }
    }

    const { data: row, error: insertErr } = await admin
      .from("inbox_items")
      .insert({
        case_id,
        user_id: user.id,
        storage_path: storagePath,
        file_name: file.name,
        ai_type: payload.type,
        ai_confidence: Math.min(1, Math.max(0, payload.confidence)),
        ai_title: payload.title || null,
        ai_description: payload.description || null,
        ai_category: payload.category || null,
        ai_child_ids: Array.isArray(payload.child_names) ? payload.child_names : [],
        ai_date: payload.date || null,
        ai_amount: payload.amount ?? null,
        ai_vendor: payload.vendor || null,
        ai_start_time: payload.start_time || null,
        ai_end_time: payload.end_time || null,
        ai_location: payload.location || null,
        ai_is_all_day: !!payload.is_all_day,
        ai_visibility: null,
        ai_raw_response: null,
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json(
        { error: insertErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Classification failed" },
      { status: 500 }
    );
  }
}

function parseClassifyResponse(content: string | undefined, fallbackFileName: string): ClassifyPayload {
  const defaultPayload: ClassifyPayload = {
    type: "document",
    confidence: 0.3,
    title: fallbackFileName,
    description: "",
    category: "other",
    child_names: [],
    date: null,
    amount: null,
    vendor: null,
    start_time: null,
    end_time: null,
    location: null,
    is_all_day: false,
  };
  if (!content?.trim()) return defaultPayload;
  let parsed: Record<string, unknown>;
  try {
    const cleaned = content.replace(/^```json?\s*|\s*```$/g, "").trim();
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return defaultPayload;
  }
  const type = parsed.type === "expense" ? "expense" : parsed.type === "event" ? "event" : "document";
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
  const title = typeof parsed.title === "string" ? parsed.title : fallbackFileName;
  const description = typeof parsed.description === "string" ? parsed.description : "";
  const category = typeof parsed.category === "string" ? parsed.category : "other";
  const child_names = Array.isArray(parsed.child_names)
    ? (parsed.child_names as unknown[]).filter((n): n is string => typeof n === "string")
    : [];
  const date = typeof parsed.date === "string" ? parsed.date : null;
  const amount = typeof parsed.amount === "number" ? parsed.amount : null;
  const vendor = typeof parsed.vendor === "string" ? parsed.vendor : null;
  const start_time = typeof parsed.start_time === "string" ? parsed.start_time : null;
  const end_time = typeof parsed.end_time === "string" ? parsed.end_time : null;
  const location = typeof parsed.location === "string" ? parsed.location : null;
  const is_all_day = parsed.is_all_day === true;

  return {
    type,
    confidence,
    title,
    description,
    category,
    child_names,
    date,
    amount,
    vendor,
    start_time,
    end_time,
    location,
    is_all_day,
  };
}
