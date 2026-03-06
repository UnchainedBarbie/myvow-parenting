import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { extractPdfText } from "@/lib/pdf-extract";

export const runtime = "nodejs";

const BUCKET = "inbox";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

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
- For 'children', extract BOTH:
  - 'first_name' — the child's first name only (not full name)
  - 'date_of_birth' — the child's date of birth in strict YYYY-MM-DD format if available, otherwise null

Parenting plan PDFs often include a table with columns like 'Full Name of Child' and 'Date of Birth'. Read that table carefully and return one entry in the 'children' array for each row in the table.

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
  "children": [
    {
      "first_name": "child's first name only",
      "date_of_birth": "YYYY-MM-DD if found, otherwise null"
    }
  ],
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
  children?: { first_name: string; date_of_birth: string | null }[] | null;
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

type EmailClassification = {
  item_type: "expense" | "document" | "message" | "calendar_event" | "other";
  suggested_category: string | null;
  summary: string | null;
};

function extractEmailFromAddress(value: string | undefined | null): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/<([^>]+)>/);
  const email = match ? match[1].trim() : trimmed;
  return email ? email.toLowerCase() : null;
}

type PostmarkAttachment = {
  Name?: string;
  Content?: string;
  ContentType?: string;
  ContentLength?: number;
};

type PostmarkPayload = {
  To?: string | null;
  From?: string | null;
  Subject?: string | null;
  TextBody?: string | null;
  HtmlBody?: string | null;
  Attachments?: PostmarkAttachment[];
};

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
  const rawChildren = Array.isArray((parsed as Record<string, unknown>).children)
    ? ((parsed as Record<string, unknown>).children as unknown[])
    : [];
  const children: { first_name: string; date_of_birth: string | null }[] = [];
  for (const c of rawChildren) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;
    const first = typeof obj.first_name === "string" ? obj.first_name.trim() : "";
    if (!first) continue;
    let dob: string | null = null;
    if (obj.date_of_birth != null) {
      const raw = String(obj.date_of_birth).slice(0, 10);
      dob = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    }
    children.push({ first_name: first, date_of_birth: dob });
  }
  const date = typeof parsed.date === "string" ? parsed.date.slice(0, 10) : null;
  const amount = typeof parsed.amount === "number" ? parsed.amount : null;
  const vendor = typeof parsed.vendor === "string" ? parsed.vendor : null;
  const start_time = typeof parsed.start_time === "string" ? parsed.start_time : null;
  const end_time = typeof parsed.end_time === "string" ? parsed.end_time : null;
  const location = typeof parsed.location === "string" ? parsed.location : null;
  const is_all_day = !!parsed.is_all_day;

  return {
    type,
    confidence,
    title,
    description,
    category,
    child_names: Array.isArray(parsed.child_names)
      ? (parsed.child_names as unknown[]).map((n) => String(n))
      : [],
    children: children.length > 0 ? children : null,
    date,
    court_case_number:
      typeof parsed.court_case_number === "string" || parsed.court_case_number === null
        ? (parsed.court_case_number as string | null)
        : null,
    jurisdiction:
      typeof parsed.jurisdiction === "string" || parsed.jurisdiction === null
        ? (parsed.jurisdiction as string | null)
        : null,
    custody_schedule: (parsed.custody_schedule as Record<string, unknown> | null) ?? null,
    holiday_schedule: (parsed.holiday_schedule as unknown[] | null) ?? null,
    decision_making: (parsed.decision_making as unknown[] | null) ?? null,
    financial: (parsed.financial as Record<string, unknown> | null) ?? null,
    other_terms: (parsed.other_terms as Record<string, unknown> | null) ?? null,
    amount,
    vendor,
    start_time,
    end_time,
    location,
    is_all_day,
  };
}

async function ensureInboxBucket(admin: ReturnType<typeof getServiceRoleClient>) {
  const bucketList = await admin.storage.listBuckets();
  const bucketExists = bucketList?.data?.some((b: { name: string }) => b.name === BUCKET);
  if (!bucketExists) {
    try {
      await admin.storage.createBucket(BUCKET, { public: false });
    } catch {
      // bucket may already exist
    }
  }
}

async function classifyFileWithAnthropic(buf: Buffer, fileName: string, contentType: string): Promise<ClassifyPayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return parseClassifyResponse(undefined, fileName);
  }

  const anthropic = new Anthropic({ apiKey });
  let text = "";

  try {
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
      text = response.content[0].type === "text" ? response.content[0].text : "";
    } else if (contentType === PDF_TYPE) {
      const extracted = await extractPdfText(buf);
      if (extracted && extracted.length > 100) {
        const truncated = extracted.slice(0, 8000);
        const textPrompt = `PDF Content:\n${truncated}\n\n${CLASSIFY_PROMPT}`;
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [{ role: "user", content: textPrompt }],
        });
        text = response.content[0].type === "text" ? response.content[0].text : "";
      } else {
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
        text = response.content[0].type === "text" ? response.content[0].text : "";
      }
    } else {
      const textPrompt = `Filename: ${fileName}. File type: ${contentType}. Infer classification and suggested fields from the filename. ${CLASSIFY_PROMPT}`;
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: textPrompt }],
      });
      text = response.content[0].type === "text" ? response.content[0].text : "";
    }
  } catch (error) {
    console.error("[ingest/email] Anthropic classification failed for attachment:", error);
    return parseClassifyResponse(undefined, fileName);
  }

  return parseClassifyResponse(text.trim(), fileName);
}

async function mapChildNamesToIds(
  admin: ReturnType<typeof getServiceRoleClient>,
  caseId: string,
  childNames: string[]
): Promise<string[]> {
  const childNamesClean = childNames.map((n) => String(n).trim().toLowerCase()).filter(Boolean);
  if (childNamesClean.length === 0) return [];

  const { data: children } = await admin
    .from("children")
    .select("id, first_name")
    .eq("case_id", caseId)
    .is("deleted_at", null);

  const caseChildren = (children ?? []) as { id: string; first_name: string }[];
  const nameToId = new Map(caseChildren.map((c) => [c.first_name.trim().toLowerCase(), c.id]));

  const aiChildIds: string[] = [];
  for (const name of childNamesClean) {
    const id = nameToId.get(name);
    if (id && !aiChildIds.includes(id)) aiChildIds.push(id);
  }
  return aiChildIds;
}

const EMAIL_BODY_SYSTEM = `Classify this email for a parenting app. Determine: item_type (expense|document|message|calendar_event|other), suggested_category (string), summary (max 2 sentences). Respond with JSON only.`;

function parseEmailClassification(raw: string | undefined): EmailClassification {
  const fallback: EmailClassification = {
    item_type: "other",
    suggested_category: null,
    summary: null,
  };
  if (!raw?.trim()) return fallback;
  try {
    const cleaned = raw.replace(/^```json?\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const itemType = parsed.item_type;
    const allowed = ["expense", "document", "message", "calendar_event", "other"];
    const safeType =
      typeof itemType === "string" && allowed.includes(itemType)
        ? (itemType as EmailClassification["item_type"])
        : "other";
    const suggested =
      typeof parsed.suggested_category === "string" && parsed.suggested_category.trim()
        ? parsed.suggested_category.trim()
        : null;
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : null;
    return {
      item_type: safeType,
      suggested_category: suggested,
      summary,
    };
  } catch (e) {
    console.error("[ingest/email] Failed to parse email classification JSON:", e);
    return fallback;
  }
}

async function classifyEmailBody(subject: string, textBody: string | null): Promise<EmailClassification> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      item_type: "other",
      suggested_category: null,
      summary: null,
    };
  }

  const anthropic = new Anthropic({ apiKey });
  const bodyText = textBody && typeof textBody === "string" ? textBody : "";
  const truncatedBody = bodyText.slice(0, 2000);
  const userContent = `Subject: ${subject || "(no subject)"}\n\n${truncatedBody}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: EMAIL_BODY_SYSTEM,
      messages: [{ role: "user", content: userContent }],
    });
    const content = response.content[0];
    const textContent = content?.type === "text" ? content.text : undefined;
    return parseEmailClassification(textContent);
  } catch (e) {
    console.error("[ingest/email] Anthropic classification failed for email body:", e);
    return {
      item_type: "other",
      suggested_category: null,
      summary: null,
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.POSTMARK_WEBHOOK_SECRET;
    const authHeader = req.headers.get("authorization") ?? "";
    const webhookSecretHeader = req.headers.get("x-webhook-secret") ?? "";

    if (secret) {
      const expectedBearer = `Bearer ${secret}`;
      const valid =
        authHeader === secret ||
        authHeader === expectedBearer ||
        webhookSecretHeader === secret;
      if (!valid) {
        console.error("[ingest/email] Invalid Postmark webhook signature/secret");
        return NextResponse.json({ ok: true });
      }
    }

    const body = (await req.json().catch(() => null)) as PostmarkPayload | null;

    if (!body) {
      console.error("[ingest/email] Failed to parse JSON body");
      return NextResponse.json({ ok: true });
    }

    const toAddress = extractEmailFromAddress(body.To);
    const fromEmail = extractEmailFromAddress(body.From);
    const fromRaw = (body.From ?? "").toString().trim();
    const subject = (body.Subject ?? "").toString().slice(0, 512);

    if (!toAddress) {
      console.error("[ingest/email] Missing or invalid To address in webhook payload");
      return NextResponse.json({ ok: true });
    }

    const admin = getServiceRoleClient();
    const { data: caseRow, error: caseError } = await admin
      .from("cases")
      .select("id")
      .eq("ingest_email", toAddress)
      .limit(1)
      .maybeSingle();

    if (caseError) {
      console.error("[ingest/email] Error looking up case by ingest_email:", caseError);
      return NextResponse.json({ ok: true });
    }

    if (!caseRow?.id) {
      return NextResponse.json({ ok: true });
    }

    const caseId = caseRow.id as string;
    const attachments = Array.isArray(body.Attachments) ? body.Attachments : [];

    await ensureInboxBucket(admin);

    let processedAttachment = false;

    for (const att of attachments) {
      try {
        const filename = (att.Name ?? "attachment").toString().slice(0, 255);
        const contentType = (att.ContentType ?? "application/octet-stream").toString();

        if (!ALLOWED_ATTACHMENT_TYPES.includes(contentType)) {
          continue;
        }

        if (!att.Content || typeof att.Content !== "string") {
          console.error("[ingest/email] Attachment had no Content:", filename);
          continue;
        }

        let buf: Buffer;
        try {
          buf = Buffer.from(att.Content, "base64");
        } catch (e) {
          console.error("[ingest/email] Failed to decode attachment base64:", e);
          continue;
        }

        if (buf.length > MAX_ATTACHMENT_BYTES) {
          console.error("[ingest/email] Attachment too large, skipping:", filename);
          continue;
        }

        const timestamp = Date.now();
        const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
        const storagePath = `${caseId}/email/${timestamp}-${safeName}`;

        const { error: uploadError } = await admin.storage
          .from(BUCKET)
          .upload(storagePath, buf, { contentType, upsert: false });
        if (uploadError) {
          console.error("[ingest/email] Failed to upload attachment to storage:", uploadError);
          continue;
        }

        const payload = await classifyFileWithAnthropic(buf, filename, contentType);
        const aiChildIds = await mapChildNamesToIds(admin, caseId, payload.child_names);
        const clamp = (n: number) => Math.min(1, Math.max(0, n));

        const { error: insertErr } = await admin
          .from("inbox_items")
          .insert({
            case_id: caseId,
            file_path: storagePath,
            file_name: filename,
            source_type: "email",
            status: "pending",
            subject: subject || null,
            coparent_email: (fromEmail ?? fromRaw) || null,
            raw_content: {
              from: fromRaw || fromEmail || null,
              subject,
              attachment_name: filename,
            },
            ai_type: payload.type,
            ai_confidence: clamp(payload.confidence),
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
          });

        if (insertErr) {
          console.error("[ingest/email] Failed to insert inbox_items row for attachment:", insertErr);
          continue;
        }

        processedAttachment = true;
      } catch (e) {
        console.error("[ingest/email] Error processing attachment:", e);
      }
    }

    if (!processedAttachment) {
      let classification = await classifyEmailBody(subject, body.TextBody ?? null);

      const { count: memberCount } = await admin
        .from("case_members")
        .select("*", { count: "exact", head: true })
        .eq("case_id", caseId);

      const isSoloParent = (memberCount ?? 0) === 1;

      if (isSoloParent && classification.item_type === "message") {
        classification = {
          item_type: "document",
          suggested_category: "correspondence",
          summary: classification.summary,
        };
      }

      const { error: insertErr } = await admin.from("inbox_items").insert({
        case_id: caseId,
        source_type: "email",
        status: "pending",
        subject: subject || null,
        coparent_email: (fromEmail ?? fromRaw) || null,
        item_type: classification.item_type,
        suggested_category: classification.suggested_category,
        summary: classification.summary,
        raw_content: {
          from: fromRaw || fromEmail || null,
          subject,
          text: body.TextBody ?? null,
        },
      });

      if (insertErr) {
        console.error("[ingest/email] Failed to insert inbox_items row for email body:", insertErr);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[ingest/email] Unhandled error:", e);
    return NextResponse.json({ ok: true });
  }
}
