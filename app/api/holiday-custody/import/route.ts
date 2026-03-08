import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const BUCKET = "inbox";

const SYSTEM_PROMPT = `You are extracting holiday parenting time rules from one or more court order documents. Multiple documents may be provided. They are ordered oldest to newest. The MOST RECENT document takes precedence on any overlapping or conflicting terms. Return ONLY valid JSON — no markdown, no explanation, no code fences.`;

const EXTRACTION_PROMPT = `Extract all holiday parenting time rules from these documents. The most recent document overrides older ones on any conflict.

Return JSON in this exact shape:
{
  "holidays": [
    {
      "holiday_name": string,
      "assigned_to": "mother" | "father" | "alternating",
      "odd_year_parent": "mother" | "father" | null,
      "even_year_parent": "mother" | "father" | null,
      "start_date": "YYYY-MM-DD" | null,
      "end_date": "YYYY-MM-DD" | null,
      "start_description": string | null,
      "end_description": string | null,
      "is_relative": boolean,
      "notes": string | null
    }
  ],
  "vacation_rules": {
    "max_consecutive_overnights": number | null,
    "notice_days_required": number | null,
    "notes": string | null
  } | null
}

Rules:
- Holidays that rotate by odd/even year: assigned_to = "alternating", populate odd_year_parent and even_year_parent
- Mother's Day / Father's Day (same parent every year): assigned_to = "mother" or "father", odd/even fields = null
- Fixed calendar dates (e.g. Christmas Dec 23–27): calculate start_date/end_date for current year, is_relative = false
- School-calendar-dependent holidays (Spring Break, Thanksgiving Break, summer vacation): is_relative = true, start_date/end_date = null, populate start_description and end_description from the document text
- Return only JSON, nothing else.`;

type CourtOrderRow = { id: string; title: string | null; type: string | null; date: string | null; file_path: string | null };

type ExtractedHoliday = {
  holiday_name?: string;
  assigned_to?: "mother" | "father" | "alternating";
  odd_year_parent?: "mother" | "father" | null;
  even_year_parent?: "mother" | "father" | null;
  start_date?: string | null;
  end_date?: string | null;
  start_description?: string | null;
  end_description?: string | null;
  is_relative?: boolean;
  notes?: string | null;
};

type ExtractedPayload = {
  holidays?: ExtractedHoliday[];
  vacation_rules?: { max_consecutive_overnights?: number | null; notice_days_required?: number | null; notes?: string | null } | null;
};

async function getCaseIdForUser(admin: ReturnType<typeof getServiceRoleClient>, userId: string) {
  const { data: membership } = await admin
    .from("case_members")
    .select("case_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return membership?.case_id ?? null;
}

function resolveCustodialParent(
  h: ExtractedHoliday,
  year: number
): "user" | "coparent" {
  const assigned = h.assigned_to;
  if (assigned === "mother") return "user";
  if (assigned === "father") return "coparent";
  if (assigned === "alternating") {
    const isOdd = year % 2 === 1;
    const parent = isOdd ? h.odd_year_parent : h.even_year_parent;
    return parent === "father" ? "coparent" : "user";
  }
  return "user";
}

/**
 * POST /api/holiday-custody/import — extract holiday custody from court order documents (parenting_plans table) and upsert into holiday_custody.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = getServiceRoleClient();
    const caseId = await getCaseIdForUser(admin, user.id);
    // case_id is from the user's session (case_members), not request body or query params
    console.log("[holiday-custody/import] case_id from session:", caseId ?? "null/undefined");

    if (!caseId) return NextResponse.json({ error: "No case found" }, { status: 403 });

    // Step 1 — Fetch ALL court orders for the case (oldest first so newest overwrites on conflict).
    // parenting_plans columns (per Profile + court-orders API): id, title, custody_type, effective_date, file_path, deleted_at
    // Equivalent SQL: SELECT id, title, custody_type, effective_date, file_path FROM parenting_plans
    //   WHERE case_id = :caseId AND deleted_at IS NULL ORDER BY effective_date ASC
    //   (no LIMIT — we need every court order for the case)
    console.log("[holiday-custody/import] query: parenting_plans WHERE case_id =", caseId, "AND deleted_at IS NULL ORDER BY effective_date ASC (no LIMIT)");

    const { data: plans, error: plansErr } = await admin
      .from("parenting_plans")
      .select("id, title, custody_type, effective_date, file_path")
      .eq("case_id", caseId)
      .is("deleted_at", null)
      .order("effective_date", { ascending: true });

    console.log("[holiday-custody/import] court orders returned:", (plans ?? []).map((p: { id?: string; title?: string | null; effective_date?: string | null; file_path?: string | null }) => ({
      title: p.title,
      effective_date: p.effective_date,
      file_path_populated: !!p.file_path && typeof p.file_path === "string",
      file_path_preview: typeof p.file_path === "string" ? p.file_path.slice(0, 50) + (p.file_path.length > 50 ? "…" : "") : null,
    })));

    if (plansErr || !plans?.length) {
      return NextResponse.json(
        { error: "No court orders found. Upload documents in Profile → Court Orders first." },
        { status: 400 }
      );
    }
    const list: CourtOrderRow[] = (plans as { id: string; title: string | null; custody_type: string | null; effective_date: string | null; file_path: string | null }[]).map((p) => ({
      id: p.id,
      title: p.title,
      type: p.custody_type,
      date: p.effective_date,
      file_path: p.file_path,
    }));
    const withFile = list.filter((o) => o.file_path && typeof o.file_path === "string");
    if (withFile.length === 0) {
      return NextResponse.json(
        { error: "No court orders found. Upload documents in Profile → Court Orders first." },
        { status: 400 }
      );
    }

    // Step 2 — Download each file and convert to base64
    const docs: { title: string; date: string; base64: string; isPdf: boolean; mediaType: "application/pdf" | "image/jpeg" | "image/png" }[] = [];
    for (const row of withFile) {
      const storagePath = row.file_path as string;
      const { data: fileData, error: downloadErr } = await admin.storage.from(BUCKET).download(storagePath);
      const downloadOk = !downloadErr && !!fileData;
      console.log("[holiday-custody/import] storage download:", { title: row.title, path: storagePath.slice(0, 60), success: downloadOk, error: downloadErr?.message ?? null });
      if (downloadErr || !fileData) continue;
      const arrayBuffer = await fileData.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const ext = storagePath.split(".").pop()?.toLowerCase() ?? "";
      const isPdf = ext === "pdf";
      const mediaType: "application/pdf" | "image/jpeg" | "image/png" = isPdf ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
      const title = (row.title as string) ?? "Court order";
      const date = (row.date as string) ?? "";
      docs.push({ title, date, base64, isPdf, mediaType });
    }
    if (docs.length === 0) {
      return NextResponse.json(
        { error: "Could not read any court order files." },
        { status: 500 }
      );
    }

    console.log("[holiday-custody/import] court order files found:", docs.length, docs.map((d) => ({ title: d.title, date: d.date })));

    // Step 3 — Build user message: label + file for each doc, then extraction prompt
    const total = docs.length;
    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
      | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png"; data: string } }
    > = [];
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      userContent.push({
        type: "text",
        text: `Document ${i + 1} of ${total}: ${d.title} (dated ${d.date})`,
      });
      if (d.mediaType === "application/pdf") {
        userContent.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: d.base64 },
        });
      } else {
        userContent.push({
          type: "image",
          source: { type: "base64", media_type: d.mediaType, data: d.base64 },
        });
      }
    }
    userContent.push({ type: "text", text: EXTRACTION_PROMPT });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    });

    console.log("[holiday-custody/import] Anthropic API response content:", JSON.stringify(response.content?.map((c) => (c.type === "text" ? { type: "text", textLength: (c as { text?: string }).text?.length ?? 0, textPreview: (c as { text?: string }).text?.slice(0, 200) ?? "" } : { type: c.type })) ?? []));

    const textBlock = response.content.find((c) => c.type === "text");
    const raw = textBlock?.type === "text" ? textBlock.text.trim() : "";
    if (!raw) {
      return NextResponse.json({ success: false, error: "No holidays extracted." });
    }

    let cleaned = raw.replace(/^```json?\s*|\s*```$/g, "").trim();
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();
    console.log("[holiday-custody/import] after strip code fences, before JSON.parse:", cleaned.length, "chars, preview:", cleaned.slice(0, 300));

    let parsed: ExtractedPayload;
    try {
      parsed = JSON.parse(cleaned) as ExtractedPayload;
    } catch (parseErr) {
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as ExtractedPayload;
        } catch {
          console.error("[holiday-custody/import] JSON.parse error:", parseErr);
          return NextResponse.json({ success: false, error: "Invalid JSON from extraction." });
        }
      } else {
        console.error("[holiday-custody/import] JSON.parse error:", parseErr);
        return NextResponse.json({ success: false, error: "Invalid JSON from extraction." });
      }
    }

    const holidays = Array.isArray(parsed?.holidays) ? parsed.holidays : [];
    console.log("[holiday-custody/import] parsed holidays:", holidays.length, "items, sample:", holidays.slice(0, 3));
    const currentYear = new Date().getFullYear();
    let imported = 0;
    const relative: string[] = [];

    for (const h of holidays) {
      const rawName = h.holiday_name ?? (h as Record<string, unknown>).holidayName ?? (h as Record<string, unknown>).name;
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (!name) continue;

      const custodial_parent = resolveCustodialParent(h, currentYear);
      const start_date = typeof h.start_date === "string" && h.start_date && /^\d{4}-\d{2}-\d{2}$/.test(h.start_date.slice(0, 10))
        ? h.start_date.slice(0, 10)
        : null;
      const end_date = typeof h.end_date === "string" && h.end_date && /^\d{4}-\d{2}-\d{2}$/.test(h.end_date.slice(0, 10))
        ? h.end_date.slice(0, 10)
        : start_date;
      const isRelative = Boolean(h.is_relative);
      const start_description = typeof h.start_description === "string" ? h.start_description.trim() || null : null;
      const end_description = typeof h.end_description === "string" ? h.end_description.trim() || null : null;

      if (isRelative) relative.push(name);

      const payload: Record<string, unknown> = {
        case_id: caseId,
        holiday_name: name,
        year: currentYear,
        start_date: isRelative ? null : (start_date ?? null),
        end_date: isRelative ? null : (end_date ?? start_date ?? null),
        custodial_parent,
        source: "import",
      };
      if (start_description != null) payload.start_description = start_description;
      if (end_description != null) payload.end_description = end_description;
      if (isRelative) payload.is_relative = true;

      const { data: existing } = await admin
        .from("holiday_custody")
        .select("id")
        .eq("case_id", caseId)
        .eq("holiday_name", name)
        .eq("year", currentYear)
        .is("deleted_at", null)
        .maybeSingle();

      if (existing) {
        const { error: updateErr } = await admin
          .from("holiday_custody")
          .update(payload)
          .eq("id", existing.id);
        if (updateErr) {
          console.error("[holiday-custody/import] update error for", name, updateErr);
          const corePayload = { case_id: caseId, holiday_name: name, year: currentYear, start_date: payload.start_date, end_date: payload.end_date, custodial_parent, source: "import" };
          const { error: retryErr } = await admin.from("holiday_custody").update(corePayload).eq("id", existing.id);
          if (!retryErr) imported += 1;
          else console.error("[holiday-custody/import] update retry error for", name, retryErr);
        } else {
          imported += 1;
        }
      } else {
        const { error: insertErr } = await admin.from("holiday_custody").insert(payload);
        if (insertErr) {
          console.error("[holiday-custody/import] insert error for", name, insertErr);
          const corePayload = { case_id: caseId, holiday_name: name, year: currentYear, start_date: payload.start_date, end_date: payload.end_date, custodial_parent, source: "import" };
          const { error: retryErr } = await admin.from("holiday_custody").insert(corePayload);
          if (!retryErr) imported += 1;
          else console.error("[holiday-custody/import] insert retry error for", name, retryErr);
        } else {
          imported += 1;
        }
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      relative,
    });
  } catch (e) {
    console.error("[holiday-custody/import]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 }
    );
  }
}
