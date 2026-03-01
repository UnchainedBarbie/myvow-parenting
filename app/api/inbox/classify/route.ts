import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

const BUCKET = "inbox";

const CLASSIFY_PROMPT = `You are an AI assistant for a co-parenting application called MyVow Parenting. Analyze the uploaded file and classify it as one of: document, expense, or event.

Extract relevant fields based on the classification.

Document categories: parenting_plan, modification, custody_order, financial_order, restraining_order, court_order, school, medical, expenses, therapy, legal, custody, photos, communication, incident, other
Expense categories: medical, clothing, education, extracurricular, childcare, transportation, other  
Event categories: medical, school, extracurricular, custody_exchange, therapy, legal, other

When classifying the document type, use these specific rules:
- 'parenting_plan' — the original full parenting plan covering custody schedule, decision-making, and financial obligations
- 'modification' — any order that CHANGES or AMENDS a previous order, including modifications to custody schedules, holiday schedules, parenting time, or support
- 'custody_order' — a court-issued custody order that is not a full parenting plan (e.g., temporary orders, emergency orders)
- 'financial_order' — child support orders, support modifications, financial declarations
- 'restraining_order' — protection orders, restraining orders

If the document references or modifies a PREVIOUS order (look for words like 'modification', 'amended', 'revised', 'stipulation', 'supplemental', 'order re:', or if it only covers a specific topic like holidays rather than the full parenting plan), classify it as 'modification' not 'parenting_plan'.

A document that ONLY covers holiday/vacation schedules is a 'modification' not a 'parenting_plan'.

When analyzing court documents such as parenting plans or custody orders, extract ALL of the following structured data in addition to the standard fields:

- For 'title', use the official document title from the header (e.g., 'Parenting Plan', 'Custody Order', 'Modification')
- For 'court_case_number', look for the case number on the document (e.g., '2016DR192', '2024-DR-12345'). Do NOT use the document title as the case number.
- For 'jurisdiction', look for the court name, county, and state (e.g., 'Arapahoe County District Court, Colorado')
- For 'date', use the DATE FILED or effective date from the document header
- For 'category', use one of parenting_plan, modification, custody_order, financial_order, restraining_order (or court_order only if none of these fit) based on the rules above
- For 'child_names', extract the children's first names only (not full names)

Include these additional fields in your JSON response when the document is a court document:

  "court_case_number": "the actual case number e.g. 2016DR192",
  "jurisdiction": "court name, county, and state e.g. Arapahoe County District Court, Colorado",
  "custody_schedule": {
    "school_year": {
      "mother_weekdays": ["Monday", "Tuesday"],
      "father_weekdays": ["Wednesday", "Thursday"],
      "alternating_day": "Friday" or null,
      "alternating_includes_weekend": true or false,
      "notes": "any additional schedule details"
    },
    "summer": {
      "same_as_school_year": true or false,
      "mother_weekdays": [],
      "father_weekdays": [],
      "notes": "summer-specific details"
    },
    "overnights": {
      "mother_per_year": 182 or null,
      "father_per_year": 183 or null
    },
    "transportation": "rule for pickup/dropoff e.g. Parent who has the children picks up from school"
  },
  "holiday_schedule": [
    {
      "holiday_name": "Mother's Day Weekend",
      "odd_years": "mother" or "father" or null,
      "even_years": "mother" or "father" or null,
      "all_years": "mother" or "father" or null,
      "time_and_place": "exchange details if specified"
    }
  ],
  "decision_making": [
    {
      "category": "Educational",
      "authority": "joint" or "mother" or "father" or "other",
      "notes": null
    }
  ],
  "financial": {
    "child_support_amount": 0,
    "child_support_frequency": "monthly",
    "child_support_payer": "father" or "mother",
    "child_support_payee": "mother" or "father",
    "medical_insurance_provider": "mother" or "father" or "both",
    "extraordinary_medical_split": {"mother_percent": 50, "father_percent": 50},
    "expense_split_percent": 50
  },
  "other_terms": {
    "dispute_resolution": "mediation" or "arbitration" or "court" or null,
    "phone_access": "description of phone access rules",
    "travel_notification_required": true or false,
    "school_residence_parent": "mother" or "father"
  }

Extract as much data as possible. Use null for any field you cannot determine from the document. For holiday_schedule, include EVERY holiday mentioned in the document even if the assignment columns are empty.

Respond ONLY in JSON format with no other text. For non-court documents, omit the court-specific fields (custody_schedule, holiday_schedule, decision_making, financial, other_terms) or set them to null.
{
  "type": "document" or "expense" or "event",
  "confidence": 0.0 to 1.0,
  "title": "suggested title",
  "description": "brief description",
  "category": "category from the allowed list above",
  "child_names": ["names of children mentioned if any"],
  "date": "YYYY-MM-DD if found",
  "court_case_number": null or "actual case number",
  "jurisdiction": null or "court name and location",
  "custody_schedule": null or object above,
  "holiday_schedule": null or array above,
  "decision_making": null or array above,
  "financial": null or object above,
  "other_terms": null or object above,
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
  court_case_number?: string | null;
  jurisdiction?: string | null;
  custody_schedule?: Record<string, unknown> | null;
  holiday_schedule?: unknown[] | null;
  decision_making?: unknown[] | null;
  financial?: Record<string, unknown> | null;
  other_terms?: Record<string, unknown> | null;
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
    console.log("[classify] === Route called ===");
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
    console.log("[classify] File uploaded to storage:", storagePath);

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
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      let text = "";
      console.log("[classify] ANTHROPIC_API_KEY exists:", !!process.env.ANTHROPIC_API_KEY);
      console.log("[classify] About to call Anthropic with model claude-sonnet-4-20250514");

      try {
        console.log("[classify] Calling Anthropic...");
        if (isImage(contentType)) {
          const base64FileData = buf.toString("base64");
          const mimeType = contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: mimeType,
                      data: base64FileData,
                    },
                  },
                  { type: "text", text: CLASSIFY_PROMPT },
                ],
              },
            ],
          });
          console.log("[classify] Anthropic response received:", JSON.stringify(response.content[0]).slice(0, 200));
          text = response.content[0].type === "text" ? response.content[0].text : "";
        } else if (contentType === PDF_TYPE) {
          const base64FileData = buf.toString("base64");
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data: base64FileData,
                    },
                  },
                  { type: "text", text: CLASSIFY_PROMPT },
                ],
              },
            ],
          });
          console.log("[classify] Anthropic response received:", JSON.stringify(response.content[0]).slice(0, 200));
          text = response.content[0].type === "text" ? response.content[0].text : "";
        } else {
          const textPrompt = `Filename: ${file.name}. File type: ${contentType}. Infer classification and suggested fields from the filename. ${CLASSIFY_PROMPT}`;
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
            messages: [{ role: "user", content: textPrompt }],
          });
          console.log("[classify] Anthropic response received:", JSON.stringify(response.content[0]).slice(0, 200));
          text = response.content[0].type === "text" ? response.content[0].text : "";
        }
      } catch (anthropicError) {
        console.error("[classify] Anthropic API call failed:", anthropicError);
        return NextResponse.json({ error: "AI classification failed", details: String(anthropicError) }, { status: 500 });
      }

      payload = parseClassifyResponse(text.trim(), file.name);
    }

    console.log("[classify] Parsed classification:", JSON.stringify(payload).slice(0, 300));

    const childNames = Array.isArray(payload.child_names) ? payload.child_names : [];
    let aiChildIds: string[] = [];
    if (childNames.length > 0) {
      const { data: children } = await admin
        .from("children")
        .select("id, first_name")
        .eq("case_id", case_id)
        .is("deleted_at", null);
      const caseChildren = (children ?? []) as { id: string; first_name: string }[];
      const nameToId = new Map(caseChildren.map((c) => [c.first_name.trim().toLowerCase(), c.id]));
      for (const name of childNames) {
        const key = String(name).trim().toLowerCase();
        const id = nameToId.get(key);
        if (id && !aiChildIds.includes(id)) aiChildIds.push(id);
      }
    }

    const { data: row, error: insertErr } = await admin
      .from("inbox_items")
      .insert({
        case_id,
        created_by: user.id,
        file_path: storagePath,
        file_name: file.name,
        ai_type: payload.type,
        ai_confidence: Math.min(1, Math.max(0, payload.confidence)),
        ai_title: payload.title || null,
        ai_description: payload.description || null,
        ai_category: payload.category || null,
        ai_child_ids: aiChildIds,
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

    if (payload.custody_schedule || payload.holiday_schedule || payload.decision_making || payload.financial) {
      const { data: plan } = await admin
        .from("parenting_plans")
        .select("id, effective_date")
        .eq("case_id", case_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const planId = (plan as { id?: string } | null)?.id;
      const effectiveDate = payload.date || (plan as { effective_date?: string | null } | null)?.effective_date || null;

      if (planId) {
        if (payload.custody_schedule && typeof payload.custody_schedule === "object") {
          const cs = payload.custody_schedule as Record<string, unknown>;
          const schoolYear = cs.school_year as Record<string, unknown> | undefined;
          if (schoolYear) {
            await admin.from("custody_schedules").insert({
              parenting_plan_id: planId,
              case_id,
              schedule_type: "school_year",
              mother_weekdays: (schoolYear.mother_weekdays as string[]) || [],
              father_weekdays: (schoolYear.father_weekdays as string[]) || [],
              alternating_day: schoolYear.alternating_day,
              pickup_rule: cs.transportation,
              notes: schoolYear.notes,
              mother_overnights_per_year: (cs.overnights as Record<string, unknown>)?.mother_per_year,
              father_overnights_per_year: (cs.overnights as Record<string, unknown>)?.father_per_year,
              effective_date: effectiveDate,
            });
            console.log("[classify] Saved school_year custody schedule");
          }
        }

        if (payload.holiday_schedule && Array.isArray(payload.holiday_schedule)) {
          for (const h of payload.holiday_schedule) {
            const entry = h as Record<string, unknown>;
            await admin.from("holiday_schedules").insert({
              parenting_plan_id: planId,
              case_id,
              holiday_name: entry.holiday_name,
              even_year_parent: entry.even_years ?? entry.all_years ?? "unknown",
              odd_year_parent: entry.odd_years ?? entry.all_years ?? "unknown",
              exchange_location: entry.time_and_place,
              auto_create_events: true,
              effective_date: effectiveDate,
            });
          }
          console.log("[classify] Saved", payload.holiday_schedule.length, "holiday schedules");
        }

        if (payload.decision_making && Array.isArray(payload.decision_making)) {
          for (const d of payload.decision_making) {
            const entry = d as Record<string, unknown>;
            await admin.from("decision_authority").insert({
              parenting_plan_id: planId,
              case_id,
              category: entry.category,
              authority: entry.authority,
              notes: entry.notes,
              effective_date: effectiveDate,
            });
          }
          console.log("[classify] Saved decision authority entries");
        }

        if (payload.financial && typeof payload.financial === "object") {
          const f = payload.financial as Record<string, unknown>;
          const exMed = f.extraordinary_medical_split as Record<string, unknown> | undefined;
          await admin.from("cases").update({
            child_support_amount: f.child_support_amount,
            child_support_frequency: f.child_support_frequency,
            child_support_payer: f.child_support_payer,
            medical_insurance_provider: f.medical_insurance_provider,
            extraordinary_medical_split_percent: exMed?.mother_percent,
            custody_split_percent: f.expense_split_percent,
          }).eq("id", case_id);
          console.log("[classify] Updated cases with financial terms");
        }

        if (payload.custody_schedule && typeof payload.custody_schedule === "object" && (payload.custody_schedule as Record<string, unknown>).transportation) {
          await admin.from("exchange_locations").insert({
            parenting_plan_id: planId,
            case_id,
            rule_description: (payload.custody_schedule as Record<string, unknown>).transportation,
            applies_to: "all",
            effective_date: effectiveDate,
          });
          console.log("[classify] Saved exchange rules");
        }
      }
    }

    const responsePayload = {
      ...row,
      court_case_number: payload.court_case_number ?? null,
      jurisdiction: payload.jurisdiction ?? null,
      custody_schedule: payload.custody_schedule ?? null,
      holiday_schedule: payload.holiday_schedule ?? null,
      decision_making: payload.decision_making ?? null,
      financial: payload.financial ?? null,
      other_terms: payload.other_terms ?? null,
    };

    return NextResponse.json(responsePayload);
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
  const court_case_number = typeof parsed.court_case_number === "string" ? parsed.court_case_number : parsed.court_case_number == null ? null : String(parsed.court_case_number);
  const jurisdiction = typeof parsed.jurisdiction === "string" ? parsed.jurisdiction : parsed.jurisdiction == null ? null : String(parsed.jurisdiction);
  const custody_schedule = parsed.custody_schedule != null && typeof parsed.custody_schedule === "object" && !Array.isArray(parsed.custody_schedule) ? (parsed.custody_schedule as Record<string, unknown>) : null;
  const holiday_schedule = Array.isArray(parsed.holiday_schedule) ? parsed.holiday_schedule : null;
  const decision_making = Array.isArray(parsed.decision_making) ? parsed.decision_making : null;
  const financial = parsed.financial != null && typeof parsed.financial === "object" && !Array.isArray(parsed.financial) ? (parsed.financial as Record<string, unknown>) : null;
  const other_terms = parsed.other_terms != null && typeof parsed.other_terms === "object" && !Array.isArray(parsed.other_terms) ? (parsed.other_terms as Record<string, unknown>) : null;

  return {
    type,
    confidence,
    title,
    description,
    category,
    child_names,
    date,
    court_case_number: court_case_number ?? undefined,
    jurisdiction: jurisdiction ?? undefined,
    custody_schedule: custody_schedule ?? undefined,
    holiday_schedule: holiday_schedule ?? undefined,
    decision_making: decision_making ?? undefined,
    financial: financial ?? undefined,
    other_terms: other_terms ?? undefined,
    amount,
    vendor,
    start_time,
    end_time,
    location,
    is_all_day,
  };
}
