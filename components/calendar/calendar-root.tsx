"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarMonth, type CalendarEventRow } from "@/components/calendar/calendar-month";
import { UpcomingEventsList } from "@/components/calendar/upcoming-events-list";
import { EventDetailModal } from "@/components/calendar/event-detail-modal";
import type { CustodyOverridesMap } from "@/components/calendar/calendar-with-custody";

type Child = { id: string; first_name: string };

type UpcomingEvent = {
  id: string;
  title: string;
  event_type: string | null;
  child_name: string | null;
  start_time: string;
  status: string | null;
};

export type CustodyScheduleForOverlay = {
  schedule_type: string;
  rotation_start_date: string | null;
  user_starts_first: boolean | null;
  manual_pattern?: (string | null)[] | null;
} | null;

interface CalendarRootProps {
  caseId: string;
  events: CalendarEventRow[];
  upcoming: UpcomingEvent[];
  /** Merged list (month + full upcoming) so clicking any upcoming row can resolve the event for the modal. */
  eventsForModal: CalendarEventRow[];
  children: Child[];
  /** When false, hide the Upcoming Events section (e.g. in List view). Default true. */
  showUpcoming?: boolean;
  /** Optional: use for header/nav when events span a wide range (e.g. list view). */
  year?: number;
  month?: number;
  userId?: string;
  /** Custody overlay: from client fetch (CalendarWithCustody). */
  custodySchedule?: CustodyScheduleForOverlay;
  custodyOverrides?: CustodyOverridesMap;
  custodyOverlayOn?: boolean;
  onCustodyOverlayChange?: (on: boolean) => void;
  appMode?: string | null;
}

export function CalendarRoot({
  caseId,
  events,
  upcoming,
  eventsForModal,
  children,
  showUpcoming = true,
  year: yearProp,
  month: monthProp,
  userId = "",
  custodySchedule = null,
  custodyOverrides = {},
  custodyOverlayOn = false,
  onCustodyOverlayChange,
  appMode = null,
}: CalendarRootProps) {
  const router = useRouter();
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventRow | null>(
    null
  );
  const [modalOpen, setModalOpen] = useState(false);

  const fallbackDate = events[0]?.start_time ?? Date.now();
  const year = yearProp ?? new Date(fallbackDate).getFullYear();
  const month = monthProp ?? new Date(fallbackDate).getMonth() + 1;

  function handleEventClick(ev: CalendarEventRow) {
    setSelectedEvent(ev);
    setModalOpen(true);
  }

  function handleClose() {
    setModalOpen(false);
    setSelectedEvent(null);
  }

  return (
    <>
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <CalendarMonth
          year={year}
          month={month}
          events={events}
          caseId={caseId}
          children={children}
          onEventClick={handleEventClick}
          onRefresh={() => router.refresh()}
          custodySchedule={custodySchedule}
          custodyOverrides={custodyOverrides}
          custodyOverlayOn={custodyOverlayOn}
          onCustodyOverlayChange={onCustodyOverlayChange}
          appMode={appMode}
          userId={userId}
        />
        {showUpcoming && (
          <UpcomingEventsList
            caseId={caseId}
            upcoming={upcoming}
            events={eventsForModal}
            children={children}
            onEventClick={handleEventClick}
            onRefresh={() => router.refresh()}
          />
        )}
      </div>
      <EventDetailModal
        open={modalOpen && !!selectedEvent}
        onClose={handleClose}
        event={selectedEvent}
        caseId={caseId}
        children={children}
        onSaved={() => router.refresh()}
      />
    </>
  );
}

