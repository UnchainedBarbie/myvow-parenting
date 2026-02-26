"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ComposeBarProps {
  caseId: string;
  onSent?: () => void;
}

type Step = "intent" | "draft" | "sending";

export function ComposeBar({ caseId, onSent }: ComposeBarProps) {
  const [step, setStep] = useState<Step>("intent");
  const [intent, setIntent] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGetDraft() {
    if (!intent.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/messages/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: intent.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to get draft");
      setDraft(data.draft ?? intent);
      setStep("draft");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveAndSend() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/messages/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          original_content: intent,
          ai_rewritten_content: draft,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send");
      setStep("intent");
      setIntent("");
      setDraft("");
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (step === "draft") {
    return (
      <div className="border-t border-border bg-background-secondary p-4 space-y-3">
        <p className="text-sm font-medium text-foreground-secondary">Draft (review before sending)</p>
        <div className="rounded-card border border-border bg-background p-3 text-sm text-foreground">
          {draft}
        </div>
        {error && <p className="text-sm text-alert">{error}</p>}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setStep("intent")}
            disabled={loading}
          >
            Edit intent
          </Button>
          <Button onClick={handleApproveAndSend} disabled={loading}>
            {loading ? "Sending…" : "Approve & send"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-background-secondary p-4 space-y-3">
      <Textarea
        placeholder="Type what you want to say… We'll help make it calm and clear."
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        rows={3}
        className="resize-none"
      />
      {error && <p className="text-sm text-alert">{error}</p>}
      <Button onClick={handleGetDraft} disabled={loading || !intent.trim()}>
        {loading ? "Getting draft…" : "Get draft"}
      </Button>
    </div>
  );
}
