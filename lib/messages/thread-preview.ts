/** The text a message bubble shows. Presentation only; stored columns are unchanged. */
export function messagePreviewBody(message: {
  original_content?: string | null;
  ai_rewritten_content?: string | null;
}): string {
  return (message.ai_rewritten_content ?? message.original_content ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Sidebar snippet for a thread. The latest message wins, ordered by created_at
 * and then id, so an older reply cannot stay in the row after a later message.
 */
export function latestThreadPreview(
  messages: Array<{
    id: string;
    created_at: string;
    original_content?: string | null;
    ai_rewritten_content?: string | null;
  }>
): { preview: string; created_at: string | null } {
  let latest: (typeof messages)[number] | null = null;
  for (const message of messages) {
    if (
      !latest ||
      message.created_at > latest.created_at ||
      (message.created_at === latest.created_at && message.id > latest.id)
    ) {
      latest = message;
    }
  }
  if (!latest) return { preview: "", created_at: null };
  return { preview: messagePreviewBody(latest), created_at: latest.created_at };
}
