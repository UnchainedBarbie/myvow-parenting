import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  draftOriginLabel,
  hasMessageSubstance,
  proposalListHeading,
} from "@/lib/messages/message-content";
import {
  reviewCoversText,
  reviewDefaultChoice,
  reviewFinalText,
  reviewOutboundMessage,
} from "@/lib/messages/outbound-review";
import { routeApprovals } from "@/lib/messages/proposal-send";
import { processChatMessage } from "@/lib/sage/chat";
import { shouldPreserveOpenWork, type KnownCoparent } from "@/lib/sage/chat-intent";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import type { ConversationModel, TaskTurnReading } from "@/lib/sage/conversation-reply";
import { deriveWorkingMemory } from "@/lib/sage/working-memory";

/**
 * Whose words a message card holds, and what counts as a message.
 *
 * The model is a test double that says how it read a turn. The product code never matches
 * the words of a message to decide anything about it.
 */

const TODAY = new Date("2026-10-23T18:00:00Z");
const kevin: KnownCoparent = { name: "Kevin", email: "kevin@example.com" };

function context(over: Partial<ConversationContext> = {}): ConversationContext {
  return {
    thread_subject: null,
    event: { subject: null, child: null, date: null, time: null, eventId: null },
    open_proposals: [],
    ...over,
  };
}

function openMessageQuestion() {
  return deriveWorkingMemory([
    {
      itemId: "item-msg",
      itemType: "message",
      proposals: [
        {
          id: "ask-msg",
          type: "ask_clarification",
          draft: "What should I tell Kevin? I won't invent the details.",
          audience: "parent",
          clarifies: "message",
          recipient_name: kevin.name,
          recipient_email: kevin.email,
          requires_approval: true,
        },
      ],
    },
  ]);
}

function reading(read: TaskTurnReading | null, reply: string | null = "MODEL-REPLY"): ConversationModel {
  return { reply: async () => reply, readTurn: async () => read };
}

async function chat(
  message: string,
  over: { conversation?: ConversationContext | null; model: ConversationModel | null }
) {
  return processChatMessage({
    message,
    case_id: "case-1",
    timezone: "America/Denver",
    conversation: over.conversation ?? null,
    coparents: [kevin],
    children: [{ id: "child-1", name: "Emma Example" }],
    viewerId: "parent-ashley",
    viewerRole: "parent",
    reasonAboutDocument: null,
    shadow: false,
    today: TODAY,
    conversationModel: over.model,
  });
}

function messageCards(result: Awaited<ReturnType<typeof chat>>) {
  return result.result.plan.proposals.filter((p) => p.type === "reply_coparent");
}

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");

async function main() {
  delete process.env.ANTHROPIC_API_KEY;

  // --- Content with nothing to say -------------------------------------------------------------
  for (const text of ["asshole", "Asshole!!", "you are such an idiot", "fuck you", "  ??  ", "...", "😡"]) {
    assert.equal(hasMessageSubstance(text), false, `no message content: ${text}`);
  }
  // Heated text with a request, a fact or a boundary is a message.
  for (const text of [
    "You never showed up on Friday and I'm furious about it.",
    "You're an asshole for missing Emma's pickup.",
    "Stop texting me during work. I will only answer messages about the kids.",
    "Please bring Emma's jacket on Friday.",
    "I can take Friday.",
  ]) {
    assert.equal(hasMessageSubstance(text), true, `message content: ${text}`);
  }

  // --- A standalone insult with no open task ----------------------------------------------------
  {
    for (const model of [reading(null), null]) {
      const result = await chat("asshole", { model });
      assert.equal(messageCards(result).length, 0, "no message is drafted");
      assert.equal(result.actions.length, 0);
      assert.equal(result.result.plan.proposals.length, 0);
    }
  }

  // --- An insult while a message question is open ----------------------------------------------
  {
    const memory = openMessageQuestion();
    const before = JSON.stringify(memory);
    for (const text of ["asshole", "you are such an idiot", "fuck you", "??"]) {
      // Whatever the model read, and with no model at all, no draft is made from empty content.
      for (const model of [
        reading("answers_pending_question"),
        reading(null),
        reading("other"),
        null,
      ]) {
        const result = await chat(text, { model, conversation: context({ memory }) });
        assert.equal(messageCards(result).length, 0, `no card for "${text}"`);
        assert.equal(result.actions.length, 0);
        assert.equal(result.result.plan.proposals.length, 0);
        assert.equal(JSON.stringify(memory), before, "the open question is untouched");
        assert.equal(shouldPreserveOpenWork(text, memory, result.result.plan.proposals), true);
        assert.doesNotMatch(result.reply, /here is (your|a) message/i);
      }
      // When nothing reads the turn as conversation, Sage asks what the parent wants to say.
      const asked = await chat(text, { model: reading("answers_pending_question"), conversation: context({ memory }) });
      assert.match(asked.reply, /What do you want Kevin to know or do\?/);
      assert.match(asked.reply, /haven't drafted anything/);
      assert.doesNotMatch(asked.reply, /sent|filed|logged/i);
    }
  }

  // --- Heated but substantive text, supplied to an open question ---------------------------------
  {
    const memory = openMessageQuestion();
    for (const text of [
      "You never showed up on Friday and I'm furious about it.",
      "You're an asshole for missing Emma's pickup.",
    ]) {
      for (const model of [reading("answers_pending_question"), reading(null), null]) {
        const result = await chat(text, { model, conversation: context({ memory }) });
        const cards = messageCards(result);
        assert.equal(cards.length, 1, "the parent's message becomes one card");
        const card = cards[0];
        assert.equal(card.draft, text, "the parent's words are kept exactly");
        assert.equal(card.draft_origin, "parent_text");
        assert.equal("revised_text" in card, false, "no rewrite is attached");
        assert.equal(card.recipient_email, "kevin@example.com");
        assert.equal(card.requires_approval, true);
        assert.equal("executed" in card, false);
        assert.match(result.reply, /your own words/i);
        assert.match(result.reply, /review it and choose Send/);
        assert.doesNotMatch(result.reply, /Sage (suggests|recommends)/i);
      }
    }

    // An ordinary aside is conversation. The question stays open.
    const aside = await chat("I'm just tired today.", {
      model: reading("other", "That sounds like a long day."),
      conversation: context({ memory }),
    });
    assert.equal(aside.reply, "That sounds like a long day.");
    assert.equal(messageCards(aside).length, 0);
  }

  // --- Content the parent supplies for an open question ------------------------------------------
  {
    const memory = openMessageQuestion();
    const result = await chat("Please bring Emma's jacket on Friday.", {
      model: reading("answers_pending_question"),
      conversation: context({ memory }),
    });
    const [card] = messageCards(result);
    assert.equal(card.draft, "Please bring Emma's jacket on Friday.");
    assert.equal(card.draft_origin, "parent_text");
  }

  // --- Wording Sage composes is marked as Sage's ---------------------------------------------------
  {
    const result = await chat("Let Kevin know about the dentist appointment on Friday at 3pm.", {
      model: null,
    });
    const [card] = messageCards(result);
    assert.ok(card, "a message is prepared from the facts the parent gave");
    assert.equal(card.draft_origin, "sage_wording");
    assert.notEqual(card.draft, "Let Kevin know about the dentist appointment on Friday at 3pm.");
  }

  // --- Labels never credit Sage with the parent's text ---------------------------------------------
  {
    assert.equal(draftOriginLabel({ draft_origin: "parent_text" }), "Your wording");
    assert.equal(draftOriginLabel({ draft_origin: "sage_wording" }), "Sage's draft");
    assert.equal(draftOriginLabel({}), null, "a card from before this field makes no claim");
    assert.equal(draftOriginLabel({ draft_origin: "parent_text", revised_text: "A calmer version." }), "Sage's draft");
    assert.equal(draftOriginLabel({ draft_origin: "parent_text", revised_text: "  " }), "Your wording");

    const own = { type: "reply_coparent", draft_origin: "parent_text" };
    const sage = { type: "reply_coparent", draft_origin: "sage_wording" };
    const calendar = { type: "calendar_update" };
    assert.equal(proposalListHeading([own]), "Your message");
    assert.equal(proposalListHeading([sage]), "Sage suggests");
    assert.equal(proposalListHeading([own, calendar]), "Sage suggests");
    assert.equal(proposalListHeading([{ type: "reply_coparent" }]), "Sage suggests");
    assert.equal(proposalListHeading([]), "Sage suggests");
  }

  // --- The parent's draft is preserved through review, and the parent keeps the choice -------------
  {
    const heated = "You never showed up on Friday and I'm furious about it.";
    const suggestion = "You did not show up on Friday and I am upset about it.";
    const reviewed = await reviewOutboundMessage(heated, async () => suggestion);
    assert.equal(reviewed.status, "suggestion");
    assert.equal(reviewed.original, heated, "the original is kept verbatim");
    assert.equal(reviewFinalText({ review: reviewed, choice: "original", edited: "" }), heated);
    assert.equal(reviewCoversText(reviewed, heated), true);

    // Insult-only text is not reshaped. Nothing is preselected, and the parent may still choose their words.
    let asked = false;
    const insult = await reviewOutboundMessage("asshole", async () => {
      asked = true;
      return "Please call me.";
    });
    assert.equal(asked, false, "the model has nothing to invent from");
    assert.equal(insult.status, "no_message");
    assert.equal(insult.original, "asshole");
    assert.equal(reviewDefaultChoice(insult), null, "no version is preselected");
    assert.equal(reviewFinalText({ review: insult, choice: null, edited: "" }), null);
    assert.equal(reviewFinalText({ review: insult, choice: "original", edited: "" }), "asshole");
    assert.equal(reviewFinalText({ review: insult, choice: "edit", edited: "Please call me." }), "Please call me.");
  }

  // --- Every card that sends goes through the review -----------------------------------------------
  {
    const proposals = [
      { type: "reply_coparent", recipient_email: "kevin@example.com", draft: "Hi" },
      { type: "calendar_update" },
      { type: "reply_coparent", recipient_email: "", draft: "No address" },
      { type: "reply_coparent", recipient_email: "kevin@example.com", draft: "Sent", executed: true },
    ];
    const withReview = routeApprovals([0, 1, 2, 3], proposals, true);
    assert.deepEqual(withReview.review, [0]);
    assert.deepEqual(withReview.direct, [1, 2]);
    assert.deepEqual(withReview.held, [3]);

    const withoutReview = routeApprovals([0, 1, 2, 3], proposals, false);
    assert.deepEqual(withoutReview.review, []);
    assert.deepEqual(withoutReview.direct, [1, 2]);
    assert.deepEqual(withoutReview.held, [0, 3], "a message is held where no review can run");
    for (const routing of [withReview, withoutReview]) {
      for (const index of routing.direct) {
        assert.equal(
          proposals[index].type === "reply_coparent" && Boolean(proposals[index].recipient_email),
          false,
          "a sendable message never reaches direct approval"
        );
      }
    }

    // Structural guards on the screens that render cards.
    const list = read("components/sage/proposal-card-list.tsx");
    assert.doesNotMatch(list, /void onAgree\(indexes\)/, "approval goes through routeApprovals");
    assert.match(list, /routeApprovals\(indexes, proposals, reviewSends\)/);
    for (const file of [
      "components/sage/SageClient.tsx",
      "components/sage/sage-inbox.tsx",
      "components/dashboard/open-item-review.tsx",
    ]) {
      assert.match(read(file), /reviewSends/, `${file} reviews messages before they send`);
    }
    const drawer = read("components/sage/talk-to-sage-drawer.tsx");
    assert.doesNotMatch(drawer, /reviewSends/, "the drawer cannot review, so it never offers a send");
    assert.match(drawer, /p\.type === "reply_coparent" && \(p\.recipient_email \?\? ""\)\.trim\(\)\) return/);

    // The server refuses a message send that has no review proof.
    const route = read("app/api/sage-inbox/route.ts");
    assert.match(route, /reviewGate\(/);
    assert.match(route, /reviewGateFailure\(/);
  }

  // --- The router holds no wording about insults ------------------------------------------------------
  {
    const router = read("lib/sage/chat-intent.ts");
    assert.doesNotMatch(router, /asshole|idiot|insult|profan|\bfuck/i);
    const chatSource = read("lib/sage/chat.ts");
    assert.doesNotMatch(chatSource, /asshole|idiot|insult|profan|\bfuck/i);
  }

  console.log("message provenance tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
