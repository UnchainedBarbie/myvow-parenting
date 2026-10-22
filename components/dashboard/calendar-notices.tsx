import Link from "next/link";
import type { CalendarNoticeCard } from "@/lib/calendar/load-calendar-notices";

export function CalendarNotices({ cards }: { cards: CalendarNoticeCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {cards.map((card) => (
        <div key={card.id} className="rounded-card border border-border bg-background px-4 py-3 text-sm">
          <p className="font-semibold mb-1">{card.title}</p>
          <p className="text-xs text-foreground-secondary whitespace-pre-line">{card.text}</p>
          {card.href ? (
            <Link href={card.href} className="mt-2 inline-block text-xs font-medium text-foreground underline">
              Open event
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}
