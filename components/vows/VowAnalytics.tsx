"use client";

import { cn } from "@/lib/utils";

export type VowAnalyticsStats = {
  messages_sent: number;
  messages_softened: number;
  calm_streak_days: number;
  vow_alignment_pct: number | null;
};

interface VowAnalyticsProps {
  stats: VowAnalyticsStats | null;
  loading: boolean;
  onViewDetails?: () => void;
}

export function VowAnalytics({ stats, loading, onViewDetails }: VowAnalyticsProps) {
  const hasNoMessages = stats ? stats.messages_sent === 0 : true;

  return (
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
        <StatCard
          label="Messages sent"
          value={
            loading
              ? "…"
              : hasNoMessages
                ? "—"
                : stats?.messages_sent ?? "—"
          }
        />
        <StatCard
          label="Softened by Sage"
          value={
            loading
              ? "…"
              : hasNoMessages
                ? "—"
                : stats?.messages_softened ?? "—"
          }
        />
        <StatCard
          label="Calm streak"
          value={
            loading
              ? "…"
              : hasNoMessages
                ? "—"
                : stats?.calm_streak_days != null
                  ? `${stats.calm_streak_days} days`
                  : "—"
          }
        />
        <StatCard
          label="Vow alignment"
          helper={hasNoMessages ? "No messages yet." : "Messages aligned with your vows"}
          value={
            loading
              ? "…"
              : hasNoMessages
                ? "—"
                : stats?.vow_alignment_pct != null
                  ? `${stats.vow_alignment_pct}%`
                  : "—"
          }
        />
      </div>
      {!loading && hasNoMessages && (
        <p className="text-[11px] text-foreground-secondary">
          No messages in this period.
        </p>
      )}
      {!loading && !!onViewDetails && stats && (stats.vow_alignment_pct != null) && (
        <button
          type="button"
          className="mt-1 text-[11px] text-[#5B7A52] hover:underline underline-offset-2"
          onClick={onViewDetails}
        >
          View details
        </button>
      )}
    </section>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  helper?: string;
}

function StatCard({ label, value, helper }: StatCardProps) {
  return (
    <div className={cn(
      "min-w-0 flex-1 rounded-xl border border-[#E8E4DC] bg-[#FDFBF7] p-4",
    )}>
      <p className="text-[28px] font-semibold leading-none text-[#5B7A52]">
        {value}
      </p>
      <p className="mt-1 text-xs text-foreground-secondary">
        {label}
      </p>
      {helper && (
        <p className="mt-0.5 text-[11px] text-foreground-secondary">
          {helper}
        </p>
      )}
    </div>
  );
}

