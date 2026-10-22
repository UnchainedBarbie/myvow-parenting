/**
 * Bounded context for the shadow interpreter only.
 * Turns come from the current parent's session. The production router does not read this.
 */

export const SHADOW_CONTEXT_TURNS = 6;

export type ShadowContextTurn = { role: "parent" | "sage"; text: string };

export type ShadowContextDomain = "none" | "calendar" | "expense" | "document" | "message";

export type ShadowLastIntention = {
  intent: "retrieve";
  domain: Exclude<ShadowContextDomain, "none">;
  criteria: string;
  outcome: "none" | "found" | "unknown";
};

export type ShadowConversation = {
  turns: ShadowContextTurn[];
  last_intention: ShadowLastIntention | null;
  this_turn: "repeat" | "new" | "ambiguous" | "continue";
  /** repeat and ambiguous follow the conversation. A new request or a direct answer does not. */
  prefer: "conversation" | "message";
};

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const PATH = /(?:^|\s)[\w.-]+(?:\/[\w.-]+)+(?:\.\w+)?/g;

const REPEAT =
  /^(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:check again|try again|try once more|look again|search again|what about now|how about now|one more time|do that again)\??$/i;

const AMBIGUOUS =
  /^(?:what about (?:that(?: one)?|it|those|the other one)|that one|the other one|which one|the same one)\??$/i;

export function shadowTurnsFromJournal(
  rows: { role?: string | null; content?: string | null }[],
  currentMessage: string
): ShadowContextTurn[] {
  const turns: ShadowContextTurn[] = [];
  for (const row of rows) {
    const role = row.role === "sage" ? "sage" : row.role === "user" || row.role === "parent" ? "parent" : null;
    if (!role) continue;
    const text = scrub(row.content ?? "");
    if (!text) continue;
    turns.push({ role, text: text.slice(0, 240) });
  }
  const current = scrub(currentMessage);
  const last = turns[turns.length - 1];
  if (last?.role === "parent" && current && last.text.toLowerCase() === current.toLowerCase()) {
    turns.pop();
  }
  return turns.slice(-SHADOW_CONTEXT_TURNS);
}

export function buildShadowConversation(
  turns: ShadowContextTurn[],
  currentMessage: string
): ShadowConversation {
  const window = turns.slice(-SHADOW_CONTEXT_TURNS);
  const last = lastRetrieval(window);
  const current = scrub(currentMessage);
  const thisTurn = classifyTurn(current, last);
  return {
    turns: window,
    last_intention: last,
    this_turn: thisTurn,
    prefer: thisTurn === "repeat" || thisTurn === "ambiguous" ? "conversation" : "message",
  };
}

function classifyTurn(message: string, last: ShadowLastIntention | null): ShadowConversation["this_turn"] {
  if (!message) return "continue";
  if (AMBIGUOUS.test(message)) return "ambiguous";
  if (REPEAT.test(message)) return last ? "repeat" : "ambiguous";
  const hinted = domainOf(message);
  if (hinted && isExplicitRequest(message)) return "new";
  return "continue";
}

function lastRetrieval(turns: ShadowContextTurn[]): ShadowLastIntention | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role !== "parent") continue;
    if (REPEAT.test(turn.text) || AMBIGUOUS.test(turn.text)) continue;
    const domain = domainOf(turn.text);
    if (!domain || !isRetrieval(turn.text)) continue;
    const following = turns.slice(index + 1).find((later) => later.role === "sage");
    return {
      intent: "retrieve",
      domain,
      criteria: criteriaFrom(turn.text),
      outcome: outcomeFrom(following?.text ?? ""),
    };
  }
  return null;
}

function isRetrieval(text: string): boolean {
  return /\b(pull up|find|show|where is|where's|look up|check for|search for|most recent|latest|what(?:'s| is) on|any events|which events|what did i pay|did i pay)\b/i.test(text);
}

function isExplicitRequest(text: string): boolean {
  return /\b(pull up|find|show|where is|where's|look up|add|log|schedule|book|create|update|change|send|draft|file|put)\b/i.test(text);
}

function domainOf(text: string): ShadowLastIntention["domain"] | null {
  if (/\b(evaluation|eval|document|report|paperwork|file)\b/i.test(text)) return "document";
  if (/\b(expense|expenses|receipt|reimburse|paid|payment|pay)\b/i.test(text)) return "expense";
  if (/\b(message|text|email)\b/i.test(text) && /\b(co-?parent|send|draft|him|her)\b/i.test(text)) return "message";
  if (/\b(calendar|appointment|schedule)\b/i.test(text)) return "calendar";
  return null;
}

function criteriaFrom(text: string): string {
  const stripped = text
    .replace(/^(?:can|could|would)\s+you\s+/i, "")
    .replace(/^(?:please\s+)?(?:pull up|find|show me|show|look up|search for|check for)\s+/i, "")
    .replace(/\?+$/g, "")
    .trim();
  return (stripped || text).slice(0, 160);
}

function outcomeFrom(reply: string): ShadowLastIntention["outcome"] {
  if (!reply) return "unknown";
  if (/\b(couldn'?t find|could not find|no matching|don'?t see|do not see|nothing saved|no results|no saved)\b/i.test(reply)) {
    return "none";
  }
  if (/\b(i found|here(?:'|’)s|here is|this is the|matches)\b/i.test(reply)) return "found";
  return "unknown";
}

function scrub(value: string): string {
  return value
    .replace(EMAIL, "")
    .replace(UUID, "")
    .replace(PATH, " ")
    .replace(/\s+/g, " ")
    .trim();
}
