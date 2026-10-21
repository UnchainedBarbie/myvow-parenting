import { isReplacedProposalError } from "@/lib/sage/proposal-lifecycle";

/** Ask the server whether this proposal is still the current version. */
export async function confirmProposalIsCurrent(
  itemId: string,
  proposalIndex: number
): Promise<string | null> {
  const res = await fetch("/api/sage-inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: itemId,
      action: "agree",
      proposal_indexes: [proposalIndex],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.ok) return null;
  if (res.status === 409 || isReplacedProposalError(data.error)) {
    return data.error || "This proposal was replaced. Use the current version.";
  }
  return data.error || "Couldn't confirm this proposal. Try again.";
}
