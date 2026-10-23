import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMessageIntakeEvidence } from "@/lib/messages/intake-evidence";
import { loadOwnerMailboxes } from "@/lib/messages/owner-mailboxes";
import {
  correctIntakeProposals,
  correctIntakeText,
  senderIsAccountOwner,
} from "@/lib/sage/intake-facts";

type ItemTurn = {
  id: string;
  source_type?: string | null;
  source_id?: string | null;
  summary?: string | null;
  plan?: { proposals?: unknown[] } | null;
};

export async function dismissStaleIntakeProposals(
  admin: SupabaseClient,
  input: {
    userId: string;
    userEmail?: string | null;
    caseId: string;
    items: ItemTurn[];
  }
): Promise<void> {
  const ids = [
    ...new Set(
      input.items
        .filter((item) => item.source_type === "message" && item.source_id)
        .map((item) => item.source_id as string)
    ),
  ];
  if (ids.length === 0) return;
  const [evidence, mailboxes] = await Promise.all([
    loadMessageIntakeEvidence(admin, ids),
    loadOwnerMailboxes(admin, input.caseId, input.userId),
  ]);
  const ownerEmails = [...mailboxes];
  const login = (input.userEmail ?? "").trim().toLowerCase();
  if (login && !ownerEmails.includes(login)) ownerEmails.push(login);

  for (const item of input.items) {
    if (item.source_type !== "message" || !item.source_id) continue;
    const source = evidence.get(item.source_id);
    if (!source) continue;
    const ownMessage = senderIsAccountOwner({
      senderId: source.senderId,
      senderEmail: source.senderEmail,
      ownerId: input.userId,
      ownerEmails,
    });
    const plan = planOf(item);
    if (!plan) continue;
    const corrected = correctIntakeProposals(plan.proposals, {
      storedFileNames: source.files.map((file) => file.filename),
      ownMessage,
    });
    if (!corrected.changed) continue;
    const nextPlan = { ...plan, proposals: corrected.proposals };
    item.plan = nextPlan;
    await admin
      .from("sage_items")
      .update({ plan: nextPlan })
      .eq("id", item.id)
      .eq("visible_to", input.userId);
  }
}

type Turn = {
  id: string;
  role: string;
  content: string;
  sage_item_id?: string | null;
  source_message_ids?: string[];
  source_own_message?: boolean;
  sage_item?: unknown | null;
};

function planOf(item: unknown): { proposals: Record<string, unknown>[] } | null {
  if (!item || typeof item !== "object") return null;
  const plan = (item as { plan?: unknown }).plan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  const proposals = (plan as { proposals?: unknown }).proposals;
  if (!Array.isArray(proposals)) return { proposals: [] };
  return {
    ...(plan as { proposals: Record<string, unknown>[] }),
    proposals: proposals.filter((proposal): proposal is Record<string, unknown> =>
      Boolean(proposal) && typeof proposal === "object" && !Array.isArray(proposal)
    ),
  };
}

/**
 * Use the saved message and its files as the authority.
 * Dismisses a stale co-parent reply on the Sage item. Does not delete the message or the file.
 */
export async function applyStoredIntake(
  admin: SupabaseClient,
  input: {
    userId: string;
    userEmail?: string | null;
    caseId: string | null;
    messages: Turn[];
  }
): Promise<void> {
  const ids = [
    ...new Set(input.messages.flatMap((message) => message.source_message_ids ?? [])),
  ];
  if (ids.length === 0 || !input.caseId) return;
  const [evidence, mailboxes] = await Promise.all([
    loadMessageIntakeEvidence(admin, ids),
    loadOwnerMailboxes(admin, input.caseId, input.userId),
  ]);
  const ownerEmails = [...mailboxes];
  const login = (input.userEmail ?? "").trim().toLowerCase();
  if (login && !ownerEmails.includes(login)) ownerEmails.push(login);

  for (const message of input.messages) {
    if (message.role !== "sage") continue;
    const linked = message.source_message_ids ?? [];
    if (linked.length === 0) continue;
    const files = linked.flatMap((id) => evidence.get(id)?.files ?? []);
    const ownMessage = linked.some((id) => {
      const source = evidence.get(id);
      if (!source) return false;
      return senderIsAccountOwner({
        senderId: source.senderId,
        senderEmail: source.senderEmail,
        ownerId: input.userId,
        ownerEmails,
      });
    });
    message.source_own_message = ownMessage;
    const item = message.sage_item;
    const plan = planOf(item);
    const corrected = plan
      ? correctIntakeProposals(plan.proposals, {
          storedFileNames: files.map((file) => file.filename),
          ownMessage,
        })
      : null;
    let content = correctIntakeText(message.content, { stored: files, ownMessage });
    const activeReply = corrected?.proposals.some((proposal) => {
      const status = typeof proposal.status === "string" ? proposal.status.toLowerCase() : "";
      return proposal.type === "reply_coparent" && status !== "dismissed" && status !== "superseded";
    });
    if (corrected && !activeReply) {
      content = content.replace(/\s*A reply is ready for you to review\.?/gi, " ").replace(/\s{2,}/g, " ").trim();
    }
    const summary =
      item && typeof item === "object"
        ? correctIntakeText(String((item as { summary?: string }).summary ?? ""), {
            stored: files,
            ownMessage,
          })
        : "";
    if (content !== message.content) {
      message.content = content;
      await admin
        .from("sage_journal_messages")
        .update({ content })
        .eq("id", message.id)
        .eq("user_id", input.userId);
    }
    if (corrected?.changed && item && typeof item === "object" && message.sage_item_id) {
      const nextPlan = { ...plan, proposals: corrected.proposals };
      (item as { plan?: unknown; summary?: string }).plan = nextPlan;
      if (summary) (item as { summary?: string }).summary = summary;
      await admin
        .from("sage_items")
        .update({ plan: nextPlan, ...(summary ? { summary } : {}) })
        .eq("id", message.sage_item_id)
        .eq("visible_to", input.userId);
    }
  }
}
