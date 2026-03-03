const PROFANITY = [
  "shit",
  "fuck",
  "damn",
  "bitch",
  "bastard",
  "asshole",
  "idiot",
  "stupid",
];

const HOSTILITY_PHRASES = [
  "you always",
  "you never",
  "this is your fault",
  "i'm done with you",
  "i am done with you",
  "i'm sick of",
  "i am sick of",
  "what is wrong with you",
  "grow up",
];

const SEVERE_PHRASES = [
  "i'll take the kids",
  "i will take the kids",
  "i'm going to take the kids",
  "i will call cps",
  "i'm calling cps",
  "i will call the police",
  "i'm calling the police",
  "i will call police",
  "i'm calling police",
  "i will go to court",
  "i'm going to court",
  "i will take you to court",
];

export type IntensityResult = {
  score: number;
  flag: boolean;
  severe: boolean;
};

export function estimateIntensity(text: string): IntensityResult {
  const raw = text || "";
  const lower = raw.toLowerCase();
  let score = 0;
  let severe = false;

  // Profanity weight
  let profanityHits = 0;
  for (const word of PROFANITY) {
    const re = new RegExp(`\\b${word}\\b`, "g");
    if (re.test(lower)) {
      profanityHits += 1;
      score += 12;
    }
  }

  // Hostility phrases
  for (const phrase of HOSTILITY_PHRASES) {
    if (lower.includes(phrase)) {
      score += 15;
    }
  }

  // All-caps ratio (excluding very short strings)
  const letters = raw.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 6) {
    const upperCount = (letters.match(/[A-Z]/g) || []).length;
    const ratio = upperCount / letters.length;
    if (ratio >= 0.5) {
      score += 20;
    } else if (ratio >= 0.3) {
      score += 10;
    }
  }

  // Repeated exclamation / question marks
  if (/[!?]{3,}/.test(raw)) {
    score += 10;
  } else if (/[!?]{2}/.test(raw)) {
    score += 5;
  }

  // Length-normalised baseline
  const wordCount = raw.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount >= 40 && profanityHits > 0) {
    score += 10;
  }

  // Severe phrases (threats / high stakes) – do not use red in UI; this is internal only.
  for (const phrase of SEVERE_PHRASES) {
    if (lower.includes(phrase)) {
      severe = true;
      score = Math.max(score, 85);
      break;
    }
  }

  // Clamp score to 0–100
  score = Math.max(0, Math.min(100, score));

  // Threshold for "cross-intensity" nudges
  const flag = score >= 60;

  return { score, flag, severe };
}

