import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { completeOutboundReview } from "@/lib/ai/mediate";
import { reviewOutboundMessage } from "@/lib/messages/outbound-review";
import { issueReviewReceipt } from "@/lib/messages/review-receipt";

/**
 * Review one outgoing co-parent message. Used by Messages and Sage Chats.
 * The review is advice only. Nothing is saved or sent here.
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
    const body = (await request.json().catch(() => ({}))) as { draft?: unknown };
    const draft = typeof body.draft === "string" ? body.draft.trim() : "";
    if (!draft) {
      return NextResponse.json({ message: "Missing draft" }, { status: 400 });
    }
    if (draft.length > 8000) {
      return NextResponse.json({ message: "The draft is too long to review." }, { status: 400 });
    }
    const review = await reviewOutboundMessage(draft, completeOutboundReview);
    // The receipt lets the send route confirm this exact draft was reviewed for this parent.
    const receipt = issueReviewReceipt({
      userId: user.id,
      draft,
      suggestion: review.status === "suggestion" ? review.suggestion : null,
      status: review.status === "unavailable" ? "review_unavailable" : "reviewed",
    });
    return NextResponse.json({ review, receipt });
  } catch {
    return NextResponse.json({ message: "The review could not be completed." }, { status: 500 });
  }
}
