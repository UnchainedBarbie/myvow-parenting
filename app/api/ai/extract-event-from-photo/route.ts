import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `You are helping extract calendar event details from a photo of a flyer, permission slip, or event notice. Extract what you can and return ONLY valid JSON with these fields (omit fields you can't find):
{ "title": string, "date": "YYYY-MM-DD", "time": "HH:MM", "notes": string, "category": "medical"|"school"|"extracurricular"|"other" }

Use 24-hour time for "time" (e.g. "14:30"). For "date", use YYYY-MM-DD. If you cannot determine a field, omit it from the JSON. Return nothing but the JSON object.`;

const ALLOWED_CATEGORIES = ["medical", "school", "extracurricular", "other"] as const;

export type ExtractEventFromPhotoResponse = {
  title?: string;
  date?: string;
  time?: string;
  notes?: string;
  category?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const photoUrl = typeof body?.photo_url === "string" ? body.photo_url.trim() : null;
    if (!photoUrl) {
      return NextResponse.json({ error: "photo_url is required" }, { status: 400 });
    }

    const imageRes = await fetch(photoUrl, { method: "GET" });
    if (!imageRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${imageRes.status}` },
        { status: 400 }
      );
    }

    const buf = await imageRes.arrayBuffer();
    const base64 = Buffer.from(buf).toString("base64");
    const contentType = imageRes.headers.get("content-type") || "image/jpeg";
    const mediaType = contentType.split(";")[0].trim() as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    const safeMediaType =
      mediaType === "image/png" || mediaType === "image/gif" || mediaType === "image/webp"
        ? mediaType
        : "image/jpeg";

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: safeMediaType,
                data: base64,
              },
            },
            { type: "text", text: "Extract the event details from this image." },
          ],
        },
      ],
    });

    const textBlock = response.content.find((c) => c.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text.trim() : "";
    if (!raw) {
      return NextResponse.json({} as ExtractEventFromPhotoResponse);
    }

    const cleaned = raw.replace(/^```json?\s*|\s*```$/g, "").trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return NextResponse.json({} as ExtractEventFromPhotoResponse);
    }

    const result: ExtractEventFromPhotoResponse = {};
    if (typeof parsed.title === "string" && parsed.title.trim()) result.title = parsed.title.trim();
    if (typeof parsed.date === "string" && parsed.date.trim()) {
      const d = parsed.date.trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) result.date = d;
    }
    if (typeof parsed.time === "string" && parsed.time.trim()) {
      const t = parsed.time.trim().slice(0, 5);
      if (/^\d{1,2}:\d{2}$/.test(t)) result.time = t;
    }
    if (typeof parsed.notes === "string" && parsed.notes.trim()) result.notes = parsed.notes.trim();
    if (
      typeof parsed.category === "string" &&
      ALLOWED_CATEGORIES.includes(parsed.category as (typeof ALLOWED_CATEGORIES)[number])
    ) {
      result.category = parsed.category;
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("[extract-event-from-photo]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Extraction failed" },
      { status: 500 }
    );
  }
}
