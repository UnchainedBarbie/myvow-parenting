"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  medical: "Medical",
  dental: "Dental",
  therapy: "Therapy",
  school: "School",
  extracurricular: "Extracurricular",
  clothing: "Clothing",
  childcare: "Childcare",
  transportation: "Transportation",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  submitted: "Pending",
  approved: "Approved",
  disputed: "Disputed",
  resolved: "Resolved",
};

export type ExpenseRow = {
  id: string;
  description: string;
  amount: string;
  category: string;
  child_id: string | null;
  child_name: string | null;
  amount_owed: string | null;
  status: string;
  created_at: string;
  submitted_by: string;
  receipt_file_id: string | null;
};

interface ExpenseListProps {
  expenses: ExpenseRow[];
  currentUserId: string;
  custodySplitPercent: number;
}

function formatMonthKey(createdAt: string) {
  const d = new Date(createdAt);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDate(createdAt: string) {
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ExpenseList({
  expenses,
  currentUserId,
  custodySplitPercent,
}: ExpenseListProps) {
  const router = useRouter();
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeForId, setDisputeForId] = useState<string | null>(null);

  const byMonth = expenses.reduce(
    (acc, exp) => {
      const key = formatMonthKey(exp.created_at);
      if (!acc[key]) acc[key] = [];
      acc[key].push(exp);
      return acc;
    },
    {} as Record<string, ExpenseRow[]>
  );
  const months = Object.keys(byMonth).sort((a, b) => {
    const dateA = new Date(byMonth[a][0]?.created_at ?? 0).getTime();
    const dateB = new Date(byMonth[b][0]?.created_at ?? 0).getTime();
    return dateB - dateA;
  });

  async function handleRespond(expenseId: string, action: "approve" | "dispute") {
    setRespondingId(expenseId);
    try {
      const body: { expense_id: string; action: string; dispute_reason?: string } = {
        expense_id: expenseId,
        action,
      };
      if (action === "dispute") body.dispute_reason = disputeReason;
      const res = await fetch("/api/expenses/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Request failed");
      setDisputeForId(null);
      setDisputeReason("");
      router.refresh();
    } finally {
      setRespondingId(null);
    }
  }

  const canRespond = (exp: ExpenseRow) =>
    exp.submitted_by !== currentUserId && exp.status === "submitted";

  return (
    <Card className="shadow-card border-border rounded-card">
      <CardHeader>
        <CardTitle className="font-heading text-lg">All expenses</CardTitle>
      </CardHeader>
      <CardContent>
        {expenses.length === 0 ? (
          <p className="text-sm text-foreground-secondary py-6">
            No expenses yet. Add one above.
          </p>
        ) : (
          <div className="space-y-8">
            {months.map((month) => (
              <section key={month}>
                <h3 className="font-heading text-base font-semibold text-foreground mb-3">
                  {month}
                </h3>
                <ul className="space-y-3">
                  {byMonth[month].map((exp) => {
                    const amount = parseFloat(exp.amount);
                    const owed = exp.amount_owed != null ? parseFloat(exp.amount_owed) : null;
                    const isMine = exp.submitted_by === currentUserId;
                    const yourShare =
                      owed != null
                        ? isMine
                          ? amount - owed
                          : owed
                        : null;

                    return (
                      <li
                        key={exp.id}
                        className={cn(
                          "rounded-card border border-border bg-background-secondary/50 p-4 shadow-card"
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-foreground">
                              {exp.description}
                            </p>
                            <p className="text-sm text-foreground-secondary mt-0.5">
                              {CATEGORY_LABELS[exp.category] ?? exp.category}
                              {exp.child_name && ` · ${exp.child_name}`}
                              {" · "}
                              {formatDate(exp.created_at)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-foreground">
                              ${Number(exp.amount).toFixed(2)} total
                            </p>
                            <p className="text-sm text-foreground-secondary">
                              {yourShare != null && (
                                <>
                                  Your share: ${yourShare.toFixed(2)}
                                  {owed != null && (
                                    <> · Other parent’s share: ${owed.toFixed(2)}</>
                                  )}
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-xs",
                              exp.status === "submitted" && "bg-muted text-foreground-secondary",
                              exp.status === "approved" && "bg-success/15 text-success",
                              exp.status === "disputed" && "bg-alert/10 text-alert"
                            )}
                          >
                            {STATUS_LABELS[exp.status] ?? exp.status}
                          </span>
                          {canRespond(exp) && (
                            <span className="flex items-center gap-2 ml-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-full"
                                disabled={respondingId !== null}
                                onClick={() => handleRespond(exp.id, "approve")}
                              >
                                Approve
                              </Button>
                              {disputeForId === exp.id ? (
                                <>
                                  <input
                                    type="text"
                                    placeholder="Reason (optional)"
                                    value={disputeReason}
                                    onChange={(e) => setDisputeReason(e.target.value)}
                                    className="flex-1 min-w-0 rounded-card border border-input bg-background px-2 py-1 text-sm"
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="rounded-full text-alert border-alert/30"
                                    disabled={respondingId !== null}
                                    onClick={() => handleRespond(exp.id, "dispute")}
                                  >
                                    Submit dispute
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="rounded-full"
                                    onClick={() => {
                                      setDisputeForId(null);
                                      setDisputeReason("");
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="rounded-full text-foreground-secondary"
                                  disabled={respondingId !== null}
                                  onClick={() => setDisputeForId(exp.id)}
                                >
                                  Dispute
                                </Button>
                              )}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
