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
  children: Child[];
}

export function CalendarRoot({
  caseId,
  events,
  upcoming,
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
      <div className="flex flex-col gap-1.5">
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
          events={events}
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

