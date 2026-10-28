import assert from "node:assert/strict";
import {
  NO_MESSAGE_MARKER,
  cleanModelText,
  isInsultOnly,
  outboundReviewUserMessage,
  requestOutboundReview,
  reviewDefaultChoice,
  reviewEditSeed,
  reviewFinalText,
  reviewFromModelText,
  reviewFromResponse,
  reviewOutboundMessage,
  validateSuggestion,
  type OutboundReview,
} from "@/lib/messages/outbound-review";
import { completeOutboundReview } from "@/lib/ai/mediate";

const GENERIC =
  "I'd be happy to help rewrite a co-parenting message. Please share the full message you'd like me to rework.";

function replying(text: string) {
  const seen: string[] = [];
  return {
    seen,
    complete: async (draft: string) => {
      seen.push(draft);
      return text;
    },
  };
}

async function main() {
  // Insults only: no model call, no invented message.
  for (const draft of ["asshole", "ASSHOLE!!!", "You are such an asshole", "you're a fucking idiot", "go to hell"]) {
    assert.equal(isInsultOnly(draft), true, draft);
    const fake = replying("Could you please confirm the pickup time?");
    const review = await reviewOutboundMessage(draft, fake.complete);
    assert.equal(review.status, "no_message", draft);
    assert.equal(fake.seen.length, 0, "the model is not asked to invent a message");
    assert.equal("suggestion" in review, false);
    assert.match((review as { explanation: string }).explanation, /Tell me what you want your co-parent to know or do/);
    assert.equal(review.original, draft.trim());
  }
  // An insult beside real content is reviewed, not dismissed.
  assert.equal(isInsultOnly("You're an idiot and you were late again"), false);
  assert.equal(isInsultOnly("Can you pick up Ashley at 5?"), false);
  assert.equal(isInsultOnly(""), false);

  // The model receives the exact draft, inside the draft tags, and the prompt forbids asking for it again.
  const draft = "Ashley has a dentist visit at 4:30 on Tuesday.\nCan you take her?";
  const wrapped = outboundReviewUserMessage(draft);
  assert.ok(wrapped.includes(`<draft>\n${draft}\n</draft>`));
  const sentBodies: Array<{ system: string; messages: Array<{ role: string; content: string }> }> = [];
  const realFetch = globalThis.fetch;
  const realKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      sentBodies.push(JSON.parse(init?.body ?? "{}"));
      return {
        ok: true,
        status: 200,
        json: async () => ({ content: [{ type: "text", text: "Can you take Ashley to her dentist visit at 4:30 on Tuesday?" }] }),
      } as Response;
    }) as typeof fetch;
    const review = await reviewOutboundMessage(draft, completeOutboundReview);
    assert.equal(review.status, "suggestion");
    assert.equal(sentBodies.length, 1);
    assert.ok(sentBodies[0].messages[0].content.includes(draft), "exact draft reaches the model");
    assert.equal(sentBodies[0].messages[0].role, "user");
    assert.match(sentBodies[0].system, /complete draft/);
    assert.match(sentBodies[0].system, new RegExp(NO_MESSAGE_MARKER));
    assert.match(sentBodies[0].system, /Never ask for more information/);

    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response) as typeof fetch;
    assert.equal((await reviewOutboundMessage(draft, completeOutboundReview)).status, "unavailable");
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ content: [] }) }) as Response) as typeof fetch;
    assert.equal((await reviewOutboundMessage(draft, completeOutboundReview)).status, "unavailable");
    delete process.env.ANTHROPIC_API_KEY;
    const unconfigured = await reviewOutboundMessage(draft, completeOutboundReview);
    assert.equal(unconfigured.status, "unavailable");
    assert.equal("suggestion" in unconfigured, false);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
  }

  // Generic assistant replies never become the Sage version.
  for (const original of ["asshole", "Can you pick up Ashley at 5 on Friday?"]) {
    for (const text of [
      GENERIC,
      "Please share the full message you'd like me to rework.",
      "Sure! Here's a calmer version: Could you pick Ashley up at 5 on Friday?",
      "Certainly, I can help with that. What would you like to say?",
      "I'm unable to help with this request.",
      "Rewritten message: Could you pick Ashley up at 5 on Friday?",
    ]) {
      const review = reviewFromModelText(original, text);
      assert.notEqual(review.status, "suggestion", text);
      assert.equal("suggestion" in review, false);
      assert.equal(reviewFinalText({ review, choice: "sage", edited: "" }), null);
      assert.equal(reviewDefaultChoice(review), null);
    }
  }
  const generic = reviewFromModelText("Can you pick up Ashley at 5 on Friday?", GENERIC);
  assert.equal(generic.status, "unavailable");
  assert.equal((generic as { cause: string }).cause, "invalid_suggestion");
  assert.doesNotMatch(JSON.stringify(generic), /happy to help/);

  // Normal co-parenting messages.
  const pickup = "Can you pick up Ashley at 5 on Friday?";
  assert.equal(reviewFromModelText(pickup, pickup).status, "no_change");
  assert.equal(reviewFromModelText(pickup, `"${pickup}"`).status, "no_change");
  const polite = reviewFromModelText(pickup, "Could you please pick Ashley up at 5 on Friday?");
  assert.equal(polite.status, "suggestion");
  const heated = reviewFromModelText(
    "You always forget Ashley's pickup. Be there at 5 on Friday.",
    "Please plan to be at Ashley's pickup at 5 on Friday."
  );
  assert.equal(heated.status, "suggestion");
  assert.equal(
    reviewFromModelText("I'm happy to take her Friday.", "I'm happy to take her on Friday.").status,
    "suggestion"
  );
  assert.equal(validateSuggestion(pickup, "Could you pick Ashley up at 6 on Friday?").ok, false);
  assert.equal(validateSuggestion(pickup, "Could you pick Ashley up at 5 on Saturday?").ok, false);
  assert.equal(validateSuggestion(pickup, "Could you pick Ashley up at 5 on Friday and bring $40?").ok, false);
  assert.equal(
    reviewFromModelText(
      "Why were you late to the school pickup again yesterday",
      "Here is the weather forecast for the weekend in Denver"
    ).status,
    "unavailable"
  );
  assert.equal(
    reviewFromModelText("Pickup at 5?", Array.from({ length: 60 }, () => "word").join(" ")).status,
    "unavailable"
  );

  // Firm boundaries stay firm.
  const boundary = "I will not discuss the custody schedule over text. Send any changes by email.";
  assert.equal(
    reviewFromModelText(boundary, "I won't discuss the custody schedule over text. Please send any changes by email.").status,
    "suggestion"
  );
  assert.equal(reviewFromModelText(boundary, boundary).status, "no_change");
  const softened = reviewFromModelText(boundary, "I'm happy to discuss the custody schedule by text.");
  assert.equal(softened.status, "unavailable");
  assert.equal(validateSuggestion(boundary, "I'm happy to discuss the custody schedule by text.").ok, false);
  // An insult beside a boundary keeps the boundary and drops the insult.
  const mixed = reviewFromModelText(
    "You're an asshole. I will not change the Friday pickup.",
    "I will not change the Friday pickup."
  );
  assert.equal(mixed.status, "suggestion");

  // The model may declare that nothing constructive exists.
  assert.equal(reviewFromModelText("I hate you", NO_MESSAGE_MARKER).status, "no_message");
  assert.equal(reviewFromModelText("I hate you", `${NO_MESSAGE_MARKER}.`).status, "no_message");
  assert.equal(cleanModelText("```\nHello there\n```"), "Hello there");
  assert.equal(cleanModelText("“Hello there”"), "Hello there");

  // Failed review requests never produce a suggestion and never pick one.
  const throwing = await reviewOutboundMessage(pickup, async () => {
    throw new Error("network down");
  });
  assert.equal(throwing.status, "unavailable");
  assert.equal((throwing as { cause: string }).cause, "failed");
  assert.equal((await reviewOutboundMessage(pickup, async () => "")).status, "unavailable");
  assert.equal((await reviewOutboundMessage(pickup, async () => null)).status, "unavailable");
  assert.equal((await reviewOutboundMessage("   ", async () => "x")).status, "unavailable");

  const fetchResult = (impl: () => Promise<Response>) => requestOutboundReview(pickup, impl as unknown as typeof fetch);
  const rejected = await fetchResult(async () => {
    throw new Error("offline");
  });
  assert.equal(rejected.status, "unavailable");
  const serverError = await fetchResult(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
  assert.equal(serverError.status, "unavailable");
  const malformed = await fetchResult(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("bad json");
        },
      }) as unknown as Response
  );
  assert.equal(malformed.status, "unavailable");
  const garbled = await fetchResult(async () => ({ ok: true, status: 200, json: async () => ({ review: { status: "??" } }) }) as Response);
  assert.equal(garbled.status, "unavailable");
  // A bad suggestion that reaches the browser is still rejected there.
  const smuggled = await fetchResult(
    async () =>
      ({ ok: true, status: 200, json: async () => ({ review: { status: "suggestion", suggestion: GENERIC } }) }) as Response
  );
  assert.equal(smuggled.status, "unavailable");
  assert.equal("suggestion" in smuggled, false);
  const accepted = await fetchResult(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ review: { status: "suggestion", suggestion: "Could you please pick Ashley up at 5 on Friday?" } }),
      }) as Response
  );
  assert.equal(accepted.status, "suggestion");
  assert.equal(accepted.original, pickup);
  assert.equal(reviewFromResponse("x", null).status, "unavailable");

  // Choices: a suggestion is shown but nothing is sent without an explicit final approval.
  const suggestion = polite as Extract<OutboundReview, { status: "suggestion" }>;
  assert.equal(reviewDefaultChoice(suggestion), "sage");
  assert.equal(reviewFinalText({ review: suggestion, choice: "sage", edited: "" }), suggestion.suggestion);
  assert.equal(reviewFinalText({ review: suggestion, choice: "original", edited: "" }), pickup);
  assert.equal(reviewFinalText({ review: suggestion, choice: "edit", edited: "  Pick Ashley up at 5 Friday.  " }), "Pick Ashley up at 5 Friday.");
  assert.equal(reviewFinalText({ review: suggestion, choice: "edit", edited: "   " }), null);
  assert.equal(reviewFinalText({ review: suggestion, choice: null, edited: "" }), null);
  const none = await reviewOutboundMessage("asshole", async () => "unused");
  assert.equal(reviewDefaultChoice(none), null);
  assert.equal(reviewFinalText({ review: none, choice: null, edited: "" }), null);
  assert.equal(reviewFinalText({ review: none, choice: "sage", edited: "" }), null);
  assert.equal(reviewFinalText({ review: none, choice: "original", edited: "" }), "asshole");
  assert.equal(reviewEditSeed(none), "");
  assert.equal(reviewFinalText({ review: none, choice: "edit", edited: reviewEditSeed(none) }), null);
  assert.equal(reviewEditSeed(suggestion), suggestion.suggestion);
  assert.equal(reviewDefaultChoice({ status: "no_change", original: pickup }), "original");
  assert.equal(reviewEditSeed({ status: "no_change", original: pickup }), pickup);
  assert.equal(reviewDefaultChoice(throwing), null);
  assert.equal(reviewEditSeed(throwing), pickup);

  console.log("outbound review tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
