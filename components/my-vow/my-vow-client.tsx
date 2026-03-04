"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";
import { Info, Lock, Pencil, Pin, Trash2 } from "lucide-react";

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

type VowStats = {
  messages_sent: number;
  messages_softened: number;
  calm_streak_days: number;
};

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
  const [editModalVow, setEditModalVow] = useState<Vow | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [stats, setStats] = useState<VowStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const vowListRef = useRef<HTMLDivElement | null>(null);

  function autoResizeTextarea(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    setVows(
      [...initialVows].sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
    );
  }, [initialVows]);

  useEffect(() => {
    autoResizeTextarea(textareaRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatsLoading(true);
      try {
        const res = await fetch("/api/vows/stats");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok)
          setStats(data as VowStats);
        else if (!cancelled)
          setStats(null);
      } catch {
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pinnedVows = vows.filter((v) => v.is_pinned);
  const hasNoMessages = stats ? stats.messages_sent === 0 : true;

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
        showErrorToast(
          (data as { message?: string }).message ?? "Failed to save vow."
        );
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
        showSuccessToast("Vow saved");
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
      if (!res.ok) {
        const msg = (data as { message?: string }).message ?? "Failed to update pinned vow.";
        if (msg === "You can pin up to 3 vows at a time") {
          showErrorToast("You can pin up to 3 vows. Unpin one to add another.");
        } else {
          showErrorToast(msg);
        }
        return;
      }
      const saved = (data as { vow?: Vow }).vow;
      if (saved) {
        setVows((prev) => {
          const next = prev.map((v) => (v.id === saved.id ? saved : v));
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

  function openEditModal(vow: Vow) {
    setEditModalVow(vow);
    setEditDraft(vow.content);
  }

  function closeEditModal() {
    setEditModalVow(null);
    setEditDraft("");
  }

  async function handleSaveEdit() {
    if (!editModalVow) return;
    const content = editDraft.trim();
    if (!content) return;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/vows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editModalVow.id,
          content,
          is_pinned: editModalVow.is_pinned,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showErrorToast(
          (data as { message?: string }).message ?? "Failed to update vow."
        );
        return;
      }
      const saved = (data as { vow?: Vow }).vow;
      if (saved) {
        setVows((prev) => {
          const next = prev.map((v) => (v.id === saved.id ? saved : v));
          next.sort((a, b) => {
            if (a.is_pinned && !b.is_pinned) return -1;
            if (!a.is_pinned && b.is_pinned) return 1;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
          return next;
        });
        showSuccessToast("Vow updated");
        closeEditModal();
      }
    } finally {
      setSavingEdit(false);
    }
  }

  const iconBtnClass =
    "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors text-[#8A8A8A] hover:text-[#5B7A52] hover:bg-[#E8EDE3]/50";

  return (
    <div className="min-h-[calc(100vh-4.5rem)] bg-[#FDFBF7]">
      <div className="px-3 pt-3 pb-6 md:px-4 md:pt-5 md:pb-8">
        <header className="mb-4 text-center">
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
              Sage may gently reference your pinned vows during private conversations. Your vows remain private.
            </span>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(260px,40%)_minmax(0,1fr)] items-start">
          {/* LEFT COLUMN — Write your vow */}
          <div className="rounded-2xl border border-[#E8E4DC]/70 bg-white/90 p-3 md:p-4 space-y-3">
            <div>
              <h2 className="font-heading text-lg font-semibold text-[#3D3D3D]">
                Your Vow
              </h2>
              <p className="text-xs text-foreground-secondary mt-0.5">
                {PLACEHOLDER}
              </p>
            </div>
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                autoResizeTextarea(textareaRef.current);
              }}
              placeholder={PLACEHOLDER}
              className="min-h-[96px] max-h-[260px] resize-none rounded-xl border-[#E8E4DC]/80 bg-[#FDFBF7] px-3 py-2 text-sm leading-snug text-foreground placeholder:text-muted-foreground"
            />
            <Button
              type="button"
              size="sm"
              className="w-full rounded-full h-8 bg-[#5B7A52] hover:bg-[#476242] text-white text-xs md:text-sm"
              disabled={saving || !draft.trim()}
              onClick={() => void handleSaveVow()}
            >
              {saving ? "Saving…" : "Save Vow"}
            </Button>
            <p className="flex items-center gap-1.5 text-[11px] text-foreground-secondary">
              <Lock className="h-3 w-3 shrink-0" aria-hidden />
              <span>Private to you. Not shared or included in reports.</span>
            </p>

            <section className="pt-3 border-t border-[#E8E4DC]/70 space-y-2.5">
              <h3 className="font-heading text-sm font-semibold text-foreground">
                Starter vows
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {STARTER_VOWS.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => setDraft(text)}
                    className="inline-flex items-center text-left text-[11px] rounded-full border border-[#E8E4DC] bg-[#FDFBF7] px-3 py-1.5 text-foreground-secondary hover:border-[#7C8B6E] hover:bg-[#F2F5EF] transition-colors"
                  >
                    {text}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDraft("")}
                  className="text-[11px] text-[#5B7A52] underline-offset-2 hover:underline px-1 py-0.5"
                >
                  Write my own
                </button>
              </div>
            </section>
          </div>

          {/* RIGHT COLUMN — Pinned vows + Your vows list */}
          <div className="rounded-2xl border border-[#E8E4DC]/60 bg-white/80 p-3 md:p-4 space-y-3">
            {/* Pinned vows anchor area */}
            <section className="space-y-2.5">
              {pinnedVows.length === 0 ? (
                <div className="rounded-xl border-l-[3px] border-l-[#5B7A52] bg-[#F2F5EF] px-3 py-3 md:px-4 md:py-4 flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E8EDE3]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/dove-translucent.png"
                      alt="Sage dove"
                      style={{
                        width: "20px",
                        height: "20px",
                        objectFit: "contain",
                        display: "block",
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-[#6A7A6E]">
                      Your anchors
                    </p>
                    <p className="mt-1 text-sm md:text-base text-[#6A7A6E]">
                      Pin up to 3 vows to set your anchors. Sage will gently reference them during coaching.
                    </p>
                    <p className="mt-1 text-[11px] text-[#8A8A8A]">
                      No pinned vows yet.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-[11px] font-medium text-[#6A7A6E] px-0.5">
                    {pinnedVows.length === 1 ? "Your anchor" : "Your anchors"}
                  </p>
                  {pinnedVows.map((vow, index) => (
                    <div
                      key={vow.id}
                      className="rounded-xl border-l-[3px] border-l-[#5B7A52] bg-[#F2F5EF] px-3 py-3 md:px-4 md:py-4 flex items-start gap-3"
                    >
                      {index === 0 ? (
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E8EDE3]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src="/dove-translucent.png"
                            alt="Sage dove"
                            style={{
                              width: "20px",
                              height: "20px",
                              objectFit: "contain",
                              display: "block",
                            }}
                          />
                        </div>
                      ) : (
                        <div className="mt-0.5 h-8 w-8 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm md:text-base text-[#2F3E34] whitespace-pre-wrap">
                              {vow.content}
                            </p>
                            <p className="mt-1 text-[11px] text-[#8A8A8A]">
                              Pinned{" "}
                              {new Date(vow.created_at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </p>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(vow)}
                              className={iconBtnClass}
                              aria-label="Edit vow"
                              title="Edit vow"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handlePin(vow.id)}
                              disabled={pinningId !== null}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#5B7A52] hover:bg-[#E8EDE3] transition-colors"
                              aria-label="Unpin vow"
                              title="Unpin vow"
                            >
                              <Pin className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </section>

            {/* Your Communication stats row */}
            <section className="space-y-2">
              <div>
                <h2 className="font-heading text-sm font-semibold text-[#3D3D3D]">
                  Your Communication
                </h2>
                <p className="text-[11px] text-foreground-secondary mt-0.5">
                  Last 30 days. Private to you.
                </p>
              </div>
              <div className="flex flex-wrap items-stretch gap-3">
                <div className="min-w-0 flex-1 rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] p-4">
                  <p className="text-[28px] font-semibold leading-none text-[#5B7A52]">
                    {statsLoading
                      ? "…"
                      : hasNoMessages
                        ? "—"
                        : stats?.messages_sent ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-foreground-secondary">
                    Messages sent
                  </p>
                </div>
                <div className="min-w-0 flex-1 rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] p-4">
                  <p className="text-[28px] font-semibold leading-none text-[#5B7A52]">
                    {statsLoading
                      ? "…"
                      : hasNoMessages
                        ? "—"
                        : stats?.messages_softened ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-foreground-secondary">
                    Softened by Sage
                  </p>
                </div>
                <div className="min-w-0 flex-1 rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] p-4">
                  <p className="text-[28px] font-semibold leading-none text-[#5B7A52]">
                    {statsLoading
                      ? "…"
                      : hasNoMessages
                        ? "—"
                        : stats?.calm_streak_days != null
                          ? `${stats.calm_streak_days} days`
                          : "—"}
                  </p>
                  <p className="mt-1 text-xs text-foreground-secondary">
                    Calm streak
                  </p>
                </div>
              </div>
              {!statsLoading && hasNoMessages && (
                <p className="text-[11px] text-foreground-secondary">
                  No messages in this period
                </p>
              )}
            </section>

            {/* Your vows list */}
            <div ref={vowListRef}>
              <div>
                <h2 className="font-heading text-lg font-semibold text-[#3D3D3D]">
                  Your Vows
                </h2>
                <p className="text-[11px] text-foreground-secondary mt-1">
                  Pin up to 3 vows for Sage to reference during coaching.
                </p>
              </div>

              {vows.length === 0 ? (
                <p className="text-sm text-foreground-secondary py-4 text-center">
                  No vows yet. Write your first vow to anchor your intentions.
                </p>
              ) : (
                <ul className="mt-2.5 space-y-2.5">
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
                          "rounded-xl border px-3 py-2.5 transition-colors",
                          isPinned
                            ? "border-[#D2DECF] bg-[#F2F5EF]"
                            : "border-[#E8E4DC] bg-[#FDFBF7]"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            {isPinned && (
                              <p className="text-[10px] font-medium text-[#5B7A52] mb-1">
                                🕊 Active
                              </p>
                            )}
                            <p className="text-sm text-foreground whitespace-pre-wrap leading-snug">
                              {v.content}
                            </p>
                            <p className="text-[10px] text-foreground-secondary mt-1.5">
                              {dateLabel}
                            </p>
                          </div>
                          <div className="ml-1 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handlePin(v.id)}
                              disabled={pinningId !== null}
                              className={cn(
                                "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                                isPinned
                                  ? "text-[#5B7A52] hover:bg-[#E8EDE3]"
                                  : "text-[#8A8A8A] hover:text-[#5B7A52] hover:bg-[#E8EDE3]/50"
                              )}
                              aria-label={isPinned ? "Unpin vow" : "Pin vow"}
                              title={isPinned ? "Unpin" : "Pin for Sage"}
                            >
                              <Pin className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(v)}
                              className={iconBtnClass}
                              aria-label="Edit vow"
                              title="Edit vow"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(v.id)}
                              disabled={deletingId !== null}
                              className={iconBtnClass}
                              aria-label="Delete vow"
                              title="Delete vow"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
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

      {/* Edit Vow modal */}
      {editModalVow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && closeEditModal()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-vow-title"
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#E8E4DC] bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="edit-vow-title"
              className="font-heading text-lg font-semibold text-[#3D3D3D]"
            >
              Edit Vow
            </h2>
            <Textarea
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              placeholder={PLACEHOLDER}
              className="mt-3 min-h-[100px] resize-none rounded-xl border-[#E8E4DC]/80 bg-[#FDFBF7] px-3 py-2 text-sm leading-snug"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full border-[#E8E4DC] text-foreground hover:bg-muted"
                onClick={closeEditModal}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="rounded-full bg-[#5B7A52] hover:bg-[#476242] text-white"
                disabled={savingEdit || !editDraft.trim()}
                onClick={() => void handleSaveEdit()}
              >
                {savingEdit ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
