import Anthropic from "@anthropic-ai/sdk";

export const CLASSIFY_PROMPT = `You are an AI assistant for a co-parenting application called MyVow Parenting. Analyze the uploaded file and classify it as one of: document, expense, or event.

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

export type ClassifyPayload = {
  type: "document" | "expense" | "event";
  confidence: number;
  title: string;
  description: string;
  category: string;
  child_names: string[];
  /**
   * Optional structured children with DOBs, when available from the document.
   */
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

export function parseClassifyResponse(content: string | undefined, fallbackFileName: string): ClassifyPayload {
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
  const child_names = children.length > 0
    ? children.map((c) => c.first_name)
    : Array.isArray(parsed.child_names)
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
    children: children.length > 0 ? children : undefined,
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

/**
 * Run AI classification on a file buffer. Uses the same prompt and parsing as the inbox classify route.
 * Returns a default payload with empty child_names when ANTHROPIC_API_KEY is not set.
 */
export async function runClassify(
  buf: Buffer,
  contentType: string,
  fileName: string
): Promise<ClassifyPayload> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      type: "document",
      confidence: 0,
      title: fileName,
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
    } else {
      const textPrompt = `Filename: ${fileName}. File type: ${contentType}. Infer classification and suggested fields from the filename. ${CLASSIFY_PROMPT}`;
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: textPrompt }],
      });
      text = response.content[0].type === "text" ? response.content[0].text : "";
    }
  } catch (err) {
    console.error("[ai-classify] Anthropic API call failed:", err);
    return {
      type: "document",
      confidence: 0,
      title: fileName,
      description: "AI classification failed.",
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
  }

  return parseClassifyResponse(text.trim(), fileName);
}
