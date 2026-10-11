import type { ResolvedInboundSender } from "@/lib/messages/resolve-inbound-sender";

export type InboundIntakeDecision =
  | { authorized: false }
  | {
      authorized: true;
      branch: "self" | "coparent";
      caseMemberId: string;
      userId: string | null;
      fromEmail: string;
    };

/**
 * Whether this sender may enter intake.
 * Today the only route is a registered case-member address.
 * A later per-member forwarding address adds a route here and nowhere else.
 * Unknown means the sender is not authenticated. It does not mean auto-forwarded.
 */
export function authorizeInboundIntake(
  sender: ResolvedInboundSender,
  accountOwnerId: string
): InboundIntakeDecision {
  if (!sender.isKnownCaseMember || !sender.caseMemberId || !sender.fromEmail) {
    return { authorized: false };
  }
  return {
    authorized: true,
    branch: sender.userId === accountOwnerId ? "self" : "coparent",
    caseMemberId: sender.caseMemberId,
    userId: sender.userId,
    fromEmail: sender.fromEmail,
  };
}
