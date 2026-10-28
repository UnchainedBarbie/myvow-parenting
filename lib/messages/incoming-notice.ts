/**
 * The basic notice a receiving parent sees for a saved co-parent message.
 * The notice carries a reference to its message, so a retry finds it instead of adding a second one.
 * It lives in the existing parent_notifications list, the same way calendar notices carry an event reference.
 */

const MESSAGE_REF = /\n\[\[coparent-message:([A-Za-z0-9_-]{1,80})\]\]\s*$/;

export function safeMessageId(messageId: string | null | undefined): string | null {
  const id = (messageId ?? "").trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null;
}

export function withMessageRef(message: string, messageId: string): string {
  const id = safeMessageId(messageId);
  return id ? `${message}\n[[coparent-message:${id}]]` : message;
}

export function readMessageRef(message: string): { text: string; messageId: string | null } {
  const match = message.match(MESSAGE_REF);
  if (!match || match.index == null) return { text: message.trim(), messageId: null };
  return { text: message.slice(0, match.index).trim(), messageId: match[1] };
}

/** LIKE pattern that finds the notice for one message. */
export function messageRefPattern(messageId: string): string | null {
  const id = safeMessageId(messageId);
  return id ? `%[[coparent-message:${id}]]%` : null;
}

export function messageNoticeHref(conversationId: string | null | undefined): string | null {
  const id = (conversationId ?? "").trim();
  return id ? `/messages?conversation_id=${encodeURIComponent(id)}` : null;
}
