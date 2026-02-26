import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rewriteOutboundIntent } from "@/lib/ai/mediate";

/**
 * AI rewrite user intent → return draft for approval.
 * Authenticated users only.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const body = await request.json();
    const { intent } = body as { intent?: string };
    if (!intent || typeof intent !== "string") {
      return NextResponse.json(
        { message: "Missing intent" },
        { status: 400 }
      );
    }
    const draft = await rewriteOutboundIntent(intent.trim());
    return NextResponse.json({ draft });
  } catch (e) {
    return NextResponse.json(
      { message: e instanceof Error ? e.message : "Draft failed" },
      { status: 500 }
    );
  }
}
