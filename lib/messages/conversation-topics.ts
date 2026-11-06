/** Topics accepted when a conversation is created or retagged. */
export const CONVERSATION_TOPICS = [
  "Medical",
  "School",
  "Schedule",
  "Expenses",
  "General",
  "Emergency",
] as const;

export type ConversationTopic = (typeof CONVERSATION_TOPICS)[number];

export const ALLOWED_TOPICS = new Set<string>(CONVERSATION_TOPICS);

export function isConversationTopic(value: string): value is ConversationTopic {
  return ALLOWED_TOPICS.has(value);
}
