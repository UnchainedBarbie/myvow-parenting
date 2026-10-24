/**
 * Who can see a parent-to-parent message, and which side of the thread it is on.
 * The saved row stays one shared record. Direction on screen follows the viewer.
 * Email acceptance is a separate delivery_status and is not decided here.
 */

export type CaseParentAddress = {
  userId: string;
  emails: string[];
};

export type SharedConversationChoice = {
  id: string;
  coparentEmail: string | null;
  subject: string | null;
};

export function normalizeMessageEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function resolveCaseRecipient(input: {
  senderId: string;
  recipientEmail: string;
  parents: CaseParentAddress[];
}): { userId: string } | { error: string } {
  const needle = normalizeMessageEmail(input.recipientEmail);
  if (!needle) return { error: "Add a recipient email before sending." };
  const senderId = input.senderId.trim();
  const others = input.parents.filter((parent) => parent.userId.trim() && parent.userId.trim() !== senderId);
  const matches = others.filter((parent) =>
    parent.emails.some((email) => normalizeMessageEmail(email) === needle)
  );
  if (matches.length === 1) return { userId: matches[0].userId.trim() };
  const self = input.parents.find(
    (parent) =>
      parent.userId.trim() === senderId &&
      parent.emails.some((email) => normalizeMessageEmail(email) === needle)
  );
  if (self) return { error: "That address belongs to you. Choose your co-parent." };
  if (matches.length === 0) return { error: "That address is not a parent on this case." };
  return { error: "More than one parent on this case uses that address." };
}

function subjectKey(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(re|fw|fwd)\s*:\s*/i, "")
    .trim();
}

/**
 * A conversation stores one co-parent address, from whichever parent last received mail.
 * Match either parent's address so a reply in the other direction stays on the same thread.
 */
export function chooseSharedConversation(input: {
  conversations: SharedConversationChoice[];
  recipientEmail: string;
  senderEmails: string[];
  subject?: string | null;
}): string | null {
  const needles = new Set(
    [input.recipientEmail, ...input.senderEmails].map((email) => normalizeMessageEmail(email)).filter(Boolean)
  );
  const matches = input.conversations.filter((row) =>
    needles.has(normalizeMessageEmail(row.coparentEmail))
  );
  if (matches.length === 0) return null;
  const wanted = subjectKey(input.subject);
  if (wanted) {
    const subjectHit = matches.find((row) => subjectKey(row.subject) === wanted);
    if (subjectHit) return subjectHit.id;
  }
  return matches[0]?.id ?? null;
}

export function presentMessageForViewer(
  message: {
    sender_id?: string | null;
    direction?: string | null;
    delivery_status?: string | null;
    delivered_at?: string | null;
  },
  viewerId: string
): { show: boolean; direction: "incoming" | "outgoing" } {
  const senderId = (message.sender_id ?? "").trim();
  const viewer = viewerId.trim();
  const stored = (message.direction ?? "").trim().toLowerCase();
  const direction: "incoming" | "outgoing" =
    senderId && viewer && senderId === viewer
      ? "outgoing"
      : senderId && viewer && senderId !== viewer
        ? "incoming"
        : stored === "outgoing"
          ? "outgoing"
          : "incoming";
  if (direction === "outgoing") return { show: true, direction };
  const status = (message.delivery_status ?? "").trim().toLowerCase();
  if (status === "buffered" || status === "pending") return { show: false, direction };
  if (
    status === "sent" ||
    status === "email_accepted" ||
    status === "delivered" ||
    message.delivered_at
  ) {
    return { show: true, direction };
  }
  if (stored === "incoming" && !status) return { show: false, direction };
  return { show: Boolean(message.delivered_at), direction };
}

/**
 * Three different facts. Postmark accepting the API call is not mailbox delivery.
 * "delivered" counts only when a delivery time was stored with that status.
 */
export type ParentDeliveryKind = "saved" | "email_accepted" | "delivered";

export function parentDeliveryKind(input: {
  deliveryStatus?: string | null;
  deliveredAt?: string | null;
}): ParentDeliveryKind {
  const status = (input.deliveryStatus ?? "").trim().toLowerCase();
  const deliveredAt = (input.deliveredAt ?? "").trim();
  if (status === "delivered" && deliveredAt) return "delivered";
  if (status === "email_accepted") return "email_accepted";
  return "saved";
}

export function parentDeliveryLabel(kind: ParentDeliveryKind): string {
  if (kind === "delivered") return "Delivered";
  if (kind === "email_accepted") return "Email accepted";
  return "Saved in Messages";
}

export function parentProposalStatusMark(input: {
  deliveryStatus?: string | null;
  deliveredAt?: string | null;
}): string {
  const kind = parentDeliveryKind(input);
  if (kind === "delivered") return "✓ delivered";
  if (kind === "email_accepted") return "✓ email accepted";
  return "✓ saved in Messages";
}

export type UnassignedParentMessage = {
  caseId: string | null;
  senderId: string | null;
  recipientEmail: string | null;
  direction: string | null;
  senderExternalEmail?: string | null;
  intakeBranch?: string | null;
};

export type RepairConversation = {
  id: string;
  caseId: string;
  coparentEmail: string | null;
};

/**
 * Link an orphan only when this case, its sender, its recipient, and one existing
 * shared conversation all agree. A missing recipient is not filled in from
 * "the other parent." No conversation is created here.
 */
export function unassignedParentRepair(input: {
  message: UnassignedParentMessage;
  caseId: string;
  parents: CaseParentAddress[];
  conversations: RepairConversation[];
}): { conversationId: string; recipientUserId: string } | null {
  const caseId = input.caseId.trim();
  const messageCaseId = (input.message.caseId ?? "").trim();
  if (!caseId || messageCaseId !== caseId) return null;
  if ((input.message.direction ?? "").trim().toLowerCase() !== "outgoing") return null;
  const branch = (input.message.intakeBranch ?? "").trim().toLowerCase();
  if (branch) return null;
  const senderId = (input.message.senderId ?? "").trim();
  const sender = input.parents.find((parent) => parent.userId.trim() === senderId);
  if (!sender) return null;
  const external = normalizeMessageEmail(input.message.senderExternalEmail);
  if (external && !sender.emails.some((email) => normalizeMessageEmail(email) === external)) {
    return null;
  }
  const recipientEmail = (input.message.recipientEmail ?? "").trim();
  if (!recipientEmail) return null;
  const resolved = resolveCaseRecipient({
    senderId,
    recipientEmail,
    parents: input.parents,
  });
  if ("error" in resolved) return null;
  const recipient = input.parents.find((parent) => parent.userId.trim() === resolved.userId);
  const needles = new Set(
    [...sender.emails, ...(recipient?.emails ?? []), recipientEmail]
      .map((email) => normalizeMessageEmail(email))
      .filter(Boolean)
  );
  const matches = input.conversations.filter(
    (row) => row.caseId.trim() === caseId && needles.has(normalizeMessageEmail(row.coparentEmail))
  );
  if (matches.length !== 1) return null;
  return { conversationId: matches[0].id, recipientUserId: resolved.userId };
}

export function incomingNoticeCopy(senderName: string | null | undefined): string {
  const name = (senderName ?? "").trim() || "Your co-parent";
  return `${name} sent you a message. It is saved in Messages.`;
}
