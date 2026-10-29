import type { getServiceRoleClient } from "@/lib/supabase/server";
import { loadSessionItemIds } from "@/lib/sage/session-items";

type Admin = ReturnType<typeof getServiceRoleClient>;

export type CaseMembership = { case_id: string; role: string | null };

export type ActiveCase =
  | { status: "resolved"; caseId: string; role: string | null; via: "only_membership" | "requested" | "session" }
  /** The signed-in parent belongs to no case. */
  | { status: "none"; caseId: null; role: null }
  /** More than one case could apply and nothing in the request or session chooses between them. */
  | { status: "ambiguous"; caseId: null; role: null; caseIds: string[] }
  | { status: "error"; caseId: null; role: null; message: string };

/**
 * Choose the case from the signed-in parent's memberships, with no arbitrary pick.
 *
 *   1. A parent with one membership uses it.
 *   2. With several, a requested case id is honored only when the parent belongs to that case.
 *   3. Otherwise the case their chat session already works in decides, when it names exactly one
 *      of their cases.
 *   4. Anything else is ambiguous. The caller stops and asks, and no case is guessed.
 *
 * Pure choice lives in `chooseActiveCase`, so it can be tested without a database.
 */
export function chooseActiveCase(
  memberships: readonly CaseMembership[],
  hints: { requestedCaseId?: string | null; sessionCaseIds?: readonly string[] } = {}
): ActiveCase {
  const unique = new Map<string, CaseMembership>();
  for (const membership of memberships) {
    if (membership.case_id && !unique.has(membership.case_id)) unique.set(membership.case_id, membership);
  }
  const owned = [...unique.values()];
  if (owned.length === 0) return { status: "none", caseId: null, role: null };
  if (owned.length === 1) {
    return { status: "resolved", caseId: owned[0].case_id, role: owned[0].role, via: "only_membership" };
  }
  const requested = hints.requestedCaseId?.trim();
  if (requested && unique.has(requested)) {
    const picked = unique.get(requested)!;
    return { status: "resolved", caseId: picked.case_id, role: picked.role, via: "requested" };
  }
  const sessionCases = [...new Set((hints.sessionCaseIds ?? []).filter((id) => unique.has(id)))];
  if (sessionCases.length === 1) {
    const picked = unique.get(sessionCases[0])!;
    return { status: "resolved", caseId: picked.case_id, role: picked.role, via: "session" };
  }
  return { status: "ambiguous", caseId: null, role: null, caseIds: owned.map((m) => m.case_id).sort() };
}

/** The case ids that the parent's own items in this session belong to. */
async function sessionCaseIds(admin: Admin, sessionId: string, userId: string): Promise<string[]> {
  const itemIds = await loadSessionItemIds(admin, sessionId, userId);
  if (itemIds.length === 0) return [];
  const { data } = await admin
    .from("sage_items")
    .select("case_id")
    .in("id", itemIds)
    .eq("visible_to", userId);
  return [
    ...new Set(
      ((data ?? []) as { case_id?: string | null }[])
        .map((row) => row.case_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
}

export async function resolveActiveCase(
  admin: Admin,
  userId: string,
  hints: { requestedCaseId?: string | null; sessionId?: string | null } = {}
): Promise<ActiveCase> {
  const { data, error } = await admin.from("case_members").select("case_id, role").eq("user_id", userId);
  if (error) {
    return { status: "error", caseId: null, role: null, message: error.message ?? "case lookup failed" };
  }
  const memberships = ((data ?? []) as { case_id?: string | null; role?: string | null }[])
    .filter((row): row is { case_id: string; role?: string | null } => typeof row.case_id === "string")
    .map((row) => ({ case_id: row.case_id, role: row.role ?? null }));
  const first = chooseActiveCase(memberships, { requestedCaseId: hints.requestedCaseId });
  if (first.status !== "ambiguous" || !hints.sessionId) return first;
  const fromSession = await sessionCaseIds(admin, hints.sessionId, userId);
  return chooseActiveCase(memberships, {
    requestedCaseId: hints.requestedCaseId,
    sessionCaseIds: fromSession,
  });
}

export const AMBIGUOUS_CASE_MESSAGE =
  "Your account is linked to more than one case, so I cannot tell which one to use. Choose a case and try again.";
