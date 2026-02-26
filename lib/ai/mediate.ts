/**
 * Claude API integration for message mediation.
 * Uses Anthropic API; set ANTHROPIC_API_KEY in env.
 */

export type AiClassification =
  | "neutral"
  | "escalatory"
  | "manipulative"
  | "threatening"
  | "coercive";

export type MediationResult = {
  ai_classification: AiClassification;
  ai_confidence_score: number;
  emotional_intensity_score: number;
  ai_rewritten_content: string;
  flags: Array<{ flag_type: string; description: string; confidence: number }>;
  category?: string;
  sub_category?: string;
};

/**
 * Rewrite user intent into calm, neutral, child-focused text.
 * Returns only the rewritten string for outbound draft flow.
 */
export async function rewriteOutboundIntent(intent: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return intent;
  }
  const { REWRITE_OUTBOUND_SYSTEM_PROMPT } = await import("./prompts");
  const res = await fetch(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: REWRITE_OUTBOUND_SYSTEM_PROMPT,
        messages: [{ role: "user", content: intent }],
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || "Anthropic API error");
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text =
    data.content?.find((c) => c.type === "text")?.text?.trim() ?? intent;
  return text;
}

/**
 * Process incoming message: classify, rewrite, and return flags.
 * Used by /api/messages/ingest and full mediation pipeline.
 */
export async function mediateIncomingMessage(
  rawContent: string,
  _context?: string
): Promise<MediationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ai_classification: "neutral",
      ai_confidence_score: 0,
      emotional_intensity_score: 0,
      ai_rewritten_content: rawContent,
      flags: [],
    };
  }
  const { MEDIATION_SYSTEM_PROMPT } = await import("./prompts");
  const userPrompt = `Analyze this message and respond with a single JSON object (no markdown) with keys: ai_classification (one of: neutral, escalatory, manipulative, threatening, coercive), ai_confidence_score (0-1), emotional_intensity_score (0-1), ai_rewritten_content (de-escalated version), flags (array of { flag_type, description, confidence }). Category and sub_category optional.

Message to analyze:
${rawContent}`;
  const res = await fetch(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: MEDIATION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || "Anthropic API error");
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === "text")?.text ?? "{}";
  const parsed = JSON.parse(text.replace(/^```json?\s*|\s*```$/g, "")) as MediationResult;
  return parsed;
}
