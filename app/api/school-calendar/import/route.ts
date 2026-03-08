import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const FETCH_TIMEOUT_MS = 10_000;

const SYSTEM_PROMPT = `You are extracting school break dates from a school district calendar webpage. Return ONLY valid JSON — no markdown, no code fences, no explanation.`;

const EXTRACTION_PROMPT_TEMPLATE = `Extract all school break and no-school day information from this calendar.

The content may be either an HTML webpage or an ICS calendar file. If it is an ICS file, read the SUMMARY and DTSTART/DTEND fields to identify school breaks and no-school days. Look for events with SUMMARY containing words like "Break", "No School", "Holiday", "Last Day", "First Day".

Return JSON in this exact shape:
{
  "school_name": string | null,
  "district": string | null,
  "school_year": string,
  "breaks": {
    "fall_break": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "applies_to": "all" } | null,
    "thanksgiving_break": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "applies_to": "all" } | null,
    "winter_break": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "applies_to": "all" } | null,
    "spring_break": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "applies_to": "all" } | null,
    "summer_break": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "applies_to": "all" } | null
  },
  "no_school_days": [
    {
      "date": "YYYY-MM-DD",
      "applies_to": "all" | "K-8" | "K-5" | "6-8" | "9-12" | "elementary" | "middle" | "high",
      "note": string | null
    }
  ],
  "key_dates": {
    "last_day_of_school": "YYYY-MM-DD" | null,
    "first_day_of_school_next_year": "YYYY-MM-DD" | null
  }
}

Rules:
- Break start = first day students are NOT in school
- Break end = last day students are NOT in school (day before school resumes)
- For named breaks, applies_to is almost always "all" unless explicitly stated otherwise
- For individual no-school days, extract the applies_to range from the label (e.g. "K-8 ~ No School" → applies_to: "K-8")
- If applies_to is not specified, default to "all"
- If a break cannot be found, set to null — do not guess
- Return only JSON, nothing else.

Page text:
`;

const BAD_URL_MESSAGE =
  "We couldn't read that page. Try pasting the direct link to the calendar page, or enter dates manually.";

function stripHtml(html: string): string {
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/\s+/g, " ").trim();
}

function isIcsContent(contentType: string | null, url: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/calendar")) return true;
  try {
    const path = new URL(url).pathname;
    if (path.toLowerCase().endsWith(".ics")) return true;
  } catch {
    // ignore
  }
  return false;
}

/** Parse ICS text for DTSTART/DTEND dates and derive school year from span. */
function deriveSchoolYearFromIcs(icsText: string): string {
  const years: number[] = [];
  const re = /(?:DTSTART|DTEND)(?:;[^:]*)?:(\d{4})[-]?(\d{2})[-]?(\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(icsText)) !== null) {
    const y = parseInt(m[1], 10);
    if (y >= 2000 && y <= 2100) years.push(y);
  }
  if (years.length === 0) return "Unknown";
  const minY = Math.min(...years);
  const maxY = Math.max(...years);
  return minY === maxY ? String(minY) : `${minY}-${maxY}`;
}

type ExtractedPayload = {
  school_name?: string | null;
  district?: string | null;
  school_year?: string;
  breaks?: Record<string, { start?: string; end?: string; applies_to?: string } | null>;
  no_school_days?: Array<{ date?: string; applies_to?: string; note?: string | null }>;
  key_dates?: {
    last_day_of_school?: string | null;
    first_day_of_school_next_year?: string | null;
  };
};

/**
 * POST /api/school-calendar/import
 * Body: { case_id, calendar_url, school_name? }
 * Fetches URL, extracts text, sends to Anthropic, inserts school_calendars, calls resolve-dates.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({})) as {
      case_id?: string;
      calendar_url?: string;
      school_name?: string;
    };
    const case_id = typeof body.case_id === "string" ? body.case_id.trim() : null;
    const calendar_url = typeof body.calendar_url === "string" ? body.calendar_url.trim() : null;
    const school_nameOverride = typeof body.school_name === "string" ? body.school_name.trim() || null : null;

    if (!case_id) return NextResponse.json({ error: "Missing case_id" }, { status: 400 });
    if (!calendar_url) return NextResponse.json({ error: "Missing calendar_url" }, { status: 400 });

    const admin = getServiceRoleClient();
    const { data: membership } = await admin
      .from("case_members")
      .select("case_id")
      .eq("case_id", case_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let pageText: string;
    let isIcs = false;
    try {
      const res = await fetch(calendar_url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MyVowCalendar/1.0)" },
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        return NextResponse.json({ error: BAD_URL_MESSAGE }, { status: 400 });
      }
      const contentType = res.headers.get("content-type");
      isIcs = isIcsContent(contentType, calendar_url);
      const raw = await res.text();
      if (isIcs) {
        pageText = raw;
      } else {
        pageText = stripHtml(raw);
      }
      if (!pageText || pageText.length < 50) {
        return NextResponse.json({ error: BAD_URL_MESSAGE }, { status: 400 });
      }
    } catch (e) {
      clearTimeout(timeoutId);
      return NextResponse.json({ error: BAD_URL_MESSAGE }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

    const anthropic = new Anthropic({ apiKey });
    const userMessage = EXTRACTION_PROMPT_TEMPLATE + "\n\n" + pageText.slice(0, 100_000);

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = response.content.find((c) => c.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text.trim() : "";
    if (!raw) {
      return NextResponse.json({ error: "No extraction result from page" }, { status: 500 });
    }

    const cleaned = raw.replace(/^```json?\s*|\s*```$/g, "").trim();
    let parsed: ExtractedPayload;
    try {
      parsed = JSON.parse(cleaned) as ExtractedPayload;
    } catch {
      return NextResponse.json({ error: "Invalid JSON from extraction" }, { status: 500 });
    }

    const school_year = isIcs
      ? deriveSchoolYearFromIcs(pageText)
      : (typeof parsed.school_year === "string" ? parsed.school_year.trim() || "Unknown" : "Unknown");
    const school_name = school_nameOverride ?? (typeof parsed.school_name === "string" ? parsed.school_name.trim() || null : null);
    const district = typeof parsed.district === "string" ? parsed.district.trim() || null : null;
    const extracted_breaks = {
      breaks: parsed.breaks ?? {},
      no_school_days: Array.isArray(parsed.no_school_days) ? parsed.no_school_days : [],
      key_dates: parsed.key_dates ?? {},
    };

    const { data: inserted, error: insertErr } = await admin
      .from("school_calendars")
      .insert({
        case_id,
        school_year,
        school_name,
        district,
        calendar_url,
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
      if (resolveRes.ok && typeof resolveData.resolved === "number") resolved = resolveData.resolved;
    } catch {
      // optional
    }

    return NextResponse.json({
      success: true,
      calendar: inserted,
      resolved,
    });
  } catch (e) {
    console.error("[school-calendar/import]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 }
    );
  }
}
