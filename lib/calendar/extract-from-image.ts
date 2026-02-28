/**
 * Use OpenAI vision to extract event-like fields from an image (flyer, appointment card, screenshot).
 * Returns { title, date, start_time, end_time, location, notes, category, child_name, confidence }.
 */

export type ExtractedEvent = {
  title: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  category: string;
  child_name: string | null;
  confidence: number;
};

const CATEGORIES = ["medical", "school", "therapy", "extracurricular", "custody_exchange", "other"];

export async function extractEventFromImageBase64(base64Image: string, mimeType: string): Promise<ExtractedEvent> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      title: "",
      date: null,
      start_time: null,
      end_time: null,
      location: null,
      notes: null,
      category: "other",
      child_name: null,
      confidence: 0,
    };
  }

  const prompt = `Look at this image. It may be a flyer, appointment card, screenshot, or calendar notice.
Extract any event information and return a JSON object with exactly these keys (use null for missing):
- title (string)
- date (string, YYYY-MM-DD if possible, or a date description)
- start_time (string, HH:mm or "9:00 AM" style)
- end_time (string or null)
- location (string or null)
- notes (string or null, any extra details)
- category (one of: ${CATEGORIES.join(", ")})
- child_name (string or null, if a child's name appears)

Return only valid JSON, no markdown.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return {
      title: "",
      date: null,
      start_time: null,
      end_time: null,
      location: null,
      notes: null,
      category: "other",
      child_name: null,
      confidence: 0.5,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const cleaned = content.replace(/^```json?\s*|\s*```$/g, "").trim();
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return {
      title: "",
      date: null,
      start_time: null,
      end_time: null,
      location: null,
      notes: null,
      category: "other",
      child_name: null,
      confidence: 0.3,
    };
  }

  const title = typeof parsed.title === "string" ? parsed.title : "";
  const dateRaw = parsed.date;
  let date: string | null = null;
  if (typeof dateRaw === "string") {
    const d = new Date(dateRaw);
    if (!Number.isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    else date = dateRaw.slice(0, 10);
  }
  const start_time = typeof parsed.start_time === "string" ? parsed.start_time : null;
  const end_time = typeof parsed.end_time === "string" ? parsed.end_time : null;
  const location = typeof parsed.location === "string" ? parsed.location : null;
  const notes = typeof parsed.notes === "string" ? parsed.notes : null;
  const cat = typeof parsed.category === "string" && CATEGORIES.includes(parsed.category) ? parsed.category : "other";
  const child_name = typeof parsed.child_name === "string" ? parsed.child_name : null;

  let confidence = 0.5;
  if (title) confidence += 0.2;
  if (date) confidence += 0.15;
  if (start_time) confidence += 0.1;
  confidence = Math.min(1, confidence);

  return {
    title,
    date,
    start_time,
    end_time,
    location,
    notes,
    category: cat,
    child_name,
    confidence,
  };
}
