/**
 * Sage Engine — Understanding layer.
 * Pure language interpretation: NormalizedEvent in, SageInterpretation out.
 * No database, tools, or side effects.
 */

const SAGE_MODEL = "claude-sonnet-4-6";

export type NormalizedEvent = {
  source_type: string;
  source_id: string | null;
  case_id: string;
  sender: string;
  text: string;
  attachments?: { filename: string; text?: string }[];
};

export type SageInterpretation = {
  intent: {
    item_type: string;
    domain: string;
    summary: string;
    evidence_excerpt: string;
    tool_name: string | null;
    action_required: boolean;
    action_type: string | null;
    urgency: string;
    confidence: number;
  };
  entities: {
    children: { name: string; confidence: number }[];
    people: { name: string; confidence: number }[];
    dates: { value: string; raw: string }[];
    amounts: { value: number; currency: string }[];
    merchants: { name: string }[];
    providers: { name: string }[];
    documents: { name: string }[];
  };
  reasoning: {
    signals: string[];
  };
};

const SYSTEM_PROMPT = `You are Sage's Understanding layer for MyVow Parenting — a calm co-parenting platform.

Your job is to read incoming language (messages, emails, document excerpts) and return structured intent and entities. You interpret only. You do NOT resolve database IDs, call tools, send messages, or take actions.

You are NOT making decisions. You are NOT changing family state. You are NOT communicating with either parent. You ONLY produce a structured understanding of the input for downstream systems.

Tone and framing rules:
- Write summaries in calm, neutral, non-adversarial language. Never shame, alarm, or escalate.
- Refer to the other parent as "Co-Parent" — never use their name or email, even if provided.
- Be suggestive and helpful, never authoritarian or commanding.
- Do not use words like "conflict"; prefer "communication" when relevant.
- evidence_excerpt must be a tiny verbatim snippet from the input (10 words or fewer) that anchors your read — NOT the full message.

Classification:
- item_type: one of schedule_change | needs_response | information_only | calendar_update | expense | document_summary | medical_update | school_update | concern | agreement | dispute | emergency | needs_review
- domain: one of calendar | school | medical | expense | legal | general
- tool_name: calendar | expense | document | court | messaging | null — the downstream tool that genuinely needs to run, or null when none does. Set null whenever action_required is false (e.g. information_only awareness updates). Use "messaging" ONLY when an item actually requires sending a message — not for FYI items that need no tool action.
- action_required: true if the parent likely needs to do something
- action_type: approve | acknowledge | review | respond | pay | archive | null
- urgency: low | normal | high | emergency
- confidence: 0.0–1.0 how sure you are of item_type and domain

reasoning.signals: short observable rationale strings for the classification (audit trail, NOT chain-of-thought). Examples: "detected a request to modify pickup time", "dentist mention explains the reason", "expense amount present with receipt reference".

Entities — extract names and values only, NEVER database IDs:
- children: child first names mentioned
- people: other people mentioned (not Co-Parent label)
- dates: value as ISO YYYY-MM-DD when possible, raw as written
- amounts: numeric value and currency code (default USD)
- merchants, providers, documents: names only

If you are uncertain (confidence would be below 0.7), set item_type to "needs_review".

Respond with ONLY valid JSON matching this exact shape — no markdown, no preamble, no code fences:
{
  "intent": {
    "item_type": "string",
    "domain": "string",
    "summary": "string",
    "evidence_excerpt": "string",
    "tool_name": "string or null",
    "action_required": boolean,
    "action_type": "string or null",
    "urgency": "string",
    "confidence": number
  },
  "entities": {
    "children": [{ "name": "string", "confidence": number }],
    "people": [{ "name": "string", "confidence": number }],
    "dates": [{ "value": "string", "raw": "string" }],
    "amounts": [{ "value": number, "currency": "string" }],
    "merchants": [{ "name": "string" }],
    "providers": [{ "name": "string" }],
    "documents": [{ "name": "string" }]
  },
  "reasoning": {
    "signals": ["string"]
  }
}`;

const ITEM_TYPES = new Set([
  "schedule_change",
  "needs_response",
  "information_only",
  "calendar_update",
  "expense",
  "document_summary",
  "medical_update",
  "school_update",
  "concern",
  "agreement",
  "dispute",
  "emergency",
  "needs_review",
]);

const DOMAINS = new Set(["calendar", "school", "medical", "expense", "legal", "general"]);

const TOOL_NAMES = new Set(["calendar", "expense", "document", "court", "messaging"]);

const ACTION_TYPES = new Set(["approve", "acknowledge", "review", "respond", "pay", "archive"]);

const URGENCIES = new Set(["low", "normal", "high", "emergency"]);

function clampConfidence(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asNullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = asString(v);
  return s.length > 0 ? s : null;
}

function buildUserPrompt(event: NormalizedEvent): string {
  const attachmentBlocks =
    event.attachments && event.attachments.length > 0
      ? event.attachments
          .map((a) => {
            const parts = [`Filename: ${a.filename}`];
            if (a.text?.trim()) {
              parts.push(`Extracted text:\n${a.text.trim().slice(0, 4000)}`);
            }
            return parts.join("\n");
          })
          .join("\n\n---\n\n")
      : "(none)";

  return `Interpret this co-parenting input.

Source type: ${event.source_type}
Source id: ${event.source_id ?? "(none)"}
Case id: ${event.case_id}
Sender identity (for context only — refer to them as Co-Parent in output): ${event.sender}

Message / body:
${event.text.trim() || "(empty)"}

Attachments:
${attachmentBlocks}`;
}

function emptyEntities(): SageInterpretation["entities"] {
  return {
    children: [],
    people: [],
    dates: [],
    amounts: [],
    merchants: [],
    providers: [],
    documents: [],
  };
}

export function createNeedsReviewFallback(summary?: string): SageInterpretation {
  return {
    intent: {
      item_type: "needs_review",
      domain: "general",
      summary:
        summary ??
        "Sage could not confidently read this item yet — a quick review may help.",
      evidence_excerpt: "",
      tool_name: null,
      action_required: true,
      action_type: "review",
      urgency: "normal",
      confidence: 0,
    },
    entities: emptyEntities(),
    reasoning: { signals: [] },
  };
}

function parseNamedConfidenceList(raw: unknown): { name: string; confidence: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { name: string; confidence: number }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const name = asString(obj.name);
    if (!name) continue;
    out.push({ name, confidence: clampConfidence(obj.confidence) });
  }
  return out;
}

function parseDates(raw: unknown): { value: string; raw: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { value: string; raw: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const rawText = asString(obj.raw);
    const value = asString(obj.value);
    if (!rawText && !value) continue;
    out.push({ value, raw: rawText || value });
  }
  return out;
}

function parseAmounts(raw: unknown): { value: number; currency: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { value: number; currency: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const value = typeof obj.value === "number" && !Number.isNaN(obj.value) ? obj.value : null;
    if (value === null) continue;
    const currency = asString(obj.currency, "USD").toUpperCase() || "USD";
    out.push({ value, currency });
  }
  return out;
}

function parseNameList(raw: unknown): { name: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { name: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = asString((item as Record<string, unknown>).name);
    if (name) out.push({ name });
  }
  return out;
}

function parseSignals(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const signals = (raw as Record<string, unknown>).signals;
  if (!Array.isArray(signals)) return [];
  return signals
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
}

function parseInterpretation(raw: string): SageInterpretation | null {
  if (!raw.trim()) return null;
  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/^```json?\s*|\s*```$/g, "").trim();
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch (e) {
    console.error("[sage/understanding] JSON parse failed:", e);
    return null;
  }

  const intentRaw =
    parsed.intent && typeof parsed.intent === "object"
      ? (parsed.intent as Record<string, unknown>)
      : null;
  const entitiesRaw =
    parsed.entities && typeof parsed.entities === "object"
      ? (parsed.entities as Record<string, unknown>)
      : null;
  const reasoningRaw =
    parsed.reasoning && typeof parsed.reasoning === "object"
      ? parsed.reasoning
      : null;

  if (!intentRaw || !entitiesRaw) return null;

  let confidence = clampConfidence(intentRaw.confidence);
  let itemType = asString(intentRaw.item_type, "needs_review");
  if (!ITEM_TYPES.has(itemType)) itemType = "needs_review";
  if (confidence < 0.7) itemType = "needs_review";

  let domain = asString(intentRaw.domain, "general");
  if (!DOMAINS.has(domain)) domain = "general";

  let toolName = asNullableString(intentRaw.tool_name);
  if (toolName && !TOOL_NAMES.has(toolName)) toolName = null;

  let actionType = asNullableString(intentRaw.action_type);
  if (actionType && !ACTION_TYPES.has(actionType)) actionType = null;

  const actionRequired = asBool(intentRaw.action_required);
  if (!actionRequired) toolName = null;

  let urgency = asString(intentRaw.urgency, "normal");
  if (!URGENCIES.has(urgency)) urgency = "normal";

  let evidenceExcerpt = asString(intentRaw.evidence_excerpt);
  const words = evidenceExcerpt.split(/\s+/).filter(Boolean);
  if (words.length > 10) {
    evidenceExcerpt = words.slice(0, 10).join(" ");
  }

  return {
    intent: {
      item_type: itemType,
      domain,
      summary: asString(
        intentRaw.summary,
        "Sage noted something that may be worth a calm look when you have a moment."
      ),
      evidence_excerpt: evidenceExcerpt,
      tool_name: toolName,
      action_required: actionRequired,
      action_type: actionType,
      urgency,
      confidence,
    },
    entities: {
      children: parseNamedConfidenceList(entitiesRaw.children),
      people: parseNamedConfidenceList(entitiesRaw.people),
      dates: parseDates(entitiesRaw.dates),
      amounts: parseAmounts(entitiesRaw.amounts),
      merchants: parseNameList(entitiesRaw.merchants),
      providers: parseNameList(entitiesRaw.providers),
      documents: parseNameList(entitiesRaw.documents),
    },
    reasoning: {
      signals: parseSignals(reasoningRaw),
    },
  };
}

async function callAnthropic(userPrompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[sage/understanding] ANTHROPIC_API_KEY not configured");
    return null;
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: SAGE_MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[sage/understanding] Anthropic API error:", res.status, errBody);
      return null;
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return data.content?.find((c) => c.type === "text")?.text?.trim() ?? null;
  } catch (e) {
    console.error("[sage/understanding] Anthropic request failed:", e);
    return null;
  }
}

/**
 * Read raw language and return structured intent + entities.
 */
export async function interpret(event: NormalizedEvent): Promise<SageInterpretation> {
  const userPrompt = buildUserPrompt(event);
  const raw = await callAnthropic(userPrompt);
  if (!raw) {
    return createNeedsReviewFallback();
  }

  const interpretation = parseInterpretation(raw);
  if (!interpretation) {
    return createNeedsReviewFallback();
  }

  return interpretation;
}
