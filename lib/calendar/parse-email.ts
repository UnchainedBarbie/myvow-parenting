/**
 * Parse plain-text email body into structured event fields.
 * Tries structured lines first, then heuristics. Returns confidence 0–1.
 */

const STRUCTURED_KEYS = [
  "title",
  "date",
  "time",
  "start",
  "end",
  "start_time",
  "end_time",
  "location",
  "notes",
  "category",
  "child",
  "visibility",
] as const;

const CATEGORY_MAP: Record<string, string> = {
  medical: "medical",
  doctor: "medical",
  appointment: "medical",
  school: "school",
  therapy: "therapy",
  extracurricular: "extracurricular",
  custody: "custody_exchange",
  exchange: "custody_exchange",
  other: "other",
};

function normalizeCategory(raw: string): string {
  const lower = raw.trim().toLowerCase();
  for (const [key, value] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(key)) return value;
  }
  return "other";
}

function parseStructuredLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*(Title|Date|Time|Start|End|Start time|End time|Location|Notes|Category|Child|Visibility)\s*[:=]\s*(.*)$/i);
  if (!match) return null;
  const key = match[1].toLowerCase().replace(/\s+/, "_");
  const value = match[2].trim();
  if (!value) return null;
  if (key === "start_time") return { key: "start", value };
  if (key === "end_time") return { key: "end", value };
  return { key, value };
}

/** Try to parse a date string (US format or ISO) into YYYY-MM-DD */
function parseDateString(s: string): string | null {
  const trimmed = s.trim();
  // ISO
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Mon Mar 2 or March 2, 2025 or 3/2/2025
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return null;
}

/** Try to parse time like "5:00 PM" or "17:00" into HH:mm */
function parseTimeString(s: string): string | null {
  const t = s.trim();
  const d = new Date(`1970-01-01T${t}`);
  if (!Number.isNaN(d.getTime())) {
    const h = d.getHours();
    const m = d.getMinutes();
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const twelve = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (twelve) {
    let h = parseInt(twelve[1], 10);
    const m = parseInt(twelve[2] || "0", 10);
    if (twelve[3].toLowerCase() === "pm" && h < 12) h += 12;
    if (twelve[3].toLowerCase() === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  return null;
}

/** Extract date and time from a string like "Mon Mar 2 5:00 PM – 6:00 PM at Children's Hospital" */
function extractDateTimeFromPhrase(text: string): {
  date: string | null;
  startTime: string | null;
  endTime: string | null;
} {
  const lines = text.split(/\n/);
  const fullText = lines.join(" ");
  let date: string | null = null;
  let startTime: string | null = null;
  let endTime: string | null = null;

  // Pattern: "Mon Mar 2 5:00 PM – 6:00 PM" or "Mar 2 5:00 PM - 6:00 PM"
  const rangeMatch = fullText.match(/([A-Za-z]+\s+[A-Za-z]+\s+\d{1,2})\s+(\d{1,2}(?::\d{2})?\s*[AP]M)\s*[–\-]\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/i);
  if (rangeMatch) {
    date = parseDateString(rangeMatch[1]);
    startTime = parseTimeString(rangeMatch[2]);
    endTime = parseTimeString(rangeMatch[3]);
  }
  if (!date && fullText) {
    const anyDate = fullText.match(/([A-Za-z]+\s+[A-Za-z]+\s+\d{1,2}(?:\s*,?\s*\d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (anyDate) date = parseDateString(anyDate[1]);
    const anyTime = fullText.match(/(\d{1,2}(?::\d{2})?\s*[AP]M)/gi);
    if (anyTime && anyTime[0]) startTime = parseTimeString(anyTime[0]);
    if (anyTime && anyTime[1]) endTime = parseTimeString(anyTime[1]);
  }
  return { date, startTime, endTime };
}

export type ParsedEvent = {
  title: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  category: string;
  child_name: string | null;
  visibility: "family" | "parents_only" | "private";
  confidence: number;
};

export function parseEmailBody(subject: string, bodyText: string): ParsedEvent {
  const body = (bodyText || "").trim();
  const lines = body.split(/\n/).map((l) => l.trim());
  const result: Record<string, string> = {
    title: "",
    date: "",
    start_time: "",
    end_time: "",
    location: "",
    notes: "",
    category: "other",
    child: "",
    visibility: "family",
  };

  let structuredCount = 0;
  for (const line of lines) {
    const parsed = parseStructuredLine(line);
    if (parsed) {
      structuredCount++;
      if (parsed.key === "title") result.title = parsed.value;
      if (parsed.key === "date") result.date = parseDateString(parsed.value) ?? parsed.value;
      if (parsed.key === "time" && !result.start_time) result.start_time = parseTimeString(parsed.value) ?? "";
      if (parsed.key === "start" || parsed.key === "time") result.start_time = parseTimeString(parsed.value) ?? result.start_time;
      if (parsed.key === "end") result.end_time = parseTimeString(parsed.value) ?? "";
      if (parsed.key === "location") result.location = parsed.value;
      if (parsed.key === "notes") result.notes = parsed.value;
      if (parsed.key === "category") result.category = normalizeCategory(parsed.value);
      if (parsed.key === "child") result.child = parsed.value;
      if (parsed.key === "visibility") {
        const v = parsed.value.toLowerCase();
        if (v.includes("private")) result.visibility = "private";
        else if (v.includes("parent")) result.visibility = "parents_only";
        else result.visibility = "family";
      }
    }
  }

  if (!result.title && subject) result.title = subject.trim();
  const phraseExtract = extractDateTimeFromPhrase(body || subject);
  if (!result.date && phraseExtract.date) result.date = phraseExtract.date;
  if (!result.start_time && phraseExtract.startTime) result.start_time = phraseExtract.startTime;
  if (!result.end_time && phraseExtract.endTime) result.end_time = phraseExtract.endTime;

  if (!result.date && result.start_time) {
    const today = new Date();
    result.date = today.toISOString().slice(0, 10);
  }

  const hasTitle = result.title.length > 0;
  const hasDate = result.date.length > 0;
  const hasTime = result.start_time.length > 0;
  let confidence = 0.5;
  if (hasTitle) confidence += 0.2;
  if (hasDate) confidence += 0.15;
  if (hasTime) confidence += 0.1;
  if (structuredCount >= 2) confidence += 0.15;
  if (structuredCount >= 4) confidence += 0.1;
  confidence = Math.min(1, confidence);

  return {
    title: result.title || subject || "Untitled",
    date: result.date || null,
    start_time: result.start_time || null,
    end_time: result.end_time || null,
    location: result.location || null,
    notes: result.notes || null,
    category: result.category,
    child_name: result.child || null,
    visibility: result.visibility as "family" | "parents_only" | "private",
    confidence,
  };
}
