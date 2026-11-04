/**
 * How Sage speaks about the two parents.
 * The account holder is the parent Sage is talking with.
 * The other parent is whoever else is a parent on the same case.
 * Names are not an input, and nothing here rewrites stored text.
 */

export const YOUR_CO_PARENT = "your co-parent";
export const YOUR_CO_PARENTS = "your co-parents";
export const INCOMING_MESSAGE_LABEL = "Message from your co-parent";
export const OUTGOING_MESSAGE_LABEL = "Your message to your co-parent";

export type ParentMembership = { userId: string };

/** Other parents on the case, by membership id, excluding the signed-in account. */
export function otherParentsOnCase(viewerId: string, parents: ParentMembership[]): ParentMembership[] {
  const viewer = viewerId.trim();
  const seen = new Set<string>();
  const others: ParentMembership[] = [];
  for (const parent of parents) {
    const id = parent.userId.trim();
    if (!id || id === viewer || seen.has(id)) continue;
    seen.add(id);
    others.push({ userId: id });
  }
  return others;
}

/** Phrase for Sage's own sentences. Null when the case has no other parent. */
export function otherParentPhrase(otherParentCount: number): typeof YOUR_CO_PARENT | typeof YOUR_CO_PARENTS | null {
  if (otherParentCount === 1) return YOUR_CO_PARENT;
  if (otherParentCount > 1) return YOUR_CO_PARENTS;
  return null;
}

export function messageRelationshipLabel(direction: "incoming" | "outgoing"): string {
  return direction === "incoming" ? INCOMING_MESSAGE_LABEL : OUTGOING_MESSAGE_LABEL;
}

/** Notice and journal line for a message the other parent sent. The sender's name is not included. */
export function incomingNoticeSentence(): string {
  return `${INCOMING_MESSAGE_LABEL}. It is saved in Messages.`;
}

/** Prompt lines. The count is other parents already resolved from case membership. */
export function relationshipVoiceLines(otherParentCount: number): string[] {
  const lines = ["The parent you are speaking with holds this account. Refer to them as you or your."];
  const other = otherParentPhrase(otherParentCount);
  if (other === YOUR_CO_PARENT) {
    lines.push("The other parent on this case is their co-parent. Refer to that person as your co-parent.");
  } else if (other === YOUR_CO_PARENTS) {
    lines.push(
      "More than one other parent is on this case. Refer to them as your co-parents, without using an account name to tell them apart."
    );
  } else {
    lines.push("No other parent is on this case.");
  }
  lines.push("Do not use an account display name for either parent in your own wording.");
  return lines;
}
