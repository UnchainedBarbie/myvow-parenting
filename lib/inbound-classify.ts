/**
 * Heuristic (and optional OCR) classification for email-to-MyVow inbound uploads.
 * Suggests: category, child_id (by name match), visibility, description, expense candidate.
 */

export type InboundSuggestion = {
  suggested_category: string;
  suggested_visibility: string;
  suggested_description: string;
  suggested_expense: boolean;
  suggested_amount: number | null;
  suggested_expense_date: string | null; // YYYY-MM-DD
  suggestion_confidence: number; // 0-1
  matched_child_name: string | null; // first name if matched
};

const CATEGORY_KEYWORDS: Array<{ keys: string[]; value: string }> = [
  { keys: ["medical", "doctor", "rx", "health", "vaccination", "pediatric"], value: "medical" },
  { keys: ["school", "report", "grade", "teacher", "tuition"], value: "school" },
  { keys: ["court", "order", "custody", "parenting plan"], value: "court_order" },
  { keys: ["therapy", "counsel", "counseling"], value: "therapy" },
  { keys: ["legal", "lawyer", "attorney"], value: "legal" },
  { keys: ["custody"], value: "custody" },
  { keys: ["receipt", "invoice", "expense", "payment", "paid"], value: "expenses" },
  { keys: ["financial", "bank", "tax"], value: "expenses" },
  { keys: ["photo", "img", "pic", "image", "camera"], value: "photos" },
  { keys: ["message", "email", "comm"], value: "communication" },
  { keys: ["incident"], value: "incident" },
];

const EXPENSE_KEYWORDS = [
  "receipt", "invoice", "payment", "paid", "total", "amount", "due",
  "balance", "refund", "copay", "co-pay", "bill", "statement",
];

function lower(s: string): string {
  return (s ?? "").toLowerCase();
}

function extractText(subject: string, bodyText: string, bodyHtml: string, fileNames: string[]): string {
  const parts = [
    subject ?? "",
    bodyText ?? "",
    (bodyHtml ?? "").replace(/<[^>]+>/g, " "),
    ...fileNames,
  ];
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Suggest category from combined email + attachment text. */
function suggestCategory(text: string): { value: string; confidence: number } {
  const t = lower(text);
  for (const { keys, value } of CATEGORY_KEYWORDS) {
    if (keys.some((k) => t.includes(k))) return { value, confidence: 0.7 };
  }
  return { value: "other", confidence: 0.3 };
}

/** Suggest visibility from category (e.g. expenses -> shared). */
function suggestVisibility(category: string): string {
  if (category === "expenses" || category === "school" || category === "medical") return "family";
  if (category === "court_order" || category === "legal" || category === "incident") return "parents_only";
  return "family";
}

/** Short human-friendly description from subject/filename. */
function suggestDescription(subject: string, firstFileName: string | null): string {
  const sub = (subject ?? "").trim();
  const name = (firstFileName ?? "").trim();
  if (sub && sub.length <= 120) return sub;
  if (name) return name.replace(/\.[^.]*$/, "").replace(/[-_]+/g, " ").trim().slice(0, 120) || "Email upload";
  return "Email upload";
}

/** Detect expense candidate and optional amount/date from text. */
function suggestExpense(text: string): {
  suggested_expense: boolean;
  suggested_amount: number | null;
  suggested_expense_date: string | null;
  confidence: number;
} {
  const t = lower(text);
  const isReceipt = EXPENSE_KEYWORDS.some((k) => t.includes(k));
  if (!isReceipt) return { suggested_expense: false, suggested_amount: null, suggested_expense_date: null, confidence: 0.2 };

  let amount: number | null = null;
  const amountMatch = text.match(/\$[\s]*(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (amountMatch) {
    amount = parseFloat(amountMatch[1].replace(/,/g, ""));
  }
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return {
    suggested_expense: true,
    suggested_amount: amount,
    suggested_expense_date: dateStr,
    confidence: amount != null ? 0.75 : 0.5,
  };
}

/**
 * Match child first name in text (case-insensitive word boundary).
 * children: [{ id, first_name }]
 */
function matchChild(
  text: string,
  children: { id: string; first_name: string }[]
): { child_id: string; first_name: string } | null {
  const t = lower(text);
  for (const c of children) {
    const name = (c.first_name ?? "").trim().toLowerCase();
    if (!name) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(t)) return { child_id: c.id, first_name: c.first_name };
  }
  return null;
}

export type ClassifyInput = {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  fileNames: string[];
  ocrTextByFile?: Record<string, string>; // optional: filename -> extracted text
  children: { id: string; first_name: string }[];
};

/**
 * Run heuristic classification. Returns suggestions and confidence.
 * Optionally pass ocrTextByFile to include OCR text in classification.
 */
export function classifyInboundUpload(input: ClassifyInput): InboundSuggestion & { suggested_child_id: string | null } {
  const ocrText = input.ocrTextByFile
    ? Object.values(input.ocrTextByFile).join(" ")
    : "";
  const text = extractText(
    input.subject,
    input.bodyText + " " + ocrText,
    input.bodyHtml,
    input.fileNames
  );

  const { value: suggested_category, confidence: catConf } = suggestCategory(text);
  const suggested_visibility = suggestVisibility(suggested_category);
  const suggested_description = suggestDescription(
    input.subject,
    input.fileNames[0] ?? null
  );
  const childMatch = matchChild(text, input.children);
  const expense = suggestExpense(text);

  const confidence =
    (catConf * 0.4) +
    (expense.suggested_expense ? expense.confidence * 0.3 : 0.1) +
    (childMatch ? 0.2 : 0);

  return {
    suggested_category,
    suggested_visibility,
    suggested_description,
    suggested_expense: expense.suggested_expense,
    suggested_amount: expense.suggested_amount,
    suggested_expense_date: expense.suggested_expense_date,
    suggestion_confidence: Math.min(1, Math.round(confidence * 100) / 100),
    matched_child_name: childMatch?.first_name ?? null,
    suggested_child_id: childMatch?.child_id ?? null,
  };
}

/**
 * Extract token from "to" address: uploads+{token}@in.myvowparenting.com
 * Handles "Name <uploads+token@in.myvowparenting.com>" or "uploads+token@in.myvowparenting.com"
 */
export function extractTokenFromTo(to: string): string | null {
  if (!to || typeof to !== "string") return null;
  const match = to.match(/uploads\+([^@\s>]+)@/i);
  return match ? match[1].trim() : null;
}
