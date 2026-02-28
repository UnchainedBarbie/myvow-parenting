// Shared date/time utilities for consistent local/UTC handling
// Assumes all ISO strings from the database are UTC (with Z or equivalent).

export function getLocalDateInputFromUtc(isoUtc: string): string {
  if (!isoUtc) return "";
  const d = new Date(isoUtc);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getLocalTimeInputFromUtc(isoUtc: string | null | undefined): string {
  if (!isoUtc) return "";
  const d = new Date(isoUtc);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function buildUtcIsoFromLocal(dateInput: string, timeInput: string | null): string | null {
  if (!dateInput) return null;
  const [yearStr, monthStr, dayStr] = dateInput.split("-");
  const [hourStr = "0", minuteStr = "0"] = (timeInput ?? "").split(":");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1; // JS Date month is 0-based
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;

  const local = new Date(year, month, day, hour, minute, 0, 0);
  return local.toISOString();
}

export function formatLocalDateTimeRange(
  startIsoUtc: string,
  endIsoUtc: string | null,
  allDay: boolean
): string {
  const start = new Date(startIsoUtc);
  const end = endIsoUtc ? new Date(endIsoUtc) : null;

  const dateStr = start.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (allDay) {
    return `${dateStr} · All day`;
  }

  const startTime = start.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (!end) {
    return `${dateStr} · ${startTime}`;
  }

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  const endTime = end.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  if (sameDay) {
    return `${dateStr} · ${startTime} – ${endTime}`;
  }

  const endDate = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return `${dateStr} · ${startTime} – ${endDate} ${endTime}`;
}

export function formatLocalDate(isoUtc: string): string {
  const d = new Date(isoUtc);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatLocalTime(isoUtc: string | null): string {
  if (!isoUtc) return "—";
  const d = new Date(isoUtc);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatLocalDateTime(isoUtc: string): string {
  const d = new Date(isoUtc);
  const dateStr = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${dateStr} · ${timeStr}`;
}

/**
 * Parse flexible time input (e.g. "8:00 PM", "8pm", "20:00") to HH:mm 24h or null if invalid.
 */
export function parseTimeInput(str: string): string | null {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  if (!s) return null;

  // 24h: 20:00, 08:00, 0:00, 23:59
  const match24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1], 10);
    const m = parseInt(match24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
    return null;
  }

  // 12h with optional am/pm: 8:00 pm, 8 pm, 8pm, 8:00am, 12:30 pm
  const lower = s.toLowerCase();
  const match12 = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = match12[2] !== undefined ? parseInt(match12[2], 10) : 0;
    const ampm = (match12[3] ?? "").toLowerCase();
    if (m < 0 || m > 59) return null;
    if (ampm === "am" || ampm === "pm") {
      if (h < 1 || h > 12) return null;
      if (ampm === "pm" && h !== 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
    } else {
      // No am/pm: treat as 24h if in range
      if (h >= 0 && h <= 23) {
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
      // 1–12 without am/pm: assume AM
      if (h >= 1 && h <= 12) {
        const hour24 = h === 12 ? 0 : h;
        return `${String(hour24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
      return null;
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  return null;
}

/**
 * Format HH:mm (24h) for display as 12h with AM/PM (e.g. "20:00" -> "8:00 PM").
 */
export function formatTimeForDisplay(hhmm: string | null): string {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return "";
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Lightweight self-tests (run manually if desired)
export function runTimeUtilSelfTests() {
  const sampleLocal = new Date(2026, 1, 15, 9, 0, 0, 0); // Feb 15 2026, 9:00 local
  const sampleIso = sampleLocal.toISOString();

  const dateInput = getLocalDateInputFromUtc(sampleIso);
  const timeInput = getLocalTimeInputFromUtc(sampleIso);
  const roundTripIso = buildUtcIsoFromLocal(dateInput, timeInput);

  // eslint-disable-next-line no-console
  console.log("[time utils test] dateInput", dateInput, "timeInput", timeInput);
  // eslint-disable-next-line no-console
  console.log("[time utils test] original", sampleIso, "roundTrip", roundTripIso);

  const range = formatLocalDateTimeRange(sampleIso, sampleIso, false);
  const dateOnly = formatLocalDate(sampleIso);
  const timeOnly = formatLocalTime(sampleIso);
  const dateTime = formatLocalDateTime(sampleIso);

  // eslint-disable-next-line no-console
  console.log("[time utils test] range", range);
  // eslint-disable-next-line no-console
  console.log("[time utils test] date", dateOnly, "time", timeOnly, "dateTime", dateTime);
}

