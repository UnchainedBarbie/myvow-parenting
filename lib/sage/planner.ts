/**
 * Sage Engine — Planner layer.
 * Decides and drafts proposals. NEVER executes (no calendar writes, no email).
 * Sage proposes; humans approve.
 */

import { isUserCommand } from "@/lib/sage/observation-builder";
import {
  composeFactualReply,
  droppedFactLabels,
  NO_DETAIL_REPLY,
  unsupportedFacts,
  voiceProblems,
} from "@/lib/sage/outbound-facts";
import { coparentShareInvolves } from "@/lib/expenses-share";
import { isParentFacingQuestion } from "@/lib/sage/proposal-kind";

const SAGE_MODEL = "claude-sonnet-4-6";

export type PlanContext = {
  item_type: string;
  domain: string;
  action_required: boolean;
  action_type?: string | null;
  summary: string;
  child_ids: string[];
  unresolved_children: string[];
  resolved_dates: { raw: string; status: string; iso: string | null }[];
  sender: string;
  /** Adapter source ("chat" | "email"). Chat = user command on own records. */
  source_type?: string;
  /** True when the inbound message included at least one attachment. */
  has_attachments?: boolean;
  /** Plan-driven co-parent share for expense items, if computed. */
  expense_allocation?: {
    other_parent_share: number | null;
    allocation_status?: string;
    split_label?: string | null;
    clarification?: string | null;
    notify_coparent?: boolean;
  };
  /**
   * Inbound message, conversation context, and case-ledger lines.
   * The only facts an outbound draft may repeat.
   */
  outbound_sources?: string;
  /** Set when the co-parent asked for a time, date, place, or amount. */
  detail_request?: {
    question: string;
    /** Fact copied from a case record, or null when the sources do not have it. */
    record_line: string | null;
  } | null;
};

export type Proposal = {
  type:
    | "ask_clarification"
    | "reply_coparent"
    | "calendar_update"
    | "log_expense"
    | "log_document"
    | "note_only";
  draft: string;
  depends_on: string | null;
  requires_approval: true;
  /** Documents-vault file stored at chat attach; form links this id. */
  attached_document_id?: string;
  attached_file_name?: string;
  attached_file_url?: string;
  /** ask_clarification aimed at the parent, not the co-parent. */
  audience?: "parent" | "coparent";
  /** Record kind this question is about, when the proposal itself is only a question. */
  clarifies?: "calendar" | "expense" | "document" | "message";
  /** Classify fields carried on a log_document proposal. */
  title?: string;
  description?: string;
  category?: string;
  date?: string | null;
  /** Set after the calendar is checked. offer creates; update edits calendar_event_id. */
  calendar_intent?: "offer" | "update";
  calendar_event_id?: string | null;
  /** When the event begins, HH:mm. Never an arrival or a pickup. */
  event_start?: string | null;
  /** True only when the parent asked for an all-day event. */
  all_day?: boolean;
  /** Arrival or "needs to be there by", HH:mm. Written to the description, not start_time. */
  arrival_time?: string | null;
  /** Pickup or drop-off, HH:mm. Written to the description, not end_time. */
  pickup_time?: string | null;
  /** Co-parent the message will go to. Shown on the card; never guessed into the body. */
  recipient_name?: string | null;
  recipient_email?: string | null;
  subject?: string | null;
  /** Author of a reply_coparent draft: the parent's own text, or wording Sage composed. */
  draft_origin?: "parent_text" | "sage_wording";
  /**
   * What a conversation-grounded draft rests on: the parent's earlier turns, the facts taken from them,
   * the outcome the parent asked for, and what stays uncertain or disputed. The parent sees the draft, not this.
   */
  grounded_in?: {
    outcome: string;
    turns: number[];
    facts: { text: string; status: string }[];
    uncertain: string[];
  };
  /** Set when the approved save should change the event status, such as canceled. */
  event_status?: string | null;
  /** Dollar amount for an expense proposal. Absent when the user did not state one. */
  amount?: number | null;
  /** self = the logged-in parent paid. coparent = the other parent paid. */
  paid_by?: "self" | "coparent" | null;
  payer_name?: string | null;
  split_label?: string | null;
  other_parent_percent?: number | null;
  other_parent_share?: number | null;
  /** Signed debt to the logger. Negative when the other parent paid. */
  amount_owed?: number | null;
  /** Sharing sentence shown on the approval card before the expense is saved. */
  split_review?: string | null;
  sharing_intent?: "personal" | "shared" | "unspecified" | null;
  sharing_mode?: "personal" | "shared" | "choose" | "ask_percent" | null;
  sharing_conflict?: boolean | null;
  stated_percent?: number | null;
  /** Null until the parent or the message chooses. True asks the co-parent to respond after save. */
  notify_coparent?: boolean | null;
  /** Document vault visibility. Medical and therapy stay parents_only unless the parent asks otherwise. */
  visibility?: "private" | "parents_only" | "family" | null;
  /** Stable id for a pending document so a follow-up updates this proposal. */
  key?: string;
  document_child_id?: string | null;
  document_child_name?: string | null;
  /** True when approval updates a document that is already filed. */
  updatesExisting?: boolean;
};

export type Plan = {
  status: "ready" | "awaiting_clarification" | "no_action";
  proposals: Proposal[];
  reasoning: string;
};

const DRAFT_SYSTEM = `You are Sage drafting ONE short sentence for a co-parenting app.
Voice: warm, calm, trusted assistant — never corporate, never blaming.
Always refer to the other parent as "Co-Parent" (never a name or email).
No red flags, shame, or escalation. No markdown. No quotes around the sentence.
Respond with ONLY the single sentence — no preamble.`;

/** Text the parent will send. Address the co-parent as "you"; do not name them. */
const OUTBOUND_DRAFT_SYSTEM = `You are drafting the message the parent will send to their co-parent.
Write in the parent's first-person voice. Address the co-parent directly as "you".
Never refer to the co-parent in the third person. Never use their name or email.
Voice: plain, calm, factual.
No red flags, shame, or escalation. No markdown. No quotes around the sentences.

This text is a written record that will be sent to the other parent. A reply may state only facts present in one of: the inbound message, the conversation context, the current draft, or the case ledgers supplied in the allowed sources (calendar_events, expenses, documents).
Do not supply a time, date, place, amount, or name that is not in those sources.
Do not claim that the parent or Sage checked, confirmed, looked up, verified, or spoke to anyone.
If the co-parent asked for a detail that is not in those sources, say only that you will confirm and follow up. Never state a missing value as if it were known.

When revising, keep every fact already in the current draft and add the new one. A fact leaves only when the user corrects or removes it. An arrival time does not replace a start time. "She needs to be there at 7pm" adds an arrival; it does not drop an 8pm start. "Actually it's at 9pm, not 8" replaces the start time.

Write one to three short sentences, as few as the facts allow.

Voice prohibitions, with no exceptions:
- No exclamation points. Not one, anywhere.
- No "actually", "just a heads-up", "just so you know", or "FYI". These imply the other parent was wrong or needs managing.
- No filler warmth — "hope that helps", "let me know if you need anything else" — unless the user's own message asked for that phrase.

Negative example — do not write this when no source says 2:00 PM:
"I just checked and the recital starts at 2:00 PM on Saturday — let me know if you need any other details to plan your day."
That sentence invents a start time and claims a check that did not happen.

Negative example — do not drop a fact that is already true, and do not brighten the tone:
"The recital is at 8pm on Saturday!"
"Just a heads-up that she actually needs to be there by 7pm on Saturday for the recital."
The second sentence drops the 8pm start and talks down to the co-parent.

Positive example, when the start is 8pm and the arrival is 7pm:
"The recital is at 8pm on Saturday. Ashley needs to be there by 7pm."

Respond with ONLY the sentences — no preamble.`;

function proposal(
  type: Proposal["type"],
  draft: string,
  depends_on: string | null = null,
  extra?: Pick<Proposal, "audience">
): Proposal {
  // Every message this planner writes is Sage's wording. A parent's own text never passes through here.
  const origin = type === "reply_coparent" ? ({ draft_origin: "sage_wording" } as const) : {};
  return { type, draft, depends_on, requires_approval: true, ...origin, ...extra };
}

function isInformational(ctx: PlanContext): boolean {
  const t = ctx.item_type;
  if (t === "information_only" || t === "document_summary") return true;
  if (t === "school_update" && !ctx.action_required) return true;
  return false;
}

function isScheduleType(itemType: string): boolean {
  return itemType === "schedule_change" || itemType === "calendar_update";
}

function resolvedCalendarIso(ctx: PlanContext): string | null {
  const hit = ctx.resolved_dates.find((d) => d.status === "resolved" && d.iso);
  return hit?.iso ?? null;
}

function askForCalendarDate(): Proposal {
  return proposal("ask_clarification", "Which date should I use?", null);
}

function describeBlockers(ctx: PlanContext): string {
  const parts: string[] = [];
  const unclearDates = ctx.resolved_dates.filter(
    (d) => d.status === "needs_clarification"
  );
  if (unclearDates.length > 0) {
    const raws = unclearDates.map((d) => d.raw).join(", ");
    parts.push(`clarification of date (${raws})`);
  }
  if (ctx.unresolved_children.length > 0) {
    parts.push(
      `clarification of child (${ctx.unresolved_children.join(", ")})`
    );
  }
  return parts.join(" and ") || "clarification";
}

function templateNote(ctx: PlanContext): string {
  const summary = ctx.summary.trim() || "an update from Co-Parent";
  return `Noted for awareness: ${summary}`;
}

function templateReviewDocument(ctx: PlanContext): string {
  const summary = ctx.summary.trim() || "a document from Co-Parent";
  return `A document came in that needs a look: ${summary}`;
}

function userCommand(ctx: PlanContext): boolean {
  return isUserCommand({ sender: ctx.sender, source_type: ctx.source_type });
}

function templateCalendar(ctx: PlanContext): string {
  const resolved = ctx.resolved_dates.find((d) => d.status === "resolved" && d.iso);
  const when = resolved?.iso ? ` on ${resolved.iso}` : "";
  if (userCommand(ctx)) {
    const summary = ctx.summary.trim().replace(/\.$/, "") || "this event";
    return `Add to your calendar${when}: ${summary}.`;
  }
  return `Propose calendar update${when} based on: ${ctx.summary.trim() || "schedule change from Co-Parent"}.`;
}

function templateExpense(ctx: PlanContext): string {
  const summary = ctx.summary.trim().replace(/\.$/, "");
  const share = ctx.expense_allocation?.other_parent_share;
  const involved = coparentShareInvolves(share);
  const notify = ctx.expense_allocation?.notify_coparent === true;
  const split = ctx.expense_allocation?.split_label;
  const shareLabel =
    involved && share != null
      ? `Split ${split ?? "per your plan"}. $${share.toFixed(2)} is the other parent's share`
      : null;

  if (userCommand(ctx)) {
    let base = "You'd like to log this expense";
    if (summary) {
      base = /^you'd like to/i.test(summary)
        ? summary
        : `You'd like to log ${summary}`;
    }
    if (shareLabel) {
      return `${base}. ${shareLabel}.`;
    }
    if (split && share === 0) {
      return `${base}. Split ${split}. The other parent's share is $0.00.`;
    }
    if (notify) {
      return `${base} for your records. You'll notify Co-Parent even though their share is $0.`;
    }
    return `${base} for your records.`;
  }
  return `Propose logging expense from Co-Parent: ${summary || "expense shared by Co-Parent"}.`;
}

function fallbackAsk(ctx: PlanContext): string {
  const unclear =
    ctx.item_type === "expense"
      ? undefined
      : ctx.resolved_dates.find((d) => d.status === "needs_clarification");
  if (unclear) {
    return `Could you confirm which exact date you mean by "${unclear.raw}"?`;
  }
  if (ctx.unresolved_children.length > 0) {
    return `Could you confirm which child this is about (${ctx.unresolved_children.join(", ")})?`;
  }
  return "Could you share a bit more detail so Sage can help accurately?";
}

function fallbackReply(ctx: PlanContext): string {
  const summary = ctx.summary.trim().replace(/\.$/, "");
  if (summary) return `Thanks for letting me know about ${summary}.`;
  return "Thanks for letting me know.";
}

export async function callAnthropicDraft(
  userPrompt: string,
  system: string = DRAFT_SYSTEM
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[sage/planner] ANTHROPIC_API_KEY not configured");
    return null;
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: SAGE_MODEL,
        max_tokens: 200,
        temperature: 0,
        system,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[sage/planner] Anthropic API error:", res.status, errBody);
      return null;
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((c) => c.type === "text")?.text?.trim() ?? null;
    if (!text) return null;
    // Strip wrapping quotes if the model adds them
    return text.replace(/^["“]|["”]$/g, "").trim() || null;
  } catch (e) {
    console.error("[sage/planner] Anthropic request failed:", e);
    return null;
  }
}

function replyPrompt(ctx: PlanContext): string {
  const record = ctx.detail_request?.record_line?.trim();
  const recordLine = record
    ? `State this from the record, and no other time, date, place, amount, or name: ${record}`
    : "If a requested detail is not in the allowed sources, say only that you will confirm and follow up.";
  return `Draft the message the parent is sending to their co-parent, responding to what the co-parent said. Do not commit to unapproved calendar changes.
Write plain declarative sentences. No exclamation point. No "actually", "just a heads-up", "just so you know", or "FYI".
State only facts from the allowed sources. Do not supply a time, date, place, amount, or name that is not in those sources. Do not claim that anyone checked, confirmed, looked up, verified, or spoke to anyone.
${recordLine}
Context summary: ${ctx.summary}
Item type: ${ctx.item_type}
Domain: ${ctx.domain}`;
}

type RetainFacts = {
  draft: string;
  guidance: string;
  event?: string | null;
  child?: string | null;
};

function draftProblems(
  text: string,
  sources: string,
  retain: RetainFacts | undefined,
  userAsked: string
): string[] {
  return [
    ...unsupportedFacts(text, sources),
    ...voiceProblems(text, userAsked),
    ...(retain ? droppedFactLabels(text, retain.draft, retain.guidance).map((label) => `dropped ${label}`) : []),
  ];
}

/**
 * Two generations at most. A draft that invents a fact, drops a kept fact,
 * or breaks the voice rules is not returned.
 */
async function draftCheckedOutbound(
  userPrompt: string,
  sources: string,
  opts?: { retain?: RetainFacts; userAsked?: string }
): Promise<string> {
  const allowed = sources.trim() || "(none)";
  const userAsked = opts?.userAsked ?? "";
  const base = `${userPrompt}\n\nAllowed sources (the only facts you may use):\n${allowed}`;
  const first = await callAnthropicDraft(base, OUTBOUND_DRAFT_SYSTEM);
  const firstMissing = first ? draftProblems(first, sources, opts?.retain, userAsked) : null;
  if (first && firstMissing && firstMissing.length === 0) return first;
  if (first && firstMissing && firstMissing.length > 0) {
    console.error("[sage/outbound] draft rejected", {
      draft: first,
      missing: firstMissing,
    });
  }
  const retryPrompt = first
    ? `${base}\n\nThe previous draft was rejected: ${firstMissing?.join("; ")}. Keep every fact already in the current draft unless the user retracted it, and add the new fact. An arrival time does not replace a start time. No exclamation points. No "actually", "just a heads-up", "just so you know", or "FYI". Write declarative sentences. If a requested detail is missing from the sources, say only that you will confirm and follow up.`
    : base;
  const second = await callAnthropicDraft(retryPrompt, OUTBOUND_DRAFT_SYSTEM);
  const secondMissing = second ? draftProblems(second, sources, opts?.retain, userAsked) : null;
  if (second && secondMissing && secondMissing.length === 0) return second;
  console.error("[sage/outbound] fact check failed twice; fallback", {
    draft: second ?? first,
    missing: secondMissing ?? firstMissing ?? ["no draft"],
  });
  if (opts?.retain) {
    const accumulated = composeFactualReply({
      currentDraft: opts.retain.draft,
      guidance: opts.retain.guidance,
      event: opts.retain.event,
      child: opts.retain.child,
    });
    if (accumulated && draftProblems(accumulated, sources, opts.retain, "").length === 0) {
      return accumulated;
    }
  }
  return NO_DETAIL_REPLY;
}

async function draftWithLlm(
  kind: "ask_clarification" | "reply_coparent",
  ctx: PlanContext,
  fallback: string
): Promise<string> {
  const blocker = describeBlockers(ctx);
  const userPrompt =
    kind === "ask_clarification"
      ? userCommand(ctx)
        ? `Draft ONE short calm question asking the parent (who just told Sage this) for the missing detail. Address them as "you". Do not ask Co-Parent.
Context summary: ${ctx.summary}
What needs clarifying: ${blocker}
Unresolved children: ${ctx.unresolved_children.join(", ") || "(none)"}
Unclear dates: ${ctx.resolved_dates
  .filter((d) => d.status === "needs_clarification")
  .map((d) => d.raw)
  .join(", ") || "(none)"}`
        : `Draft ONE short calm question the parent is sending to their co-parent, asking for the missing detail.
State only facts from the allowed sources. Do not supply a time, date, place, amount, or name that is not in those sources.
Context summary: ${ctx.summary}
What needs clarifying: ${blocker}
Unresolved children: ${ctx.unresolved_children.join(", ") || "(none)"}
Unclear dates: ${ctx.resolved_dates
  .filter((d) => d.status === "needs_clarification")
  .map((d) => d.raw)
  .join(", ") || "(none)"}`
      : replyPrompt(ctx);

  const outbound =
    kind === "reply_coparent" || (kind === "ask_clarification" && !userCommand(ctx));
  if (outbound) return draftCheckedOutbound(userPrompt, ctx.outbound_sources ?? "");
  const first = await callAnthropicDraft(userPrompt, DRAFT_SYSTEM);
  if (first) return first;
  const second = await callAnthropicDraft(userPrompt, DRAFT_SYSTEM);
  if (second) return second;
  return fallback;
}

/**
 * Redraft a reply/clarification with optional user guidance. Returns text only — does not persist.
 */
export async function redraftMessage(params: {
  summary: string;
  proposalType: "reply_coparent" | "ask_clarification";
  currentDraft: string;
  guidance: string;
  /** Item source. A chat clarification is Sage asking the parent; any other clarification is outbound. */
  sourceType?: string | null;
  /** parent = Sage asking the user. That question is not an outbound draft. */
  audience?: "parent" | "coparent" | null;
  /** Inbound message, conversation, and ledger lines. The current draft is added as a source of facts already stated. */
  sources?: string | null;
  event?: string | null;
  child?: string | null;
}): Promise<string | null> {
  const parentFacingClarification = isParentFacingQuestion(
    { type: params.proposalType, audience: params.audience },
    params.sourceType
  );
  const kindLabel = parentFacingClarification
    ? "clarification question to the parent"
    : params.proposalType === "ask_clarification"
      ? "clarification the parent is sending to their co-parent"
      : "message the parent is sending to their co-parent";
  const guidance = params.guidance.trim() || "(no specific guidance — improve clarity and calm tone)";
  const who = params.child?.trim() ? `Child: ${params.child.trim()}` : "";
  const event = params.event?.trim() ? `Event: ${params.event.trim()}` : "";
  const userPrompt = `Redraft this ${kindLabel}.
Keep every fact already in the current draft. Add facts from the user guidance.
An arrival time does not replace a start time. Remove a fact only when the guidance corrects or retracts it, such as "not 8" or "instead of 8pm".
Write plain declarative sentences. No exclamation point. No "actually", "just a heads-up", "just so you know", or "FYI".
${who}
${event}
Context summary: ${params.summary}
Current draft: ${params.currentDraft}
User guidance: ${guidance}`;
  if (parentFacingClarification) {
    const first = await callAnthropicDraft(userPrompt, DRAFT_SYSTEM);
    if (first) return first;
    return callAnthropicDraft(userPrompt, DRAFT_SYSTEM);
  }
  const sources = [params.sources, params.currentDraft, guidance]
    .filter((part) => part && part.trim())
    .join("\n");
  return draftCheckedOutbound(userPrompt, sources, {
    retain: {
      draft: params.currentDraft,
      guidance,
      event: params.event,
      child: params.child,
    },
    userAsked: guidance,
  });
}

/**
 * Produce a Plan of proposals. Deterministic routing; LLM only drafts ask/reply text.
 */
export async function plan(ctx: PlanContext): Promise<Plan> {
  if (ctx.detail_request && !userCommand(ctx)) {
    if (ctx.detail_request.record_line) {
      const replyDraft = await draftWithLlm("reply_coparent", ctx, NO_DETAIL_REPLY);
      return {
        status: "ready",
        proposals: [proposal("reply_coparent", replyDraft, null)],
        reasoning:
          "Co-parent asked for a detail that is in the case record. The reply states that record.",
      };
    }
    console.log(
      "[sage/outbound] detail missing; asking the parent",
      JSON.stringify({ question: ctx.detail_request.question })
    );
    return {
      status: "awaiting_clarification",
      proposals: [
        proposal("ask_clarification", ctx.detail_request.question, null, {
          audience: "parent",
        }),
        proposal("reply_coparent", NO_DETAIL_REPLY, ctx.detail_request.question),
      ],
      reasoning:
        "Co-parent asked for a detail that is not in the message, the conversation, or the case records. Asked the parent and did not guess.",
    };
  }

  const dateBlocked = ctx.resolved_dates.some((d) => d.status === "needs_clarification");
  const childBlocked = ctx.unresolved_children.length > 0;
  const blocked = dateBlocked || childBlocked;
  // A completed expense does not wait on the date of a field trip or appointment.
  const expenseWithoutDateGate = ctx.item_type === "expense" && !childBlocked;

  // Inbound item Understanding could not classify confidently.
  if (ctx.item_type === "needs_review" && !userCommand(ctx)) {
    if (ctx.has_attachments) {
      return {
        status: "ready",
        proposals: [proposal("log_document", templateReviewDocument(ctx), null)],
        reasoning:
          "Needs review and a document arrived — propose filing it so a person can look.",
      };
    }
    const replyDraft = await draftWithLlm(
      "reply_coparent",
      ctx,
      fallbackReply(ctx)
    );
    return {
      status: "ready",
      proposals: [proposal("reply_coparent", replyDraft, null)],
      reasoning: "Needs review — propose a reply so a person can look.",
    };
  }

  // 2. Informational → no_action
  if (isInformational(ctx)) {
    return {
      status: "no_action",
      proposals: [proposal("note_only", templateNote(ctx))],
      reasoning:
        "Informational item — no tool action; note for awareness only.",
    };
  }

  // 3. action_required false (non-informational) → no_action
  if (!ctx.action_required) {
    return {
      status: "no_action",
      proposals: [proposal("note_only", templateNote(ctx))],
      reasoning: "action_required is false — no proposal beyond a note.",
    };
  }

  // 4. Blocked → awaiting_clarification. An expense with only an unclear activity date is not blocked.
  if (blocked && !expenseWithoutDateGate) {
    const askCtx =
      ctx.item_type === "expense"
        ? {
            ...ctx,
            resolved_dates: ctx.resolved_dates.filter((d) => d.status !== "needs_clarification"),
          }
        : ctx;
    const depends = describeBlockers(askCtx);
    const askDraft = await draftWithLlm(
      "ask_clarification",
      askCtx,
      fallbackAsk(askCtx)
    );
    const proposals: Proposal[] = [
      proposal("ask_clarification", askDraft, null),
    ];

    if (!userCommand(ctx)) {
      const replyDraft = await draftWithLlm(
        "reply_coparent",
        ctx,
        fallbackReply(ctx)
      );
      proposals.push(proposal("reply_coparent", replyDraft, depends));
    }

    if (isScheduleType(ctx.item_type) && resolvedCalendarIso(ctx)) {
      proposals.push(
        proposal("calendar_update", templateCalendar(ctx), depends)
      );
    } else if (ctx.item_type === "expense" && userCommand(ctx)) {
      const childNeed = childBlocked
        ? `clarification of child (${ctx.unresolved_children.join(", ")})`
        : null;
      proposals.push(proposal("log_expense", templateExpense(ctx), childNeed));
    }

    return {
      status: "awaiting_clarification",
      proposals,
      reasoning: `Blocked on ${depends}; draft clarification first, then gated downstream proposals.`,
    };
  }

  // 5. Schedule / calendar → ready. No resolved date: ask, do not invent one.
  if (isScheduleType(ctx.item_type)) {
    if (!resolvedCalendarIso(ctx)) {
      const proposals: Proposal[] = [askForCalendarDate()];
      if (!userCommand(ctx)) {
        const replyDraft = await draftWithLlm(
          "reply_coparent",
          ctx,
          fallbackReply(ctx)
        );
        proposals.unshift(proposal("reply_coparent", replyDraft, null));
      }
      return {
        status: "awaiting_clarification",
        proposals,
        reasoning: "No date resolved from the message — ask before proposing a calendar change.",
      };
    }
    if (userCommand(ctx)) {
      return {
        status: "ready",
        proposals: [
          proposal("calendar_update", templateCalendar(ctx), null),
        ],
        reasoning:
          "User command — calendar update on the user's own calendar; no co-parent agreement gate.",
      };
    }
    const replyDraft = await draftWithLlm(
      "reply_coparent",
      ctx,
      fallbackReply(ctx)
    );
    return {
      status: "ready",
      proposals: [
        proposal("reply_coparent", replyDraft, null),
        proposal(
          "calendar_update",
          templateCalendar(ctx),
          "co-parent agreement"
        ),
      ],
      reasoning:
        "Schedule change is unambiguous — propose reply, then calendar update after agreement.",
    };
  }

  // 6. Expense → ready, unless the sharing rule still has to be chosen.
  if (ctx.item_type === "expense") {
    if (userCommand(ctx)) {
      const share = ctx.expense_allocation?.other_parent_share;
      const involved = coparentShareInvolves(share);
      const notify = ctx.expense_allocation?.notify_coparent === true;
      return {
        status: "ready",
        proposals: [proposal("log_expense", templateExpense(ctx), null)],
        reasoning:
          involved
            ? "User command — log expense; co-parent has a plan share so they will be asked to respond."
            : notify
              ? "User command — log expense for records and notify Co-Parent at the user's request (share is $0)."
              : "User command — log expense for the user's records; co-parent share is $0 so no notification.",
      };
    }
    const proposals: Proposal[] = [
      proposal("log_expense", templateExpense(ctx), null),
    ];
    // Inbound receipt/notice — a brief reply is often warranted
    const replyDraft = await draftWithLlm(
      "reply_coparent",
      ctx,
      fallbackReply(ctx)
    );
    proposals.push(proposal("reply_coparent", replyDraft, null));
    return {
      status: "ready",
      proposals,
      reasoning: "Expense item — propose logging and a brief acknowledgement.",
    };
  }

  // Inbound message that needs a reply, and is not a schedule or expense item.
  if (
    !userCommand(ctx) &&
    ctx.action_required &&
    ctx.action_type === "respond"
  ) {
    const replyDraft = await draftWithLlm(
      "reply_coparent",
      ctx,
      fallbackReply(ctx)
    );
    return {
      status: "ready",
      proposals: [proposal("reply_coparent", replyDraft, null)],
      reasoning:
        "Inbound message requires a response — propose a reply to Co-Parent.",
    };
  }

  // 7. Default
  return {
    status: "no_action",
    proposals: [proposal("note_only", templateNote(ctx))],
    reasoning: "No matching action route — note only.",
  };
}
