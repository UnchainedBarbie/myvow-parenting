import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 250;
const CATEGORIES = ["court_order", "school", "medical", "expenses", "messages", "photos", "therapy", "legal", "communication", "incident", "other"] as const;

/**
 * POST /api/documents/analyze — AI-assisted suggestions from file.
 * Stub: returns suggestions derived from filename + timestamp.
 * Replace with real AI (e.g. vision/OCR + LLM) when ready.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const case_id = formData.get("case_id") as string | null;

    if (!file || !case_id) {
      return NextResponse.json({ message: "Missing file or case_id" }, { status: 400 });
    }

    // Stub: simulate delay and derive suggestions from filename
    await new Promise((r) => setTimeout(r, 800));

    const baseName = file.name.replace(/\.[^.]*$/, "").trim() || "Document";
    const safeTitle = baseName.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
    const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });

    const suggestedTitle = safeTitle || "Untitled document";
    const suggestedCategory = inferCategoryFromName(file.name) ?? "other";
    const suggestedDescription =
      `Uploaded ${dateLabel}. ${file.type.startsWith("image/") ? "Image file." : "Document."}`.slice(0, DESCRIPTION_MAX);
    const suggestedChildId: string | null = null;

    return NextResponse.json({
      suggestedTitle,
      suggestedCategory,
      suggestedChildId,
      suggestedDescription,
    });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Analysis failed" },
      { status: 500 }
    );
  }
}

function inferCategoryFromName(fileName: string): (typeof CATEGORIES)[number] | null {
  const lower = fileName.toLowerCase();
  if (lower.includes("medical") || lower.includes("doctor") || lower.includes("rx")) return "medical";
  if (lower.includes("school") || lower.includes("report") || lower.includes("grade")) return "school";
  if (lower.includes("court") || lower.includes("order")) return "court_order";
  if (lower.includes("receipt") || lower.includes("expense")) return "expenses";
  if (lower.includes("photo") || lower.includes("img") || lower.includes("pic")) return "photos";
  if (lower.includes("therapy") || lower.includes("counsel")) return "therapy";
  if (lower.includes("legal") || lower.includes("lawyer")) return "legal";
  if (lower.includes("message") || lower.includes("email")) return "messages";
  if (lower.includes("incident")) return "incident";
  if (lower.includes("comm")) return "communication";
  return null;
}
