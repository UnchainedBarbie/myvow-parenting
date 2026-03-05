"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";

type IncidentType =
  | "schedule_issue"
  | "health_safety"
  | "communication"
  | "expense"
  | "other";

interface IncidentSessionViewProps {
  sessionId: string;
}

interface ChildOption {
  id: string;
  first_name: string;
}

interface IncidentSummary {
  title: string;
  date: string;
  child_id: string;
  type: IncidentType;
  summary: string;
  notes: string;
}

type Step = 1 | 2 | 3 | 4 | 5 | "review";

export function IncidentSessionView({ sessionId }: IncidentSessionViewProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [whatHappened, setWhatHappened] = useState("");
  const [whoInvolved, setWhoInvolved] = useState("");
  const [whenOccurred, setWhenOccurred] = useState("");
  const [childId, setChildId] = useState("");
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const [saving, setSaving] = useState(false);

  const [summary, setSummary] = useState<IncidentSummary>({
    title: "",
    date: "",
    child_id: "",
    type: "schedule_issue",
    summary: "",
    notes: "",
  });

  useEffect(() => {
    // Load lightweight children list for incident association.
    setLoadingChildren(true);
    fetch("/api/children/minimal")
      .then((res) => res.json())
      .then((data) => {
        const list = (data?.children ?? []) as {
          id: string;
          first_name: string;
        }[];
        setChildren(list);
      })
      .catch(() => {
        // Non-fatal: user can still record without binding to a child.
      })
      .finally(() => setLoadingChildren(false));
  }, []);

  function goNext(next: Step) {
    setStep(next);
  }

  function buildInitialSummary(): IncidentSummary {
    const date = whenOccurred || new Date().toISOString().slice(0, 10);
    const child = children.find((c) => c.id === childId);
    const baseTitle =
      whatHappened.trim().split("\n")[0].slice(0, 80) ||
      "Incident report";
    return {
      title: baseTitle,
      date,
      child_id: childId,
      type: "schedule_issue",
      summary: whatHappened.trim(),
      notes: whoInvolved.trim(),
    };
  }

  async function handleSaveIncident() {
    setSaving(true);
    try {
      const payload: IncidentSummary = {
        ...summary,
        child_id: summary.child_id || childId,
        date: summary.date || whenOccurred,
      };
      const res = await fetch("/api/sage/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, incident: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast(
          (data as { message?: string }).message ??
            "Could not save incident report."
        );
        return;
      }
      showSuccessToast("Incident report saved.");
      // Optionally navigate to Documents or keep user in Sage.
      router.refresh();
    } catch {
      showErrorToast("Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const canContinueFromStep1 = whatHappened.trim().length > 0;
  const canContinueFromStep2 = whoInvolved.trim().length > 0;
  const canContinueFromStep3 = whenOccurred.trim().length > 0;
  const canContinueFromStep4 = !!childId || children.length === 0;

  return (
    <div className="rounded-2xl border border-border bg-background-secondary/40 p-3 md:p-4 flex flex-col gap-3 w-full h-full min-h-[60vh]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-[#3D3D3D]">Incident report</p>
          <p className="text-[11px] text-[#8A8A8A]">
            Capture a clear, timestamped record you can reference later.
          </p>
        </div>
        <p className="text-[11px] text-[#8A8A8A]">
          Step {step === "review" ? "5" : step} of 5
        </p>
      </div>

      <div className="rounded-card border border-[#E8E4DC] bg-[#FDFBF7] p-3 flex-1 min-h-[220px]">
        {step === 1 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#3D3D3D]">
              1. What happened?
            </p>
            <p className="text-[11px] text-[#8A8A8A]">
              Describe the incident in your own words. Focus on observable
              facts.
            </p>
            <Textarea
              value={whatHappened}
              onChange={(e) => setWhatHappened(e.target.value)}
              className="min-h-[120px] rounded-card border-border bg-background text-sm"
            />
          </div>
        )}
        {step === 2 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#3D3D3D]">
              2. Who was involved?
            </p>
            <p className="text-[11px] text-[#8A8A8A]">
              List the people involved (e.g., you, co-parent, child, others).
            </p>
            <Textarea
              value={whoInvolved}
              onChange={(e) => setWhoInvolved(e.target.value)}
              className="min-h-[100px] rounded-card border-border bg-background text-sm"
            />
          </div>
        )}
        {step === 3 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#3D3D3D]">
              3. When did this occur?
            </p>
            <p className="text-[11px] text-[#8A8A8A]">
              Use the date the incident happened, not when you are writing it
              down.
            </p>
            <input
              type="date"
              value={whenOccurred}
              onChange={(e) => setWhenOccurred(e.target.value)}
              className="h-8 rounded-full border border-[#E8E4DC] bg-[#FDFBF7] px-3 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
            />
          </div>
        )}
        {step === 4 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#3D3D3D]">
              4. Which child was involved?
            </p>
            <p className="text-[11px] text-[#8A8A8A]">
              If more than one child was involved, choose the one most affected.
            </p>
            {loadingChildren ? (
              <p className="text-[11px] text-[#8A8A8A]">Loading children…</p>
            ) : children.length === 0 ? (
              <p className="text-[11px] text-[#8A8A8A]">
                No children found in your profile. You can still record this
                incident.
              </p>
            ) : (
              <select
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className="h-8 w-full max-w-xs rounded-full border border-[#E8E4DC] bg-[#FDFBF7] px-3 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
              >
                <option value="">Select child</option>
                {children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {step === 5 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#3D3D3D]">
              5. Attach documents (optional)
            </p>
            <p className="text-[11px] text-[#8A8A8A]">
              You can attach supporting documents to this incident later from
              the Documents section. For now, focus on capturing the facts.
            </p>
            <p className="text-[11px] text-[#6B6B6B]">
              When you continue, Sage will create a structured incident summary
              for you to review and save.
            </p>
          </div>
        )}
        {step === "review" && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-[#3D3D3D]">
              Review and edit incident summary
            </p>
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-[#6B6B6B]">
                Title
              </label>
              <input
                type="text"
                value={summary.title}
                onChange={(e) =>
                  setSummary((prev) => ({ ...prev, title: e.target.value }))
                }
                className="w-full rounded-full border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-1.5 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[#6B6B6B]">
                  Date
                </label>
                <input
                  type="date"
                  value={summary.date}
                  onChange={(e) =>
                    setSummary((prev) => ({ ...prev, date: e.target.value }))
                  }
                  className="w-full rounded-full border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-1.5 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[#6B6B6B]">
                  Type
                </label>
                <select
                  value={summary.type}
                  onChange={(e) =>
                    setSummary((prev) => ({
                      ...prev,
                      type: e.target.value as IncidentType,
                    }))
                  }
                  className="w-full rounded-full border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-1.5 text-xs text-[#3D3D3D] focus:outline-none focus:ring-1 focus:ring-[#7C8B6E]"
                >
                  <option value="schedule_issue">Schedule issue</option>
                  <option value="health_safety">Health &amp; Safety</option>
                  <option value="communication">Communication</option>
                  <option value="expense">Expense</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-[#6B6B6B]">
                Summary
              </label>
              <Textarea
                value={summary.summary}
                onChange={(e) =>
                  setSummary((prev) => ({ ...prev, summary: e.target.value }))
                }
                className="min-h-[80px] rounded-card border-border bg-background text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-[#6B6B6B]">
                Notes (optional)
              </label>
              <Textarea
                value={summary.notes}
                onChange={(e) =>
                  setSummary((prev) => ({ ...prev, notes: e.target.value }))
                }
                className="min-h-[60px] rounded-card border-border bg-background text-sm"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "rounded-full h-8 px-3 text-[11px] text-[#6B6B6B]",
            step === 1 && "invisible"
          )}
          onClick={() => {
            if (step === "review") {
              setStep(5);
            } else if (step > 1) {
              setStep(((step as number) - 1) as Step);
            }
          }}
        >
          Back
        </Button>
        {step === "review" ? (
          <Button
            type="button"
            size="sm"
            className="rounded-full h-8 px-4 bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
            disabled={saving || !summary.title.trim() || !summary.summary.trim()}
            onClick={() => void handleSaveIncident()}
          >
            {saving ? "Saving…" : "Save incident"}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="rounded-full h-8 px-4 bg-[#5B7A52] text-xs text-white hover:bg-[#476242]"
            disabled={
              (step === 1 && !canContinueFromStep1) ||
              (step === 2 && !canContinueFromStep2) ||
              (step === 3 && !canContinueFromStep3) ||
              (step === 4 && !canContinueFromStep4)
            }
            onClick={() => {
              if (step === 5) {
                setSummary(buildInitialSummary());
                setStep("review");
              } else {
                setStep(((step as number) + 1) as Step);
              }
            }}
          >
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

