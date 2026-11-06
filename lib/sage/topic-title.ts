const BANNED = new Set([
  "request",
  "requests",
  "reminder",
  "reminders",
  "remind",
  "inquiry",
  "inquiries",
  "confirmation",
  "confirmations",
  "confirm",
  "confirmed",
  "confirming",
]);

const FILLER = new Set([
  "a",
  "an",
  "the",
  "about",
  "to",
  "for",
  "please",
  "my",
  "our",
  "of",
  "and",
  "on",
  "at",
  "with",
  "from",
  "your",
  "you",
]);

/**
 * A topic label of two to four words. Names are dropped when other topic words
 * remain, so a name stays only when it is the subject.
 */
export function shapeTopicTitle(raw: string, names: string[] = []): string {
  const omitted = new Set(
    names
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 1)
  );
  const words = raw
    .replace(/["']/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0 && !BANNED.has(word) && !FILLER.has(word));

  const withoutNames = words.filter((word) => !omitted.has(word));
  const chosen = (withoutNames.length > 0 ? withoutNames : words).slice(0, 4);
  if (chosen.length === 0) return "";
  return chosen
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}
