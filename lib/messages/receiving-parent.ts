import {
  normalizeMessageEmail,
  type CaseParentAddress,
} from "@/lib/messages/parent-message-visibility";

/**
 * The parent who receives a co-parent message. The sender never receives their own message,
 * and the primary account holds no special claim: the addressee decides.
 */
export type ReceivingParent =
  | { ok: true; userId: string; basis: "address" | "only_other_parent" }
  | { ok: false; reason: "no_other_parent" | "ambiguous"; error: string };

export function resolveReceivingParent(input: {
  /** Null when the sender has no account on this case, for example an invited co-parent. */
  senderId: string | null;
  /** Addresses the message was sent to. May be empty. */
  recipientEmails: (string | null | undefined)[];
  parents: CaseParentAddress[];
}): ReceivingParent {
  const senderId = (input.senderId ?? "").trim();
  const others = input.parents.filter((parent) => {
    const id = parent.userId.trim();
    return id && id !== senderId;
  });
  if (others.length === 0) {
    return { ok: false, reason: "no_other_parent", error: "This case has no other parent with an account." };
  }

  const needles = new Set(input.recipientEmails.map((email) => normalizeMessageEmail(email)).filter(Boolean));
  if (needles.size > 0) {
    const addressed = new Set(
      others
        .filter((parent) => parent.emails.some((email) => needles.has(normalizeMessageEmail(email))))
        .map((parent) => parent.userId.trim())
    );
    if (addressed.size === 1) {
      return { ok: true, userId: [...addressed][0], basis: "address" };
    }
    if (addressed.size > 1) {
      return { ok: false, reason: "ambiguous", error: "More than one parent on this case uses that address." };
    }
  }

  if (others.length === 1) {
    return { ok: true, userId: others[0].userId.trim(), basis: "only_other_parent" };
  }
  return {
    ok: false,
    reason: "ambiguous",
    error: "The message does not name which parent receives it.",
  };
}

/**
 * The address an email goes to. A conversation keeps one co-parent address, taken from whichever
 * parent last received mail, so it can be the sender's own address. The receiving parent's own
 * address is used in that case.
 */
export function receivingAddress(input: {
  conversationEmail: string | null | undefined;
  receiver: CaseParentAddress | null;
  sender: CaseParentAddress | null;
}): string | null {
  const conversation = (input.conversationEmail ?? "").trim();
  const needle = normalizeMessageEmail(conversation);
  const has = (parent: CaseParentAddress | null) =>
    Boolean(needle) && Boolean(parent?.emails.some((email) => normalizeMessageEmail(email) === needle));
  if (!input.receiver) return conversation || null;
  if (has(input.receiver)) return conversation;
  if (!needle || has(input.sender)) return input.receiver.emails.find((email) => email.trim())?.trim() ?? null;
  return conversation;
}
