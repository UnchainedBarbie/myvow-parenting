"use client";

import { useEffect, useState } from "react";
import { AddEventForm, type AddEventFormInitialValues } from "@/components/calendar/add-event-form";
import { DocumentDetailModal, type DocumentRow } from "@/components/documents/document-detail-modal";
import { ExpenseForm, type ExpenseFormInitialValues } from "@/components/expenses/expense-form";
import { ProposalCardList } from "@/components/sage/proposal-card-list";
import {
  sendOutcomeFromResponse,
  sendRequestFields,
  type ProposalSendRequest,
  type SendOutcome,
} from "@/lib/messages/proposal-send";
import {
  buildCalendarInitialValues,
  buildDocumentReviewRow,
  buildExpenseInitialValues,
  dateKey,
  isCalendarUpdateProposal,
  isFormExecuteProposal,
  isLogDocumentProposal,
  isLogExpenseProposal,
  needsDateField,
} from "@/components/sage/proposal-helpers";
import { SageAgreeFormModal } from "@/components/sage/sage-agree-form-modal";
import type { SageItem, SagePlan } from "@/components/sage/proposal-types";
import { confirmProposalIsCurrent } from "@/lib/sage/proposal-actions";
import { isReplacedProposalError } from "@/lib/sage/proposal-lifecycle";
import { Button } from "@/components/ui/button";
import { showErrorToast } from "@/components/ui/toaster";
import type { OpenItemView } from "@/lib/open-items";

type Child = { id: string; first_name: string };

type CalendarTarget = {
  item: SageItem;
  proposalIndex: number;
  initialValues: AddEventFormInitialValues;
  queue: number[];
};

type ExpenseTarget = {
  item: SageItem;
  proposalIndex: number;
  initialValues: ExpenseFormInitialValues;
  queue: number[];
};

type DocumentTarget = {
  item: SageItem;
  proposalIndex: number;
  document: DocumentRow;
  queue: number[];
};

export function OpenItemReview({
  entry,
  caseId,
  children,
  onChanged,
}: {
  entry: OpenItemView;
  caseId: string | null;
  children: Child[];
  onChanged: () => void;
}) {
  const [item, setItem] = useState<SageItem | null>(entry.item);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [calendarAgree, setCalendarAgree] = useState<CalendarTarget | null>(null);
  const [expenseAgree, setExpenseAgree] = useState<ExpenseTarget | null>(null);
  const [documentAgree, setDocumentAgree] = useState<DocumentTarget | null>(null);

  useEffect(() => {
    setItem(entry.item);
  }, [entry]);

  if (!item || entry.proposalIndex == null) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2">
        <p className="text-sm text-foreground">{entry.explanation}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 rounded-full px-3 text-[11px]"
          onClick={() => void dismissItem(entry.sageItemId, onChanged)}
        >
          Dismiss
        </Button>
      </div>
    );
  }

  const proposals = item.plan?.proposals ?? [];
  const focus = entry.proposalIndex;

  function patchPlan(plan: SagePlan) {
    setItem((current) => (current ? { ...current, plan } : current));
    onChanged();
  }

  async function postAction(
    action: "agree" | "dismiss" | "undo",
    indexes: number[],
    send?: ProposalSendRequest
  ): Promise<SendOutcome | void> {
    if (!item || indexes.length === 0) return;
    setBusyKey(indexes.length === 1 ? `${item.id}:${indexes[0]}` : `${item.id}:multi`);
    try {
      const datesPayload = action === "agree" ? datesFor(item, indexes, dates) : undefined;
      const res = await fetch("/api/sage-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          action,
          proposal_indexes: indexes,
          ...(datesPayload ? { dates: datesPayload } : {}),
          ...sendRequestFields(send),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { plan?: SagePlan; error?: string; code?: string };
      if (!res.ok) {
        // A reviewed send reports its problem inside the review panel.
        if (!send) showErrorToast(data.error || "Couldn't update that item.");
        return sendOutcomeFromResponse(res, data);
      }
      if (data.plan) patchPlan(data.plan);
      else onChanged();
      return { ok: true };
    } catch {
      if (!send) showErrorToast("Couldn't update that item.");
      return { ok: false, error: "The message was not sent. Check your connection and try again." };
    } finally {
      setBusyKey(null);
    }
  }

  async function openForm(proposalIndex: number, queue: number[] = []) {
    if (!item) return;
    if (!caseId) {
      showErrorToast("Couldn't open the form — no case found.");
      return;
    }
    const proposal = item.plan?.proposals?.[proposalIndex];
    if (!proposal) return;
    const storedEventId =
      typeof proposal.result_event_id === "string" ? proposal.result_event_id.trim() : "";
    const storedExpenseId =
      typeof proposal.result_expense_id === "string" ? proposal.result_expense_id.trim() : "";
    const storedDocumentId =
      typeof proposal.result_document_id === "string" ? proposal.result_document_id.trim() : "";
    if (
      (isCalendarUpdateProposal(proposal.type) && storedEventId) ||
      (isLogExpenseProposal(proposal.type) && storedExpenseId) ||
      (isLogDocumentProposal(proposal.type) && storedDocumentId)
    ) {
      void markExecuted(proposalIndex, {
        ...(storedEventId ? { event_id: storedEventId } : {}),
        ...(storedExpenseId ? { expense_id: storedExpenseId } : {}),
        ...(storedDocumentId
          ? { document_id: storedDocumentId, filed_title: proposal.title ?? "" }
          : {}),
      });
      return;
    }
    const replaced = await confirmProposalIsCurrent(item.id, proposalIndex);
    if (replaced) {
      showErrorToast(replaced);
      onChanged();
      return;
    }
    const chosen =
      (dates[dateKey(item.id, proposalIndex)] ?? "").trim() || proposal.chosen_date || "";
    if (isCalendarUpdateProposal(proposal.type)) {
      setExpenseAgree(null);
      setDocumentAgree(null);
      setCalendarAgree({
        item,
        proposalIndex,
        initialValues: buildCalendarInitialValues(item, proposal, chosen || undefined),
        queue,
      });
      return;
    }
    if (isLogExpenseProposal(proposal.type)) {
      setCalendarAgree(null);
      setDocumentAgree(null);
      setExpenseAgree({
        item,
        proposalIndex,
        initialValues: buildExpenseInitialValues(item, proposal, chosen || undefined),
        queue,
      });
      return;
    }
    if (isLogDocumentProposal(proposal.type)) {
      const row = buildDocumentReviewRow(
        item,
        proposal,
        children.map((child) => ({ id: child.id, name: child.first_name }))
      );
      if (!row) {
        showErrorToast("Couldn't open the document — no file is attached.");
        return;
      }
      setCalendarAgree(null);
      setExpenseAgree(null);
      setDocumentAgree({ item, proposalIndex, document: row, queue });
    }
  }

  async function markExecuted(
    proposalIndex: number,
    ids: { event_id?: string; expense_id?: string; document_id?: string; filed_title?: string }
  ) {
    if (!item) return;
    const res = await fetch("/api/sage-inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        action: "execute",
        proposal_index: proposalIndex,
        ...ids,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { plan?: SagePlan; error?: string };
    if (!res.ok || !data.plan) {
      if (isReplacedProposalError(data.error)) {
        showErrorToast(data.error || "This proposal was replaced. Use the current version.");
        onChanged();
        setCalendarAgree(null);
        setExpenseAgree(null);
        setDocumentAgree(null);
        return;
      }
      await recordSaveFailure(item.id, proposalIndex, ids, data.error);
      showErrorToast(data.error || "Saved, but Sage couldn't mark it done. Use Retry save.");
      onChanged();
      setCalendarAgree(null);
      setExpenseAgree(null);
      setDocumentAgree(null);
      return;
    }
    setItem({ ...item, plan: data.plan });
    setCalendarAgree(null);
    setExpenseAgree(null);
    setDocumentAgree(null);
    onChanged();
  }

  return (
    <div className="mt-2 rounded-lg border border-[#E8E4DC] bg-white px-2 py-2">
      <ProposalCardList
        itemId={item.id}
        item={item}
        proposals={proposals}
        indent={false}
        dates={dates}
        onDateChange={(key, value) => setDates((prev) => ({ ...prev, [key]: value }))}
        busyKey={busyKey}
        emphasisIndex={focus}
        reviewSends
        onAgree={(indexes, send) => {
          const formIdxs = indexes.filter((index) =>
            isFormExecuteProposal(proposals[index]?.type)
          );
          const otherIdxs = indexes.filter(
            (index) => !isFormExecuteProposal(proposals[index]?.type)
          );
          if (formIdxs.length > 0) {
            const [first, ...rest] = formIdxs;
            void openForm(first, rest);
          }
          if (otherIdxs.length > 0) return postAction("agree", otherIdxs, send);
        }}
        onDismiss={(indexes) => void postAction("dismiss", indexes)}
        onUndo={(index) => void postAction("undo", [index])}
        missingRequiredDates={(indexes) => missingDates(item, indexes, dates)}
      />
      {calendarAgree && caseId && (
        <SageAgreeFormModal
          title={calendarAgree.initialValues.eventId ? "Update calendar event" : "Add to calendar"}
          titleId="open-item-calendar-title"
          hint="Review the event, then save it. Nothing is added until you confirm."
          onClose={() => setCalendarAgree(null)}
        >
          <AddEventForm
            caseId={caseId}
            children={children}
            initialYear={new Date().getFullYear()}
            initialMonth={new Date().getMonth() + 1}
            initialValues={calendarAgree.initialValues}
            hideHeader
            onSuccess={(eventId) =>
              void markExecuted(calendarAgree.proposalIndex, { event_id: eventId })
            }
          />
        </SageAgreeFormModal>
      )}
      {expenseAgree && caseId && (
        <SageAgreeFormModal
          title="Add expense"
          titleId="open-item-expense-title"
          hint="Review the expense, then submit it. Nothing is saved until you confirm."
          onClose={() => setExpenseAgree(null)}
        >
          <ExpenseForm
            key={`${expenseAgree.item.id}:${expenseAgree.proposalIndex}`}
            caseId={caseId}
            children={children}
            initialValues={expenseAgree.initialValues}
            hideHeader
            onSuccess={(expenseId) =>
              void markExecuted(expenseAgree.proposalIndex, { expense_id: expenseId })
            }
          />
        </SageAgreeFormModal>
      )}
      {documentAgree && (
        <DocumentDetailModal
          open
          reviewAndFile
          initialEditMode
          document={documentAgree.document}
          children={children}
          onClose={() => setDocumentAgree(null)}
          onSaved={(result) =>
            void markExecuted(documentAgree.proposalIndex, {
              document_id: documentAgree.document.id,
              filed_title: result?.title ?? "",
            })
          }
        />
      )}
    </div>
  );
}

function datesFor(
  item: SageItem,
  indexes: number[],
  dates: Record<string, string>
): Record<number, string> | undefined {
  const proposals = item.plan?.proposals ?? [];
  const out: Record<number, string> = {};
  for (const index of indexes) {
    const proposal = proposals[index];
    if (!proposal || !needsDateField(proposal, item)) continue;
    const value = dates[dateKey(item.id, index)]?.trim();
    if (value) out[index] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function missingDates(item: SageItem, indexes: number[], dates: Record<string, string>): boolean {
  const proposals = item.plan?.proposals ?? [];
  return indexes.some((index) => {
    const proposal = proposals[index];
    if (!proposal || !needsDateField(proposal, item)) return false;
    return !(dates[dateKey(item.id, index)] ?? "").trim();
  });
}

async function dismissItem(id: string, onChanged: () => void) {
  const res = await fetch("/api/sage-inbox", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status: "dismissed" }),
  });
  if (!res.ok) {
    showErrorToast("Couldn't dismiss that item.");
    return;
  }
  onChanged();
}

async function recordSaveFailure(
  id: string,
  proposalIndex: number,
  ids: { event_id?: string; expense_id?: string; document_id?: string },
  error: string | undefined
) {
  await fetch("/api/sage-inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      action: "save_failed",
      proposal_index: proposalIndex,
      save_error: error || "Save didn't finish.",
      ...ids,
    }),
  }).catch(() => undefined);
}
