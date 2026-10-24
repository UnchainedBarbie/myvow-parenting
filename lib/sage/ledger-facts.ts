/**
 * Case-ledger lines an outbound draft is allowed to repeat.
 * Calendar matching is the same check used before a calendar proposal.
 */

import {
  eventWordsOverlap,
  findMatchingEvents,
  type CalendarFact,
} from "@/lib/sage/calendar-match";
import type { ConversationContext } from "@/lib/sage/conversation-context";
import { soleFactLabel, type DetailQuestion } from "@/lib/sage/outbound-facts";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { expenseVisibleToViewer, readExpenses, storedExpenseVisibility } from "@/lib/expenses-visibility";

export type LedgerLookup = {
  caseId: string;
  timezone: string;
  iso: string | null;
  childIds: string[];
  corpus: string;
  subject?: string | null;
  /** When set, private expenses belonging to someone else are left out. */
  viewerId?: string | null;
  viewerRole?: string | null;
};

function sameSubject(asked: string | null, established: string | null): boolean {
  if (!asked || !established) return false;
  const left = asked.toLowerCase();
  const right = established.toLowerCase();
  return left === right || left.includes(right) || right.includes(left);
}

function calendarLine(fact: CalendarFact): string {
  const bits = [fact.title, fact.dateLabel, fact.timeLabel, fact.description].filter(Boolean);
  return bits.join(" · ");
}

function recordFromCalendar(asked: DetailQuestion, fact: CalendarFact): string | null {
  const name = fact.title.trim() || asked.subject || "the event";
  if (asked.kind === "time") {
    return fact.timeLabel ? `${name} is at ${fact.timeLabel}.` : null;
  }
  if (asked.kind === "date") {
    return fact.dateLabel ? `${name} is on ${fact.dateLabel}.` : null;
  }
  if (asked.kind === "place") {
    return fact.description ? `${name} is at ${fact.description}.` : null;
  }
  return null;
}

function recordFromConversation(
  asked: DetailQuestion,
  conversation: ConversationContext | null
): string | null {
  const event = conversation?.event;
  if (!event) return null;
  if (!sameSubject(asked.subject, event.subject)) return null;
  const name = event.subject?.trim() || asked.subject || "the event";
  if (asked.kind === "time" && event.time) return `${name} is at ${event.time}.`;
  if (asked.kind === "date" && event.date) return `${name} is on ${event.date}.`;
  return null;
}

async function matchingMoney(
  caseId: string,
  corpus: string,
  viewerId: string | null,
  viewerRole: string | null
): Promise<string | null> {
  const admin = getServiceRoleClient();
  const loaded = await readExpenses(
    (columns) =>
      admin
        .from("expenses")
        .select(columns)
        .eq("case_id", caseId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(40),
    "description, amount"
  );
  if (loaded.error) {
    console.error("[sage/outbound] expense lookup failed:", loaded.error.message);
    return null;
  }
  const visible = loaded.rows.filter((row) => {
    if (viewerId) {
      return expenseVisibleToViewer(row, { userId: viewerId, role: viewerRole ?? "parent" });
    }
    const raw = typeof row.visibility === "string" ? row.visibility.trim() : "";
    const stored = storedExpenseVisibility(raw);
    return !raw || stored === "parents_only" || stored === "family";
  });
  const hits = (visible as { description?: string | null; amount?: number | string | null }[])
    .filter((row) => eventWordsOverlap(corpus, row.description ?? ""))
    .map((row) => {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) return null;
      const description = (row.description ?? "Expense").trim() || "Expense";
      return `${description} is $${amount.toFixed(2)}.`;
    })
    .filter((line): line is string => !!line);
  const unique = [...new Set(hits)];
  return unique.length === 1 ? unique[0] : null;
}

async function matchingDocumentLine(caseId: string, corpus: string): Promise<string | null> {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("documents")
    .select("file_name, description")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) {
    console.error("[sage/outbound] document lookup failed:", error.message);
    return null;
  }
  const hits = ((data ?? []) as { file_name?: string | null; description?: string | null }[])
    .map((row) => {
      const name = (row.file_name ?? "").trim();
      const description = (row.description ?? "").trim();
      const line = [name, description].filter(Boolean).join(". ");
      return line && eventWordsOverlap(corpus, line) ? line : null;
    })
    .filter((line): line is string => !!line);
  const unique = [...new Set(hits)];
  return unique.length === 1 ? unique[0] : null;
}

/**
 * Lines from the one matching calendar event, or the one matching expense when
 * the question is about an amount. Several matches contribute nothing — no guess.
 */
export async function matchingLedgerText(input: LedgerLookup): Promise<string> {
  const events = await findMatchingEvents({
    caseId: input.caseId,
    timezone: input.timezone,
    iso: input.iso ?? "",
    childIds: input.childIds,
    summary: input.subject ?? "",
    corpus: input.corpus,
    subject: input.subject ?? null,
  });
  const parts: string[] = [];
  if (events && events.length === 1) parts.push(calendarLine(events[0]));
  const money = await matchingMoney(
    input.caseId,
    `${input.corpus} ${input.subject ?? ""}`,
    input.viewerId ?? null,
    input.viewerRole ?? null
  );
  if (money) parts.push(money);
  const documentLine = await matchingDocumentLine(
    input.caseId,
    `${input.corpus} ${input.subject ?? ""}`
  );
  if (documentLine) parts.push(documentLine);
  return parts.join("\n");
}

export async function resolveAskedDetail(input: LedgerLookup & {
  asked: DetailQuestion;
  conversation?: ConversationContext | null;
}): Promise<{ recordLine: string | null; ledgerText: string }> {
  const events = await findMatchingEvents({
    caseId: input.caseId,
    timezone: input.timezone,
    iso: input.iso ?? "",
    childIds: input.childIds,
    summary: input.asked.subject ?? input.subject ?? "",
    corpus: input.corpus,
    subject: input.asked.subject ?? input.subject ?? null,
  });

  if (events != null && events.length > 1) {
    return { recordLine: null, ledgerText: "" };
  }

  if (events != null && events.length === 1) {
    const line = recordFromCalendar(input.asked, events[0]);
    if (line) return { recordLine: line, ledgerText: `${calendarLine(events[0])}\n${line}` };
  }

  const fromConversation = recordFromConversation(
    input.asked,
    input.conversation ?? null
  );
  if (fromConversation) {
    return { recordLine: fromConversation, ledgerText: fromConversation };
  }

  if (input.asked.kind === "amount") {
    const money = await matchingMoney(input.caseId, input.corpus, input.viewerId ?? null, input.viewerRole ?? null);
    if (money) return { recordLine: money, ledgerText: money };
  }

  const documentLine = await matchingDocumentLine(input.caseId, input.corpus);
  if (documentLine && input.asked.kind !== "place") {
    const label = soleFactLabel(
      documentLine,
      input.asked.kind === "amount" ? "amount" : input.asked.kind
    );
    if (label) return { recordLine: documentLine, ledgerText: documentLine };
  }
  if (documentLine && input.asked.kind === "place") {
    const description = documentLine.split(". ").slice(1).join(". ").trim();
    if (description) return { recordLine: description, ledgerText: documentLine };
  }

  return { recordLine: null, ledgerText: "" };
}
