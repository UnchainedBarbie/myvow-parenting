/**
 * Sage Engine — Planner layer.
 * Decides and drafts proposals. NEVER executes (no calendar writes, no email).
 * Sage proposes; humans approve.
 */

import { isUserCommand } from "@/lib/sage/observation-builder";
import { coparentShareInvolves } from "@/lib/expenses-share";

const SAGE_MODEL = "claude-sonnet-4-6";

export type PlanContext = {
  item_type: string;
  domain: string;
  action_required: boolean;
  summary: string;
  child_ids: string[];
  unresolved_children: string[];
  resolved_dates: { raw: string; status: string; iso: string | null }[];
  sender: string;
  /** Adapter source ("chat" | "email"). Chat = user command on own records. */
  source_type?: string;
  /** Plan-driven co-parent share for expense items, if computed. */
  expense_allocation?: {
    other_parent_share: number | null;
    allocation_status?: string;
    notify_coparent?: boolean;
  };
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
  /** Classify fields carried on a log_document proposal. */
  title?: string;
  description?: string;
  category?: string;
  date?: string | null;
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

function proposal(
  type: Proposal["type"],
  draft: string,
  depends_on: string | null = null
): Proposal {
  return { type, draft, depends_on, requires_approval: true };
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
  const shareLabel =
    involved && share != null
      ? `$${share.toFixed(2)} will be Co-Parent's share per your plan`
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
    if (notify) {
      return `${base} for your records. You'll notify Co-Parent even though their share is $0.`;
    }
    return `${base} for your records.`;
  }
  return `Propose logging expense from Co-Parent: ${summary || "expense shared by Co-Parent"}.`;
}

function fallbackAsk(ctx: PlanContext): string {
  const unclear = ctx.resolved_dates.find((d) => d.status === "needs_clarification");
  if (unclear) {
    return `Could you confirm which exact date you mean by "${unclear.raw}"?`;
  }
  if (ctx.unresolved_children.length > 0) {
    return `Could you confirm which child this is about (${ctx.unresolved_children.join(", ")})?`;
  }
  return "Could you share a bit more detail so Sage can help accurately?";
}

function fallbackReply(ctx: PlanContext): string {
  return `Thanks for letting me know — I'm aligning with this: ${ctx.summary.trim() || "your update"}.`;
}

export async function callAnthropicDraft(userPrompt: string): Promise<string | null> {
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
        system: DRAFT_SYSTEM,
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
        : `Draft ONE short calm question asking Co-Parent for clarification.
Context summary: ${ctx.summary}
What needs clarifying: ${blocker}
Unresolved children: ${ctx.unresolved_children.join(", ") || "(none)"}
Unclear dates: ${ctx.resolved_dates
  .filter((d) => d.status === "needs_clarification")
  .map((d) => d.raw)
  .join(", ") || "(none)"}`
      : `Draft ONE short calm reply acknowledging Co-Parent's message and aligning with the plan (not committing to unapproved calendar changes).
Context summary: ${ctx.summary}
Item type: ${ctx.item_type}
Domain: ${ctx.domain}`;

  const first = await callAnthropicDraft(userPrompt);
  if (first) return first;
  // one retry — same pattern as Understanding
  const second = await callAnthropicDraft(userPrompt);
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
}): Promise<string | null> {
  const kindLabel =
    params.proposalType === "ask_clarification"
      ? "clarification question to Co-Parent"
      : "reply to Co-Parent";
  const guidance = params.guidance.trim() || "(no specific guidance — improve clarity and calm tone)";
  const userPrompt = `Redraft this ${kindLabel} as ONE short calm sentence.
Context summary: ${params.summary}
Current draft: ${params.currentDraft}
User guidance for the rewrite: ${guidance}`;

  const first = await callAnthropicDraft(userPrompt);
  if (first) return first;
  const second = await callAnthropicDraft(userPrompt);
  return second;
}

/**
 * Produce a Plan of proposals. Deterministic routing; LLM only drafts ask/reply text.
 */
export async function plan(ctx: PlanContext): Promise<Plan> {
  const blocked =
    ctx.resolved_dates.some((d) => d.status === "needs_clarification") ||
    ctx.unresolved_children.length > 0;

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

  // 4. Blocked → awaiting_clarification
  if (blocked) {
    const depends = describeBlockers(ctx);
    const askDraft = await draftWithLlm(
      "ask_clarification",
      ctx,
      fallbackAsk(ctx)
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

    if (isScheduleType(ctx.item_type)) {
      proposals.push(
        proposal("calendar_update", templateCalendar(ctx), depends)
      );
    } else if (ctx.item_type === "expense" && userCommand(ctx)) {
      proposals.push(proposal("log_expense", templateExpense(ctx), depends));
    }

    return {
      status: "awaiting_clarification",
      proposals,
      reasoning: `Blocked on ${depends}; draft clarification first, then gated downstream proposals.`,
    };
  }

  // 5. Schedule / calendar → ready
  if (isScheduleType(ctx.item_type)) {
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

  // 6. Expense → ready
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

  // 7. Default
  return {
    status: "no_action",
    proposals: [proposal("note_only", templateNote(ctx))],
    reasoning: "No matching action route — note only.",
  };
}
