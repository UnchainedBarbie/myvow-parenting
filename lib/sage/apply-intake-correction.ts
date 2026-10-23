import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMessageIntakeEvidence } from "@/lib/messages/intake-evidence";
import { mailboxAddress } from "@/lib/messages/mailbox";
import { loadOwnerMailboxes } from "@/lib/messages/owner-mailboxes";
import { correctIntakeProposals, senderIsAccountOwner } from "@/lib/sage/intake-facts";
import { correctStoredIntakeTurn } from "@/lib/sage/stored-intake";
import type { SageAttachmentView } from "@/lib/sage/message-attachments";

type ItemTurn = {
  id: string;
  source_type?: string | null;
  source_id?: string | null;
  summary?: string | null;
  plan?: { proposals?: unknown[] } | null;
};

async function ownerAddresses(
  admin: SupabaseClient,
  userId: string,
  userEmail: string | null | undefined,
  caseIds: string[]
): Promise<string[]> {
  const found = new Set<string>();
  const login = mailboxAddress(userEmail);
  if (login) found.add(login);
  const lists = await Promise.all(
    [...new Set(caseIds.filter(Boolean))].map((caseId) => loadOwnerMailboxes(admin, caseId, userId))
  );
  for (const list of lists) {
    for (const email of list) found.add(email);
  }
  return [...found];
}

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
  const evidence = await loadMessageIntakeEvidence(admin, ids);
  const caseIds = [input.caseId];
  for (const source of evidence.values()) {
    if (source.caseId) caseIds.push(source.caseId);
  }
  const ownerEmails = await ownerAddresses(admin, input.userId, input.userEmail, caseIds);

  for (const item of input.items) {
    if (item.source_type !== "message" || !item.source_id) continue;
    const source = evidence.get(item.source_id);
    if (!source) continue;
    const ownMessage = senderIsAccountOwner({
      senderId: source.senderId,
      senderEmail: source.senderEmail,
      senderEmails: source.senderEmails,
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
  source_attachments?: SageAttachmentView[];
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
 * Use the saved message and its files as the authority when Sage is loaded.
 * Dismisses an incorrect co-parent reply. Does not delete the message or the file.
 */
export async function applyStoredIntake(
  admin: SupabaseClient,
  input: {
    userId: string;
    userEmail?: string | null;
    caseId: string | null;
    viewerRole?: string | null;
    messages: Turn[];
  }
): Promise<void> {
  const ids = [
    ...new Set(input.messages.flatMap((message) => message.source_message_ids ?? [])),
  ];
  if (ids.length === 0) return;
  const evidence = await loadMessageIntakeEvidence(admin, ids);
  const caseIds = input.caseId ? [input.caseId] : [];
  for (const source of evidence.values()) {
    if (source.caseId) caseIds.push(source.caseId);
  }
  const ownerEmails = await ownerAddresses(admin, input.userId, input.userEmail, caseIds);
  const viewer = { userId: input.userId, role: input.viewerRole ?? null };

  for (const message of input.messages) {
    if (message.role !== "sage") continue;
    const linked = message.source_message_ids ?? [];
    if (linked.length === 0) continue;
    const item = message.sage_item;
    const plan = planOf(item);
    const summary =
      item && typeof item === "object" ? String((item as { summary?: string }).summary ?? "") : "";
    const corrected = correctStoredIntakeTurn({
      content: message.content,
      summary,
      proposals: plan?.proposals ?? [],
      linkedMessageIds: linked,
      evidence,
      ownerId: input.userId,
      ownerEmails,
      viewer,
    });
    message.source_own_message = corrected.ownMessage;
    message.source_attachments = corrected.attachments;
    if (corrected.content !== message.content) {
      message.content = corrected.content;
      await admin
        .from("sage_journal_messages")
        .update({ content: corrected.content })
        .eq("id", message.id)
        .eq("user_id", input.userId);
    }
    if (item && typeof item === "object" && message.sage_item_id && plan) {
      const nextPlan = { ...plan, proposals: corrected.proposals };
      if (corrected.proposalsChanged) (item as { plan?: unknown }).plan = nextPlan;
      if (corrected.summary && corrected.summaryChanged) {
        (item as { summary?: string }).summary = corrected.summary;
      }
      if (corrected.proposalsChanged || corrected.summaryChanged) {
        await admin
          .from("sage_items")
          .update({
            ...(corrected.proposalsChanged ? { plan: nextPlan } : {}),
            ...(corrected.summary && corrected.summaryChanged ? { summary: corrected.summary } : {}),
          })
          .eq("id", message.sage_item_id)
          .eq("visible_to", input.userId);
      }
    }
  }
}
