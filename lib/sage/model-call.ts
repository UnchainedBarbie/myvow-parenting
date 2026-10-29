/**
 * One text completion from the model provider Sage already uses.
 * The request carries no tools. It returns text only, and null when no key is set or the call fails.
 */

export const MODEL = "claude-sonnet-4-6";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT_MS = 15_000;

export type FetchLike = typeof fetch;

export type CompleteDeps = { fetchImpl?: FetchLike; apiKey?: string; timeoutMs?: number };

export async function completeText(body: Record<string, unknown>, deps: CompleteDeps = {}): Promise<string | null> {
  const apiKey = (deps.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await (deps.fetchImpl ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((part) => part.type === "text")?.text ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
