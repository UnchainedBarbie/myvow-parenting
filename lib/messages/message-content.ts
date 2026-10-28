import { isInsultOnly } from "@/lib/messages/outbound-review";

/**
 * Where the text of a message card came from.
 *   parent_text   The parent's own words, kept exactly as typed.
 *   sage_wording  Wording Sage composed or recommended.
 * A card without a value predates this field. It is shown without a claim about its author.
 */
export type DraftOrigin = "parent_text" | "sage_wording";

export function isDraftOrigin(value: unknown): value is DraftOrigin {
  return value === "parent_text" || value === "sage_wording";
}

/**
 * True when text carries something a co-parent could read as a message: a request, a fact,
 * a question, or a boundary. Text made only of insults and connecting words, or text with no
 * words at all, carries none. The test is the one the outbound review applies at send time,
 * so chat and review agree about what counts as a message.
 */
export function hasMessageSubstance(text: string): boolean {
  const trimmed = text.trim();
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return false;
  return !isInsultOnly(trimmed);
}

/**
 * The line a card shows above message text so the parent knows whose words they are.
 * A revised text is what the card displays, and Sage wrote the revision, so it is Sage's.
 */
export function draftOriginLabel(card: { draft_origin?: unknown; revised_text?: unknown }): string | null {
  if (typeof card.revised_text === "string" && card.revised_text.trim()) return "Sage's draft";
  if (card.draft_origin === "parent_text") return "Your wording";
  if (card.draft_origin === "sage_wording") return "Sage's draft";
  return null;
}

/** Heading above a list of cards. Sage suggests only what Sage wrote or proposed. */
export function proposalListHeading(
  cards: { type?: string | null; draft_origin?: unknown; revised_text?: unknown }[]
): string {
  if (
    cards.length > 0 &&
    cards.every((c) => c.type === "reply_coparent" && draftOriginLabel(c) === "Your wording")
  ) {
    return "Your message";
  }
  return "Sage suggests";
}
