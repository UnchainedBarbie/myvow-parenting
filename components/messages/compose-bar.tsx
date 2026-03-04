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
  const [isEmergency, setIsEmergency] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [emergencyNote, setEmergencyNote] = useState("");

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
    if (isEmergency && (!emergencyReason || !emergencyNote.trim())) {
      setError("For emergency messages, select a reason and add a brief description.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/messages/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          original_content: intent,
          ai_rewritten_content: draft,
          is_emergency: isEmergency,
          emergency_type: isEmergency ? emergencyReason : null,
          emergency_note: isEmergency ? emergencyNote : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to send");
      setStep("intent");
      setIntent("");
      setDraft("");
      setIsEmergency(false);
      setEmergencyReason("");
      setEmergencyNote("");
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

      <p className="flex items-center gap-1 text-[11px] text-foreground-secondary">
        <span role="img" aria-label="AI review">
          🛡
        </span>
        <span>Your message will be reviewed by AI before sending.</span>
      </p>

      <div className="text-[11px] text-foreground-secondary">
        <span className="font-medium">Attach:</span>{" "}
        <span>Event</span> · <span>Expense</span> · <span>Document</span> ·{" "}
        <span>Court Order</span>
      </div>

      <div className="space-y-1">
        <label className="inline-flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={isEmergency}
            onChange={(e) => {
              const checked = e.target.checked;
              setIsEmergency(checked);
              if (!checked) {
                setEmergencyReason("");
                setEmergencyNote("");
              }
            }}
            className="h-3 w-3 rounded border-border"
          />
          <span className="text-[#D4A843]">Emergency message</span>
        </label>
        {isEmergency && (
          <div className="mt-1 space-y-1">
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                className="h-8 w-full sm:w-48 rounded-md border border-border bg-background px-2 text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
              >
                <option value="">Reason</option>
                <option value="medical">Medical emergency</option>
                <option value="safety">Safety concern</option>
                <option value="logistics">Time-sensitive logistics</option>
              </select>
              <input
                type="text"
                value={emergencyNote}
                onChange={(e) => setEmergencyNote(e.target.value)}
                placeholder="e.g., Child injured at school, need pickup"
                className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-[12px] text-foreground placeholder:text-[#B0A899] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleGetDraft} disabled={loading || !intent.trim()}>
          {loading ? "Getting draft…" : "Get draft"}
        </Button>
      </div>
    </div>
  );
}
