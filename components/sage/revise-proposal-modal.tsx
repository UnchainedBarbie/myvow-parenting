"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type ReviseProposalModalProps = {
  open: boolean;
  proposalType: "reply_coparent" | "ask_clarification";
  originalDraft: string;
  initialText: string;
  itemId: string;
  proposalIndex: number;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * Reuses the ConfirmModal / event-request shell:
 * fixed inset-0 overlay, rounded-2xl cream panel, click-outside to cancel.
 */
export function ReviseProposalModal({
  open,
  proposalType,
  originalDraft,
  initialText,
  itemId,
  proposalIndex,
  onClose,
  onSaved,
}: ReviseProposalModalProps) {
  const [text, setText] = useState(initialText);
  const [guidance, setGuidance] = useState("");
  const [redrafting, setRedrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setText(initialText);
      setGuidance("");
      setError(null);
    }
  }, [open, initialText]);

  if (!open) return null;

  const title =
    proposalType === "ask_clarification"
      ? "Revise question to Co-Parent"
      : "Revise reply to Co-Parent";

  async function handleRedraft() {
    setRedrafting(true);
    setError(null);
    try {
      const res = await fetch("/api/sage-inbox/redraft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: itemId,
          proposal_index: proposalIndex,
          guidance,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { success?: boolean; draft?: string; error?: string }
        | null;
      if (!res.ok || !data?.draft) {
        setError(data?.error ?? "Redraft failed");
        return;
      }
      setText(data.draft);
    } catch {
      setError("Redraft failed");
    } finally {
      setRedrafting(false);
    }
  }

  async function handleSave() {
    const revised = text.trim();
    if (!revised) {
      setError("Message cannot be empty");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sage-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: itemId,
          action: "revise",
          proposal_index: proposalIndex,
          revised_text: revised,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Save failed");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revise-proposal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#E8E4DC] bg-[#FDFBF7] p-4 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="revise-proposal-title"
          className="font-heading text-base font-semibold text-[#3D3D3D]"
        >
          {title}
        </h2>
        <p className="mt-2 text-[11px] text-[#8A8A8A]">
          Sage suggested: {originalDraft}
        </p>

        <div className="mt-3 space-y-1.5">
          <Label className="text-[11px] text-foreground-secondary">
            How should Sage adjust this? (optional)
          </Label>
          <div className="flex gap-2">
            <Input
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder='e.g. "shorter" or "just agree to 5:30"'
              className="h-8 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 rounded-full text-xs"
              disabled={redrafting || saving}
              onClick={handleRedraft}
            >
              {redrafting ? "…" : "Redraft"}
            </Button>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          <Label className="text-[11px] text-foreground-secondary">Your message</Label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="text-sm"
          />
        </div>

        {error && (
          <p className="mt-2 text-[11px] text-foreground-secondary">{error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full text-xs"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-full bg-[#7B9E87] text-xs text-white hover:bg-[#6A8A78]"
            onClick={handleSave}
            disabled={saving || redrafting || !text.trim()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
