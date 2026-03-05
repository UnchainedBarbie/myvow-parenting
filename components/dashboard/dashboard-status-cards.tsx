"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";

const CARD_LINK_CLASS =
  "cursor-pointer transition-all hover:shadow-sm hover:border-[#C5CFBC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C8B6E] focus-visible:ring-offset-1";
const SUB_LINK_CLASS =
  "text-[11px] text-[#5B7A52] underline-offset-2 hover:underline";

type Props = {
  caseId: string;
  householdElevated: boolean;
  householdClimateLabel: string;
  disputesLabel: string;
  openExpenseItems: number;
  awaitingResponseCount: number;
  communicationMainLabel: string;
  communicationToneLabel: string;
  firstUnreadConversationId: string | null;
  netLabel: string;
};

export function DashboardStatusCards({
  caseId,
  householdElevated,
  householdClimateLabel,
  disputesLabel,
  openExpenseItems,
  awaitingResponseCount,
  communicationMainLabel,
  communicationToneLabel,
  firstUnreadConversationId,
  netLabel,
}: Props) {
  const router = useRouter();
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderText, setReminderText] = useState("");
  const [sendingReminder, setSendingReminder] = useState(false);

  useEffect(() => {
    const match = netLabel.match(/\$([0-9][0-9,]*\.\d{2})/);
    const amount = match ? match[1] : "0.00";
    const template = `Hi, just a friendly reminder that there are outstanding shared expenses totaling $${amount}. Could you please review and confirm when you get a chance? Thank you.`;
    setReminderText(template);
  }, [netLabel]);

  async function handleSendReminder() {
    const text = reminderText.trim();
    if (!text) return;
    setSendingReminder(true);
    try {
      // Create conversation
      const convRes = await fetch("/api/messages/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: "Expense Reminder",
          child_id: null,
          category: "expense",
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
      const convId = (convData as { conversation: { id: string } }).conversation.id;

      // Send message through Sage pipeline (original == rewritten for now)
      console.log("Sending expense reminder", {
        case_id: caseId,
        conversation_id: convId,
        original_content: text,
      });
      const msgRes = await fetch("/api/messages/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          conversation_id: convId,
          original_content: text,
          ai_rewritten_content: text,
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
      setShowReminderModal(false);
      showSuccessToast("Reminder sent");
    } finally {
      setSendingReminder(false);
    }
  }

  function handleHouseholdClick() {
    router.push("/messages");
  }

  function handleCommunicationClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("a")) return;
    const url = firstUnreadConversationId
      ? `/messages?conversation_id=${encodeURIComponent(firstUnreadConversationId)}`
      : "/messages";
    router.push(url);
  }

  function handleSharedExpensesClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("a")) return;
    router.push("/expenses");
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-3 items-stretch">
        {/* Household climate */}
        <Card
          className={cn(
            "rounded-card text-xs md:text-sm",
            CARD_LINK_CLASS,
            householdElevated
              ? "border-[#E8E4DC] bg-[#FDF6E3]"
              : "border-[#E8E4DC] bg-[#F2F5EF]"
          )}
          onClick={handleHouseholdClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleHouseholdClick();
            }
          }}
        >
          <CardContent className="px-3 py-3 space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  householdElevated ? "bg-[#D4A843]" : "bg-[#7C8B6E]"
                )}
              />
              <p className="font-medium text-foreground text-xs md:text-sm">
                Household climate
              </p>
            </div>
            <p className="text-[11px] md:text-xs text-foreground-secondary">
              {householdClimateLabel}
            </p>
            <div className="mt-1 space-y-0.5 text-[11px] md:text-xs text-foreground-secondary">
              {openExpenseItems > 0 && (
                <p>
                  •{" "}
                  <Link
                    href="/expenses?status=pending"
                    className={SUB_LINK_CLASS}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {disputesLabel}
                  </Link>
                </p>
              )}
              {awaitingResponseCount > 0 && (
                <p>
                  •{" "}
                  {awaitingResponseCount} conversation
                  {awaitingResponseCount > 1 ? "s" : ""} may need a response
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Communication */}
        <Card
          className={cn(
            "rounded-card border border-[#E8E4DC] bg-[#FDFBF7] text-xs md:text-sm",
            CARD_LINK_CLASS
          )}
          onClick={handleCommunicationClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleCommunicationClick(e as unknown as React.MouseEvent);
            }
          }}
        >
          <CardContent className="px-3 py-3 space-y-1">
            <p className="font-medium text-foreground text-xs md:text-sm">
              Communication
            </p>
            <p className="text-[11px] md:text-xs text-foreground-secondary">
              {communicationMainLabel}
            </p>
            <p className="text-[11px] md:text-xs text-foreground-secondary">
              {communicationToneLabel}
            </p>
          </CardContent>
        </Card>

        {/* Shared expenses */}
        <Card
          className={cn(
            "rounded-card border border-[#E8E4DC] bg-[#FDFBF7] text-xs md:text-sm",
            CARD_LINK_CLASS
          )}
          onClick={handleSharedExpensesClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleSharedExpensesClick(e as unknown as React.MouseEvent);
            }
          }}
        >
          <CardContent className="px-3 py-3 space-y-1">
            <p className="font-medium text-foreground text-xs md:text-sm">
              Shared expenses: {netLabel}
            </p>
            <p className="text-[11px] md:text-xs text-foreground-secondary">
              {openExpenseItems === 0
                ? "0 open items"
                : `${openExpenseItems} open item${openExpenseItems > 1 ? "s" : ""}`}
            </p>
            <div className="flex gap-3 pt-1" onClick={(e) => e.stopPropagation()}>
              <Link href="/expenses" className={SUB_LINK_CLASS}>
                View details
              </Link>
              <button
                type="button"
                className={SUB_LINK_CLASS}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowReminderModal(true);
                }}
              >
                Send reminder
              </button>
            </div>
          </CardContent>
        </Card>
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
            <div className="mt-3 space-y-2">
              <Label className="text-xs font-medium text-[#3D3D3D]">
                Message
              </Label>
              <textarea
                value={reminderText}
                onChange={(e) => setReminderText(e.target.value)}
                className="w-full min-h-[96px] rounded-lg border border-[#E8E4DC] bg-white px-3 py-2 text-sm text-[#3D3D3D] placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
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
                <span>This message will be reviewed by Sage before delivery.</span>
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full text-xs"
                disabled={sendingReminder}
                onClick={() => setShowReminderModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
                disabled={sendingReminder || !reminderText.trim()}
                onClick={() => void handleSendReminder()}
              >
                {sendingReminder ? "Sending…" : "Send Reminder"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
