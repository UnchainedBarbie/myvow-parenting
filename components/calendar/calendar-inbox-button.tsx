"use client";

import { useState } from "react";
import { CalendarInbox } from "@/components/calendar/calendar-inbox";
import { Button } from "@/components/ui/button";

export function CalendarInboxButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="text-xs">
        Inbox
      </Button>
      <CalendarInbox open={open} onClose={() => setOpen(false)} />
    </>
  );
}
