/**
 * One approval of one final text is one send attempt. The attempt id travels with every retry of
 * that approval, so a retry returns the saved message. A new approval gets a new id, so two
 * intentional sends of identical text stay possible.
 */

export type SendAttempt = { id: string; text: string };

export function newSendAttemptId(): string {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === "function") webCrypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The attempt for this approval. A retry of the same final text keeps the id. Different text is a
 * different approval and gets a new id.
 */
export function nextSendAttempt(
  current: SendAttempt | null,
  finalText: string,
  makeId: () => string = newSendAttemptId
): SendAttempt {
  const text = finalText.replace(/\r\n/g, "\n").trim();
  if (current && current.text === text) return current;
  return { id: makeId(), text };
}

const ATTEMPT_ID = /^[A-Za-z0-9_-]{16,100}$/;

/** The id as the server accepts it, or null. */
export function validSendAttemptId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return ATTEMPT_ID.test(id) ? id : null;
}
