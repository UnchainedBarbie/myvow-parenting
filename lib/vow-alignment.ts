/**
 * Vow alignment: hybrid deterministic + optional LLM.
 * Layer 1: deterministic markers (hard fail → off_vow; negative/positive adjust score).
 * Layer 2: LLM classification can be hooked here (return score, label, reasons).
 * Layer 3: reconciliation — hard fail overrides downward; else map score to aligned/at_risk/off_vow.
 */

export type VowAlignmentLabel = "aligned" | "at_risk" | "off_vow";

export type VowAlignmentResult = {
  score0to1: number;
  label: VowAlignmentLabel;
  reasons: string[];
};

const HARD_FAIL_PATTERNS = [
  /\b(fuck|shit|bitch|asshole|idiot|stupid)\b/i,
  /\b(kill you|take the kids away|call cps|call the police on you)\b/i,
  /\b(threaten|threatening)\b/i,
];

const NEGATIVE_PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /\b(always|never)\b/i, reason: "Absolutes detected (always/never)" },
  { regex: /\b(you lied|you are lying|you lie)\b/i, reason: "Direct blame language detected" },
  { regex: /\b(you never listen|you don't care|whatever)\b/i, reason: "Dismissive phrasing" },
  { regex: /!{3,}/, reason: "Excessive punctuation" },
  { regex: /[A-Z]{6,}/, reason: "Excessive ALL CAPS" },
];

const POSITIVE_PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /\b(for|about) (our )?(son|daughter|kid|child|children|avery|avery|kyle)\b/i, reason: "Child‑centered framing" },
  { regex: /\b(can we|could we|would you|please)\b/i, reason: "Neutral request language" },
  { regex: /\b(I propose|I suggest|what if we)\b/i, reason: "Collaborative framing" },
  { regex: /\b(I am not available for|I will communicate via)\b/i, reason: "Boundary stated calmly" },
];

export function evaluateVowAlignment(input: {
  vowText: string;
  messageText: string;
}): VowAlignmentResult {
  const text = input.messageText || "";
  const reasons = new Set<string>();

  let deterministicScore = 0.75; // start from neutral-aligned

  // Hard fails
  for (const rx of HARD_FAIL_PATTERNS) {
    if (rx.test(text)) {
      reasons.add("Escalatory or threatening language detected");
      return {
        score0to1: 0.2,
        label: "off_vow",
        reasons: Array.from(reasons),
      };
    }
  }

  // Negative markers
  for (const { regex, reason } of NEGATIVE_PATTERNS) {
    if (regex.test(text)) {
      reasons.add(reason);
      deterministicScore -= 0.2;
    }
  }

  // Positive markers
  for (const { regex, reason } of POSITIVE_PATTERNS) {
    if (regex.test(text)) {
      reasons.add(reason);
      deterministicScore += 0.1;
    }
  }

  deterministicScore = Math.max(0, Math.min(1, deterministicScore));

  // For now, we skip LLM integration in code (hook here if configured).
  const finalScore = deterministicScore;

  let label: VowAlignmentLabel;
  if (finalScore >= 0.75) label = "aligned";
  else if (finalScore >= 0.45) label = "at_risk";
  else label = "off_vow";

  if (reasons.size === 0) {
    reasons.add("No strong negative markers detected");
  }

  return {
    score0to1: finalScore,
    label,
    reasons: Array.from(reasons),
  };
}

export function computeRecencyWeight(createdAtIso: string, rangeEnd: Date): number {
  const created = new Date(createdAtIso);
  const diffDays = Math.floor(
    (rangeEnd.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays <= 7) return 1.0;
  if (diffDays <= 30) return 0.7;
  if (diffDays <= 90) return 0.4;
  return 0.2;
}

