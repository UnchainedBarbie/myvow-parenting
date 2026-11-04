/**
 * Older parent-authored turns that the recent window dropped.
 *
 * Relevance is overlap with the current discussion. Sage's own earlier drafts are not included.
 * A turn that does not share the discussion is left out, so the whole session is not reloaded.
 */

const GENERIC = new Set([
  "about",
  "again",
  "already",
  "based",
  "could",
  "discuss",
  "discussed",
  "discussion",
  "draft",
  "message",
  "parent",
  "please",
  "should",
  "their",
  "there",
  "these",
  "those",
  "would",
  "write",
  "written",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 5 && !GENERIC.has(word));
}

export function recoverParentContext(opts: {
  recentTurns: { role: string; text: string }[];
  olderParentTurns: string[];
  request: string;
  budget?: number;
}): string[] {
  const budget = opts.budget ?? 3500;
  const focus = new Set<string>();
  for (const turn of opts.recentTurns) {
    if (turn.role === "sage") continue;
    for (const word of tokens(turn.text)) focus.add(word);
  }
  for (const word of tokens(opts.request)) focus.add(word);
  const ranked = opts.olderParentTurns
    .map((text) => {
      const body = text.trim();
      const words = tokens(body);
      let score = 0;
      for (const word of words) {
        if (focus.has(word)) score += word.length >= 8 ? 2 : 1;
      }
      return { text: body, score };
    })
    .filter((row) => row.text.length > 0 && row.score > 0)
    .sort((a, b) => b.score - a.score);
  const chosen: string[] = [];
  let used = 0;
  for (const row of ranked) {
    if (used + row.text.length > budget) continue;
    chosen.push(row.text);
    used += row.text.length;
    if (chosen.length >= 8) break;
  }
  return chosen;
}
