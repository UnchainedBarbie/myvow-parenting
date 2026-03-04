"use client";

import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { showErrorToast, showSuccessToast } from "@/components/ui/toaster";
import { ChevronDown, ChevronRight, Info, Lock, Pin, Trash2 } from "lucide-react";

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

type AlignmentRange = "last_7" | "last_30" | "last_90" | "custom";

type AlignmentResponse = {
  range: { from: string; to: string } | null;
  vow: { id: string; text: string } | null;
  alignment: {
    score_avg_0_to_100: number;
    counts: { aligned: number; at_risk: number; off_vow: number; total: number };
    reasons_top: { reason: string; count: number }[];
    trend: { date: string; score_0_to_100: number }[];
  } | null;
  examples: {
    aligned?: { message_id: string; snippet: string; date: string; reasons: string[] };
    at_risk?: { message_id: string; snippet: string; date: string; reasons: string[] };
    off_vow?: { message_id: string; snippet: string; date: string; reasons: string[] };
  };
} | null;

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const vowListRef = useRef<HTMLDivElement | null>(null);

  const [alignmentRange, setAlignmentRange] = useState<AlignmentRange>("last_30");
  const [alignmentFrom, setAlignmentFrom] = useState<string | null>(null);
  const [alignmentTo, setAlignmentTo] = useState<string | null>(null);
  const [alignmentData, setAlignmentData] = useState<AlignmentResponse>(null);
  const [alignmentLoading, setAlignmentLoading] = useState(false);
  const [alignmentError, setAlignmentError] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);

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

  const pinnedVow = vows.find((v) => v.is_pinned) ?? null;

  useEffect(() => {
    if (!pinnedVow) {
      setAlignmentData(null);
      return;
    }
    if (alignmentRange === "custom" && (!alignmentFrom || !alignmentTo)) {
      setAlignmentData(null);
      return;
    }

    const controller = new AbortController();
    async function loadAlignment() {
      setAlignmentLoading(true);
      setAlignmentError(null);
      try {
        const params = new URLSearchParams();
        params.set("vowId", pinnedVow.id);
        params.set("range", alignmentRange);
        if (alignmentRange === "custom" && alignmentFrom && alignmentTo) {
          params.set("from", alignmentFrom);
          params.set("to", alignmentTo);
        }
        const res = await fetch(`/api/vows/alignment?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as AlignmentResponse | { message?: string };
        if (!res.ok) {
          setAlignmentError((data as { message?: string }).message ?? "Unable to load alignment right now.");
          setAlignmentData(null);
          return;
        }
        setAlignmentData(data as AlignmentResponse);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setAlignmentError("Unable to load alignment right now.");
        }
      } finally {
        setAlignmentLoading(false);
      }
    }

    void loadAlignment();

    return () => controller.abort();
  }, [pinnedVow?.id, alignmentRange, alignmentFrom, alignmentTo]);

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
              Sage may gently reference your pinned vow during private conversations. Your vows remain private.
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

          {/* RIGHT COLUMN — Alignment + Your vows list */}
          <div className="rounded-2xl border border-[#E8E4DC]/60 bg-white/80 p-3 md:p-4 space-y-3">
            {/* Alignment section */}
            <section className="rounded-xl border border-[#E0E0E0] bg-[#F8F8F8] px-3 py-2.5 md:px-3.5 md:py-3 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-heading text-sm md:text-base font-semibold text-[#2F3E34]">
                    Alignment
                  </h2>
                  <p className="text-[11px] text-foreground-secondary">
                    Based on messages you sent. Private to you.
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {(["last_7", "last_30", "last_90"] as AlignmentRange[]).map((range) => (
                    <button
                      key={range}
                      type="button"
                      onClick={() => setAlignmentRange(range)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors",
                        alignmentRange === range
                          ? "border-[#D0D9C8] bg-[#EEF3E8] text-[#2F3E34]"
                          : "border-transparent bg-transparent text-foreground-secondary hover:bg-[#F2F5EF]"
                      )}
                    >
                      {range === "last_7"
                        ? "7 days"
                        : range === "last_30"
                        ? "30 days"
                        : "90 days"}
                    </button>
                  ))}
                </div>
              </div>

              {!pinnedVow ? (
                <div className="rounded-lg border border-dashed border-[#D0D0D0] bg-[#F5F5F5] px-3 py-2.5 text-xs text-[#6A6A6A] flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-[#3D3D3D]">Pin a vow to see alignment.</p>
                    <p className="text-[11px]">
                      When a vow is active, we&apos;ll quietly summarize how closely recent messages match it.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full px-3 text-[11px] border-[#A0A0A0] text-[#3D3D3D] hover:bg-[#E8E8E8]"
                    onClick={() => {
                      vowListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    Pin a vow
                  </Button>
                </div>
              ) : alignmentLoading ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-5 w-20 rounded bg-[#E9E2D5]" />
                  <div className="flex gap-2">
                    <div className="h-10 flex-1 rounded bg-[#E9E2D5]" />
                    <div className="h-10 flex-1 rounded bg-[#EDE7DA]" />
                  </div>
                  <div className="h-4 w-32 rounded bg-[#EDE7DA]" />
                </div>
              ) : alignmentError ? (
                <p className="text-xs text-[#9A6B54]">{alignmentError}</p>
              ) : !alignmentData || !alignmentData.alignment ? (
                <p className="text-xs text-[#6A6A6A]">
                  {pinnedVow
                    ? "No messages in this period."
                    : "Pin a vow to see alignment."}
                </p>
              ) : (
                <>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-[#6A6A6A]">
                        Alignment score
                      </p>
                      <p className="text-2xl md:text-3xl font-semibold text-[#3D3D3D]">
                        {Math.round(alignmentData.alignment.score_avg_0_to_100)}
                      </p>
                      <p className="text-[10px] text-[#6A6A6A] mt-0.5">
                        Based on messages you sent in this period.
                      </p>
                    </div>
                    <div className="flex flex-1 justify-end gap-1.5">
                      {[
                        { key: "aligned", label: "Aligned" },
                        { key: "at_risk", label: "At-risk" },
                        { key: "off_vow", label: "Off-vow" },
                      ].map(({ key, label }) => {
                        const count =
                          alignmentData.alignment?.counts[
                            key as "aligned" | "at_risk" | "off_vow"
                          ] ?? 0;
                        const total = alignmentData.alignment?.counts.total ?? 0;
                        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                        return (
                          <div
                            key={key}
                            className="min-w-[72px] rounded-lg border border-[#D0D0D0] bg-[#F5F5F5] px-2 py-1.5"
                          >
                            <p className="text-[10px] text-[#6A6A6A]">{label}</p>
                            <p className="text-xs font-medium text-[#3D3D3D]">
                              {count}{" "}
                              <span className="text-[10px] text-[#6A6A6A]">
                                ({pct}%)
                              </span>
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {alignmentData.alignment.reasons_top.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-[#3D3D3D]">
                        What we&apos;re noticing, in neutral terms:
                      </p>
                      <ul className="space-y-0.5">
                        {alignmentData.alignment.reasons_top.slice(0, 4).map((r) => (
                          <li
                            key={r.reason}
                            className="text-[11px] text-[#6A6A6A] flex items-start gap-1.5"
                          >
                            <span className="mt-[5px] h-1.5 w-1.5 rounded-full bg-[#A0A0A0]" />
                            <span>{r.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="border-t border-[#E0E0E0] pt-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setShowExamples((prev) => !prev)}
                      className="flex w-full items-center justify-between text-[11px] text-[#6A6A6A] hover:text-[#3D3D3D] transition-colors"
                    >
                      <span>Examples from this period</span>
                      {showExamples ? (
                        <ChevronDown className="h-3 w-3" aria-hidden />
                      ) : (
                        <ChevronRight className="h-3 w-3" aria-hidden />
                      )}
                    </button>
                    {showExamples && (
                      <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {(["aligned", "at_risk", "off_vow"] as const).map((bucket) => {
                          const example = alignmentData.examples[bucket];
                          if (!example) return null;
                          const dateLabel = new Date(example.date).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric", year: "numeric" }
                          );
                          const title =
                            bucket === "aligned"
                              ? "Closer to your vow"
                              : bucket === "at_risk"
                              ? "Could use a gentler pass"
                              : "Further from your vow";
                          return (
                            <div
                              key={bucket}
                              className="rounded-lg border border-[#D0D0D0] bg-[#FAFAFA] px-2.5 py-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-medium text-[#3D3D3D]">
                                  {title}
                                </p>
                                <p className="text-[10px] text-[#6A6A6A]">
                                  {dateLabel}
                                </p>
                              </div>
                              <p className="mt-1 text-xs text-[#3D3D3D] line-clamp-2">
                                {example.snippet}
                              </p>
                              {example.reasons.length > 0 && (
                                <p className="mt-1 text-[10px] text-[#6A6A6A]">
                                  {example.reasons[0]}
                                </p>
                              )}
                            </div>
                          );
                        })}
                        {(!alignmentData.examples.aligned &&
                          !alignmentData.examples.at_risk &&
                          !alignmentData.examples.off_vow) && (
                          <p className="text-[11px] text-[#6A6A6A]">
                            No specific examples surfaced for this period.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>

            {/* Your vows list */}
            <div ref={vowListRef}>
              <div>
                <h2 className="font-heading text-lg font-semibold text-[#3D3D3D]">
                  Your Vows
                </h2>
                <p className="text-[11px] text-foreground-secondary mt-1">
                  Pin a vow for Sage to gently reference during private coaching. Only one vow can be active at a time.
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
                                  : "text-foreground-secondary hover:bg-muted"
                              )}
                              aria-label={isPinned ? "Unpin vow" : "Pin vow"}
                              title={isPinned ? "Unpin" : "Pin for Sage"}
                            >
                              <Pin className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(v.id)}
                              disabled={deletingId !== null}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-foreground-secondary hover:bg-muted transition-colors"
                              aria-label="Delete vow"
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
    </div>
  );
}
