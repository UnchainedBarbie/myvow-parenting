import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const BUCKET = "school-calendars";

const SYSTEM_PROMPT = `You are extracting school break dates from a school district calendar. Return ONLY valid JSON — no markdown, no code fences, no explanation.`;

const EXTRACTION_PROMPT = `Extract school break information from this calendar document.

Return JSON in this exact shape:
{
  "school_name": string | null,
  "district": string | null,
  "school_year": string,
  "breaks": {
    "fall_break": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } | null,
    "thanksgiving_break": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } | null,
    "winter_break": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } | null,
    "spring_break": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } | null,
    "summer_break": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" } | null
  },
  "key_dates": {
    "last_day_of_school": "YYYY-MM-DD" | null,
    "first_day_of_school_next_year": "YYYY-MM-DD" | null,
    "teacher_work_days": ["YYYY-MM-DD"]
  }
}

Rules:
- Break start = first day students are NOT in school
- Break end = last day students are NOT in school (day before school resumes)
- Include full weekend spans within breaks
- If a break is not found, set its value to null — do not guess
- Return only JSON, nothing else.`;

type ExtractedPayload = {
  school_name?: string | null;
  district?: string | null;
  school_year?: string;
  breaks?: {
    fall_break?: { start?: string; end?: string } | null;
    thanksgiving_break?: { start?: string; end?: string } | null;
    winter_break?: { start?: string; end?: string } | null;
    spring_break?: { start?: string; end?: string } | null;
    summer_break?: { start?: string; end?: string } | null;
  };
  key_dates?: {
    last_day_of_school?: string | null;
    first_day_of_school_next_year?: string | null;
    teacher_work_days?: string[];
  };
};

/**
 * POST /api/school-calendar/upload
 * multipart/form-data: file (PDF or image), case_id
 * Uploads to bucket school-calendars, extracts breaks via Anthropic, inserts school_calendars, then calls resolve-dates.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const caseIdRaw = formData.get("case_id");
    const case_id = typeof caseIdRaw === "string" ? caseIdRaw.trim() : null;

    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Missing or empty file" }, { status: 400 });
    }
    if (!case_id) {
      return NextResponse.json({ error: "Missing case_id" }, { status: 400 });
    }

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";
    const isPdf = contentType === "application/pdf" || (file.name && file.name.toLowerCase().endsWith(".pdf"));
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const storagePath = `${case_id}/${Date.now()}-${safeName}`;

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

    const base64 = buf.toString("base64");
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const anthropic = new Anthropic({ apiKey });
    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
      | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png"; data: string } }
    > = [];
    if (isPdf) {
      userContent.push(
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: EXTRACTION_PROMPT }
      );
    } else {
      const mediaType = contentType.includes("png") ? "image/png" : "image/jpeg";
      userContent.push(
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: EXTRACTION_PROMPT }
      );
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    const textBlock = response.content.find((c) => c.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text.trim() : "";
    if (!raw) {
      return NextResponse.json({ error: "No extraction result from document" }, { status: 500 });
    }

    const cleaned = raw.replace(/^```json?\s*|\s*```$/g, "").trim();
    let parsed: ExtractedPayload;
    try {
      parsed = JSON.parse(cleaned) as ExtractedPayload;
    } catch {
      return NextResponse.json({ error: "Invalid JSON from extraction" }, { status: 500 });
    }

    const school_year = typeof parsed.school_year === "string" ? parsed.school_year.trim() || "Unknown" : "Unknown";
    const school_name = typeof parsed.school_name === "string" ? parsed.school_name.trim() || null : null;
    const district = typeof parsed.district === "string" ? parsed.district.trim() || null : null;
    const extracted_breaks = {
      breaks: parsed.breaks ?? {},
      key_dates: parsed.key_dates ?? {},
    };

    const { data: inserted, error: insertErr } = await admin
      .from("school_calendars")
      .insert({
        case_id,
        school_year,
        school_name,
        district,
        file_path: storagePath,
        extracted_breaks,
        is_active: true,
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    let resolved = 0;
    try {
      const origin = req.nextUrl?.origin ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const resolveRes = await fetch(`${origin}/api/holiday-custody/resolve-dates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id }),
      });
      const resolveData = await resolveRes.json().catch(() => ({}));
      if (resolveRes.ok && typeof resolveData.resolved === "number") {
        resolved = resolveData.resolved;
      }
    } catch {
      // resolve-dates optional; continue with resolved = 0
    }

    return NextResponse.json({
      success: true,
      calendar: inserted,
      resolved,
    });
  } catch (e) {
    console.error("[school-calendar/upload]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 }
    );
  }
}
