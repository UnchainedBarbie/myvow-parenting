"use client";

import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Info, Lock, Pin, Trash2 } from "lucide-react";

export type Vow = {
  id: string;
  content: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
};

const STARTER_VOWS = [
  "I vow to love my children more than I resent conflict.",
  "I vow to respond calmly, even when it's difficult.",
  "I vow to prioritize long-term stability over short-term emotion.",
  "I vow to prioritize my child's wellbeing in every interaction.",
];

const PLACEHOLDER = "What kind of parent do you want to be when things get hard?";

type Props = {
  initialVows: Vow[];
};

export function MyVowClient({ initialVows }: Props) {
  const [vows, setVows] = useState<Vow[]>(() =>
    [...initialVows].sort((a, b) => {
      if (a.is_pinned && !b.is_pinned) return -1;
      if (!a.is_pinned && b.is_pinned) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
  );
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setVows(
      [...initialVows].sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
    );
  }, [initialVows]);

  async function handleSaveVow() {
    const content = draft.trim();
    if (!content) return;
    setSaving(true);
    try {
      const res = await fetch("/api/vows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, is_pinned: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert((data as { message?: string }).message ?? "Failed to save vow.");
        return;
      }
      const saved = (data as { vow?: Vow }).vow;
      if (saved) {
        setDraft("");
        setVows((prev) => {
          const next = [saved, ...prev];
          next.sort((a, b) => {
            if (a.is_pinned && !b.is_pinned) return -1;
            if (!a.is_pinned && b.is_pinned) return 1;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
          return next;
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handlePin(id: string) {
    const vow = vows.find((v) => v.id === id);
    if (!vow) return;
    setPinningId(id);
    try {
      const res = await fetch("/api/vows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          content: vow.content,
          is_pinned: !vow.is_pinned,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const saved = (data as { vow?: Vow }).vow;
      if (saved) {
        setVows((prev) => {
          const next = prev.map((v) =>
            v.id === saved.id ? saved : saved.is_pinned && v.is_pinned ? { ...v, is_pinned: false } : v
          );
          next.sort((a, b) => {
            if (a.is_pinned && !b.is_pinned) return -1;
            if (!a.is_pinned && b.is_pinned) return 1;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
          return next;
        });
      }
    } finally {
      setPinningId(null);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/vows/${id}`, { method: "DELETE" });
      if (res.ok) {
        setVows((prev) => prev.filter((v) => v.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-[calc(100vh-4.5rem)] bg-[#FDFBF7]">
      <div className="px-3 pt-3 pb-6 md:px-4 md:pt-6 md:pb-10">
        <header className="mb-6 text-center">
          <h1 className="font-heading text-2xl md:text-3xl font-semibold text-[#3D3D3D]">
            My Vow
          </h1>
          <div className="flex justify-center mt-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground-secondary">
              <span role="img" aria-label="Private">🔒</span>
              <span>Private to you</span>
            </span>
          </div>
          <p className="mt-2 text-xs md:text-sm text-foreground-secondary max-w-xl mx-auto">
            Your commitments as a parent. A quiet anchor for difficult moments.
          </p>
          <div className="flex items-center justify-center gap-1.5 mt-2 text-[11px] text-foreground-secondary">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-muted">
              <Info className="h-2.5 w-2.5" aria-hidden />
            </span>
            <span>
              Sage may gently reference your pinned vow during private conversations. Your vows remain private.
            </span>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(260px,40%)_minmax(0,1fr)] items-start">
          {/* LEFT COLUMN — Write your vow */}
          <div className="rounded-card border border-[#E8E4DC] bg-white shadow-card p-4 space-y-4">
            <div>
              <h2 className="font-heading text-lg font-semibold text-[#3D3D3D]">
                Your Vow
              </h2>
              <p className="text-xs text-foreground-secondary mt-0.5">
                {PLACEHOLDER}
              </p>
            </div>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={PLACEHOLDER}
              className="min-h-[160px] resize-y rounded-xl border-[#E8E4DC] bg-[#FDFBF7] text-sm text-foreground placeholder:text-muted-foreground"
            />
            <Button
              type="button"
              size="sm"
              className="w-full rounded-full h-9 bg-[#5B7A52] hover:bg-[#476242] text-white text-sm"
              disabled={saving || !draft.trim()}
              onClick={() => void handleSaveVow()}
            >
              {saving ? "Saving…" : "Save Vow"}
            </Button>
            <p className="flex items-center gap-1.5 text-[11px] text-foreground-secondary">
              <Lock className="h-3 w-3 shrink-0" aria-hidden />
              <span>Changes are private · Not shared or exported</span>
            </p>

            <section className="pt-4 border-t border-[#E8E4DC] space-y-3">
              <h3 className="font-heading text-sm font-semibold text-foreground">
                Starter vows
              </h3>
              <div className="space-y-1.5">
                {STARTER_VOWS.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => setDraft(text)}
                    className="block w-full text-left text-xs rounded-lg border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2 text-foreground-secondary hover:border-[#7C8B6E] hover:bg-[#F2F5EF] transition-colors"
                  >
                    {text}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDraft("")}
                  className="block w-full text-left text-xs rounded-lg border border-dashed border-[#E8E4DC] bg-[#FDFBF7] px-3 py-2 text-foreground-secondary hover:border-[#7C8B6E] hover:bg-[#F2F5EF] transition-colors"
                >
                  Write my own
                </button>
              </div>
            </section>
          </div>

          {/* RIGHT COLUMN — Your vows list */}
          <div className="rounded-card border border-[#E8E4DC] bg-white shadow-card p-4 space-y-4">
            <div>
              <h2 className="font-heading text-lg font-semibold text-[#3D3D3D]">
                Your Vows
              </h2>
              <p className="text-[11px] text-foreground-secondary mt-1">
                Pin a vow for Sage to gently reference during private coaching. Only one vow can be active at a time.
              </p>
            </div>

            {vows.length === 0 ? (
              <p className="text-sm text-foreground-secondary py-6 text-center">
                No vows yet. Write your first vow to anchor your intentions.
              </p>
            ) : (
              <ul className="space-y-3">
                {vows.map((v) => {
                  const dateLabel = new Date(v.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });
                  const isPinned = v.is_pinned;
                  return (
                    <li
                      key={v.id}
                      className={cn(
                        "rounded-xl border px-3 py-3 transition-colors",
                        isPinned
                          ? "border-l-4 border-l-[#7C8B6E] bg-[#F2F5EF] border-[#E8E4DC]"
                          : "border-[#E8E4DC] bg-[#FDFBF7]"
                      )}
                    >
                      {isPinned && (
                        <p className="text-[10px] font-medium text-[#5B7A52] mb-1.5">
                          Sage remembers this vow
                        </p>
                      )}
                      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                        {v.content}
                      </p>
                      <p className="text-[11px] text-foreground-secondary mt-2">
                        {dateLabel}
                      </p>
                      <div className="flex items-center justify-end gap-1 mt-2">
                        <button
                          type="button"
                          onClick={() => void handlePin(v.id)}
                          disabled={pinningId !== null}
                          className={cn(
                            "inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                            isPinned
                              ? "text-[#5B7A52] hover:bg-[#E8EDE3]"
                              : "text-foreground-secondary hover:bg-muted"
                          )}
                          aria-label={isPinned ? "Unpin vow" : "Pin vow"}
                          title={isPinned ? "Unpin" : "Pin for Sage"}
                        >
                          <Pin className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(v.id)}
                          disabled={deletingId !== null}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-secondary hover:bg-muted transition-colors"
                          aria-label="Delete vow"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
