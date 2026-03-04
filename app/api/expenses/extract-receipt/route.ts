import { NextRequest, NextResponse } from "next/server";
import { createClient, getServiceRoleClient } from "@/lib/supabase/server";
import { runClassify } from "@/lib/ai-classify";

type ReceiptExtraction = {
  description: string | null;
  amount: number | null;
  date: string | null;
  merchant: string | null;
  category: string | null;
};

function mapReceiptCategory(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === "medical") return "medical";
  if (lower === "school" || lower === "education") return "school";
  if (lower === "clothing") return "clothing";
  if (lower === "activities" || lower === "activity" || lower === "extracurricular")
    return "extracurricular";
  if (lower === "transportation") return "transportation";
  if (lower === "food" || lower === "housing") return "other";
  if (lower === "childcare") return "childcare";
  return "other";
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceRoleClient();
    const {
      data: membership,
      error: membershipError,
    } = await admin
      .from("case_members")
      .select("case_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      return NextResponse.json(
        { message: membershipError.message },
        { status: 500 }
      );
    }

    if (!membership?.case_id) {
      return NextResponse.json(
        { message: "No active case" },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { message: "Missing file" },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";

    // Reuse the existing classification pipeline to keep behavior aligned.
    const payload = await runClassify(buf, contentType, file.name);

    const result: ReceiptExtraction = {
      description:
        (payload.vendor && String(payload.vendor).trim()) ||
        (payload.description && payload.description.trim()) ||
        null,
      amount: typeof payload.amount === "number" ? payload.amount : null,
      date: payload.date ?? null,
      merchant:
        (payload.vendor && String(payload.vendor).trim()) || null,
      category: mapReceiptCategory(payload.category ?? null),
    };

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        message:
          e instanceof Error
            ? e.message
            : "Failed to extract fields from receipt",
      },
      { status: 500 }
    );
  }
}

