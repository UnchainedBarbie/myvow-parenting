"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { OpenItemModuleList, OpenItemsProvider, useOpenItems } from "@/components/dashboard/open-items-section";
import {
  InboxReviewList,
  InboxReviewProvider,
  normalizeInboxType,
  useInboxReview,
} from "@/components/dashboard/review-card";
import type { OpenItemType } from "@/lib/open-items";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";
import { OutboundReviewPanel } from "@/components/messages/outbound-review-panel";
import {
  originalForSend,
  requestEditReview,
  requestOutboundReviewWithReceipt,
  reviewProofForSend,
  reviewSendsWithoutAnotherStep,
  type ReviewedDraft,
} from "@/lib/messages/outbound-review";
import { nextSendAttempt, type SendAttempt } from "@/lib/messages/send-attempt";

const SUB_LINK_CLASS =
  "text-[11px] text-[#5B7A52] underline-offset-2 hover:underline";

type Props = {
  caseId: string;
  openExpenseItems: number;
  awaitingResponseCount: number;
  communicationToneLabel: string;
  firstUnreadConversationId: string | null;
  agreedOutstandingLabel: string;
  claimedAwaitingLabel: string;
};

const MODULES: { type: OpenItemType; title: string }[] = [
  { type: "message", title: "Communication" },
  { type: "expense", title: "Expenses" },
  { type: "document", title: "Documents" },
  { type: "calendar_event", title: "Calendar" },
];

export function DashboardStatusCards(props: Props) {
  return (
    <OpenItemsProvider>
      <InboxReviewProvider>
        <ModuleTiles {...props} />
      </InboxReviewProvider>
    </OpenItemsProvider>
  );
}

function ModuleTiles({
  caseId,
  openExpenseItems,
  awaitingResponseCount,
  communicationToneLabel,
  firstUnreadConversationId,
  agreedOutstandingLabel,
  claimedAwaitingLabel,
}: Props) {
  const router = useRouter();
  const openItems = useOpenItems();
  const inbox = useInboxReview();
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderText, setReminderText] = useState("");
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reviewingReminder, setReviewingReminder] = useState(false);
  const [reminderReviewed, setReminderReviewed] = useState<ReviewedDraft | null>(null);

  useEffect(() => {
    const match = agreedOutstandingLabel.match(/\$([0-9][0-9,]*\.\d{2})/);
    const amount = match ? match[1] : "0.00";
    const template = `Hi, just a friendly reminder that the agreed outstanding balance for shared expenses is $${amount}. Could you please review and confirm when you get a chance? Thank you.`;
    setReminderText(template);
  }, [agreedOutstandingLabel]);

  async function handleReviewReminder() {
    const text = reminderText.trim();
    if (!text || reviewingReminder || sendingReminder) return;
    setReviewingReminder(true);
    try {
      const reviewed = await requestOutboundReviewWithReceipt(text);
      // The press is the approval. Identical text is not shown again.
      if (reviewSendsWithoutAnotherStep(reviewed, text)) {
        await handleSendReminder(text, reviewed);
        return;
      }
      setReminderReviewed(reviewed);
    } finally {
      setReviewingReminder(false);
    }
  }

  // One approval of one final text is one send attempt. A retry keeps the attempt id and the
  // conversation it created, so a retry never starts a second conversation or message.
  const reminderAttempt = useRef<{ attempt: SendAttempt; conversationId: string | null } | null>(null);
  const [reviewingReminderEdit, setReviewingReminderEdit] = useState(false);

  async function handleReviewReminderEdit(text: string) {
    if (!reminderReviewed || reviewingReminderEdit) return;
    setReviewingReminderEdit(true);
    try {
      const reviewed = await requestEditReview(reminderReviewed, text);
      if (reviewSendsWithoutAnotherStep(reviewed, text)) {
        await handleSendReminder(text, reviewed);
        return;
      }
      setReminderReviewed(reviewed);
    } finally {
      setReviewingReminderEdit(false);
    }
  }

  async function handleSendReminder(
    finalText: string,
    reviewed: ReviewedDraft,
    options?: { editUnreviewedAck?: boolean }
  ) {
    const text = finalText.trim();
    if (!text || !reviewed) return;
    setSendingReminder(true);
    try {
      const attempt = nextSendAttempt(reminderAttempt.current?.attempt ?? null, text);
      const previous = reminderAttempt.current;
      reminderAttempt.current = {
        attempt,
        conversationId: previous && previous.attempt.id === attempt.id ? previous.conversationId : null,
      };
      let convId = reminderAttempt.current.conversationId;
      if (!convId) {
        // Create conversation
        const convRes = await fetch("/api/messages/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: "Expense Reminder",
            child_id: null,
            topic: "Expenses",
          }),
        });
        const convData = await convRes.json().catch(() => ({}));
        if (!convRes.ok) {
          showErrorToast(
            (convData as { error?: string }).error ??
              "Could not start expense reminder conversation."
          );
          return;
        }
        convId = (convData as { conversation: { id: string } }).conversation.id;
        reminderAttempt.current.conversationId = convId;
      }

      // Send message through Sage pipeline (original == rewritten for now)
      const msgRes = await fetch("/api/messages/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          conversation_id: convId,
          original_content: originalForSend(reviewed),
          ai_rewritten_content: text,
          send_attempt_id: attempt.id,
          ...reviewProofForSend(reviewed, { editUnreviewedAck: options?.editUnreviewedAck }),
        }),
      });
      const msgData = await msgRes.json().catch(() => ({}));
      if (!msgRes.ok) {
        showErrorToast(
          (msgData as { message?: string }).message ??
            "Could not send reminder."
        );
        return;
      }
      reminderAttempt.current = null;
      setShowReminderModal(false);
      setReminderReviewed(null);
      showSuccessToast("Reminder sent");
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not send reminder.");
    } finally {
      setSendingReminder(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (window.location.hash !== "#open-items" && params.get("open") !== "items") return;
    document.getElementById("open-items")?.scrollIntoView({ block: "start" });
  }, [openItems.loading]);

  function moduleCount(type: OpenItemType): number {
    const proposals = openItems.items.filter((entry) => entry.type === type).length;
    const reviews = inbox.items.filter((item) => normalizeInboxType(item) === type).length;
    if (type === "message") return proposals + reviews + awaitingResponseCount;
    if (type === "expense") return proposals + reviews + openExpenseItems;
    return proposals + reviews;
  }

  const loading = openItems.loading || inbox.loading;

  return (
    <>
      {(openItems.error || inbox.error) && (
        <div className="mb-3 space-y-2">
          {openItems.error && (
            <p className="text-sm text-[#7A3434]" role="alert">
              {openItems.error}{" "}
              <button type="button" className={SUB_LINK_CLASS} onClick={() => void openItems.load()}>
                Try again
              </button>
            </p>
          )}
          {inbox.error && (
            <p className="text-sm text-[#7A3434]" role="alert">
              {inbox.error}{" "}
              <button type="button" className={SUB_LINK_CLASS} onClick={() => void inbox.reload()}>
                Try again
              </button>
            </p>
          )}
        </div>
      )}
      <div id="open-items" className="grid scroll-mt-4 gap-3 md:grid-cols-2 items-start">
        {MODULES.map((module) => {
          const count = moduleCount(module.type);
          return (
            <Card
              key={module.type}
              className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7] text-xs md:text-sm"
            >
              <CardHeader className="flex flex-row items-center gap-2 px-4 pb-2 pt-4">
                <CardTitle className="font-heading text-lg text-foreground">{module.title}</CardTitle>
                {!loading && (
                  <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-[#F2F5EF] px-2 py-0.5 text-[11px] font-medium text-[#5B7A52]">
                    {count}
                  </span>
                )}
              </CardHeader>
              <CardContent className="space-y-2 px-4 pb-4">
                {loading ? (
                  <p className="text-sm text-foreground-secondary">Loading…</p>
                ) : (
                  <>
                    {module.type === "message" && awaitingResponseCount > 0 && (
                      <div className="flex items-start justify-between gap-3 rounded-lg border border-[#E8E4DC] bg-white px-3 py-2">
                        <p className="text-sm text-foreground">{communicationToneLabel}</p>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 shrink-0 rounded-full bg-[#7B9E87] px-3 text-[11px] text-white hover:bg-[#6A8A78]"
                          onClick={() =>
                            router.push(
                              firstUnreadConversationId
                                ? `/messages?conversation_id=${encodeURIComponent(firstUnreadConversationId)}`
                                : "/messages"
                            )
                          }
                        >
                          Open
                        </Button>
                      </div>
                    )}
                    {module.type === "expense" && (
                      <div className="space-y-1">
                        <p className="text-[11px] text-foreground-secondary">
                          Agreed outstanding: {agreedOutstandingLabel}
                        </p>
                        <p className="text-[11px] text-foreground-secondary">
                          Claimed, awaiting response: {claimedAwaitingLabel}
                        </p>
                        {openExpenseItems > 0 && (
                          <div className="flex items-start justify-between gap-3 rounded-lg border border-[#E8E4DC] bg-white px-3 py-2">
                            <p className="text-sm text-foreground">
                              {openExpenseItems} pending or disputed{" "}
                              {openExpenseItems === 1 ? "expense" : "expenses"}
                            </p>
                            <Link href="/expenses?status=pending" className={SUB_LINK_CLASS}>
                              View details
                            </Link>
                          </div>
                        )}
                        <div className="flex gap-3 pt-1">
                          {openExpenseItems === 0 && (
                            <Link href="/expenses" className={SUB_LINK_CLASS}>
                              View details
                            </Link>
                          )}
                          <button
                            type="button"
                            className={SUB_LINK_CLASS}
                            onClick={() => {
                              setReminderReviewed(null);
                              setShowReminderModal(true);
                            }}
                          >
                            Send reminder
                          </button>
                        </div>
                      </div>
                    )}
                    <OpenItemModuleList type={module.type} />
                    <InboxReviewList type={module.type} />
                    {count === 0 && !openItems.error && !inbox.error && (
                      <p className="text-sm text-foreground-secondary">Nothing waiting.</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {showReminderModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          onClick={(e) => {
            if (e.target === e.currentTarget && !sendingReminder) {
              setShowReminderModal(false);
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card">
            <h2 className="font-heading text-base font-semibold text-[#3D3D3D]">
              Send Expense Reminder
            </h2>
            <p className="mt-1 text-[11px] text-[#8A8A8A]">
              Send a friendly reminder to your co-parent about outstanding expenses.
            </p>
            {reminderReviewed ? (
              <div className="mt-3">
                {reminderReviewed.review.status === "suggestion" ? (
                  <div className="mb-3 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A8A]">
                      Your message
                    </p>
                    <p className="whitespace-pre-wrap rounded-lg border border-[#E8E4DC] bg-white px-3 py-2 text-sm text-[#3D3D3D]">
                      {reminderReviewed.review.original}
                    </p>
                    <p className="text-[11px] text-[#8A8A8A]">
                      Sage suggests a change. The field below is what will be sent.
                    </p>
                  </div>
                ) : null}
                <OutboundReviewPanel
                  key={`${reminderReviewed.review.status}:${reminderReviewed.review.original}:${reminderReviewed.receipt ?? ""}`}
                  review={reminderReviewed.review}
                  approveLabel="Send Reminder"
                  busy={sendingReminder}
                  busyLabel="Sending…"
                  onApprove={(finalText, options) => void handleSendReminder(finalText, reminderReviewed, options)}
                  onReviewEdit={reminderReviewed.receipt ? (text) => void handleReviewReminderEdit(text) : undefined}
                  reviewingEdit={reviewingReminderEdit}
                  onCancel={() => {
                    reminderAttempt.current = null;
                    setReminderReviewed(null);
                  }}
                />
              </div>
            ) : (
            <>
            <div className="mt-3 space-y-2">
              <Label
                htmlFor="expense-reminder-text"
                className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8A8A]"
              >
                This exact text will be sent
              </Label>
              <textarea
                id="expense-reminder-text"
                value={reminderText}
                onChange={(e) => setReminderText(e.target.value)}
                disabled={reviewingReminder || sendingReminder}
                className="w-full min-h-[96px] rounded-lg border border-[#E8E4DC] bg-white px-3 py-2 text-sm text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E] disabled:opacity-60"
              />
              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#8A8A8A]">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[#E8E4DC] bg-[#F2F5EF]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="h-2.5 w-2.5 text-[#7C8B6E]"
                  >
                    <path
                      fill="currentColor"
                      d="M12 2a5 5 0 0 1 5 5v2h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v2h6V7a3 3 0 0 0-3-3Z"
                    />
                  </svg>
                </span>
                <span>Sage reviews this when you send. Nothing is sent until you press Send Reminder.</span>
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full text-xs"
                disabled={sendingReminder || reviewingReminder}
                onClick={() => setShowReminderModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                disabled={reviewingReminder || sendingReminder || !reminderText.trim()}
                onClick={() => void handleReviewReminder()}
              >
                {sendingReminder ? "Sending…" : reviewingReminder ? "Reviewing…" : "Send Reminder"}
              </Button>
            </div>
            </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
