"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarMonth, type CalendarEventRow } from "@/components/calendar/calendar-month";
import { UpcomingEventsList } from "@/components/calendar/upcoming-events-list";
import { EventDetailModal } from "@/components/calendar/event-detail-modal";

type Child = { id: string; first_name: string };

type UpcomingEvent = {
  id: string;
  title: string;
  event_type: string | null;
  child_name: string | null;
  start_time: string;
  status: string | null;
};

interface CalendarRootProps {
  caseId: string;
  events: CalendarEventRow[];
  upcoming: UpcomingEvent[];
  /** Merged list (month + full upcoming) so clicking any upcoming row can resolve the event for the modal. */
  eventsForModal: CalendarEventRow[];
  children: Child[];
}

export function CalendarRoot({
  caseId,
  events,
  upcoming,
  eventsForModal,
  children,
}: CalendarRootProps) {
  const router = useRouter();
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventRow | null>(
    null
  );
  const [modalOpen, setModalOpen] = useState(false);

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
          year={new Date(events[0]?.start_time ?? Date.now()).getFullYear()}
          month={new Date(events[0]?.start_time ?? Date.now()).getMonth() + 1}
          events={events}
          caseId={caseId}
          children={children}
          onEventClick={handleEventClick}
          onRefresh={() => router.refresh()}
        />
        <UpcomingEventsList
          caseId={caseId}
          upcoming={upcoming}
          events={eventsForModal}
          children={children}
          onEventClick={handleEventClick}
          onRefresh={() => router.refresh()}
        />
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

