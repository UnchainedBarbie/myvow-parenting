"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ChildRow = { id: string; first_name: string };

type SchoolCalendarRow = {
  id: string;
  school_name: string | null;
  school_year: string;
  district: string | null;
  extracted_breaks?: {
    breaks?: Record<string, { start?: string; end?: string } | null>;
    key_dates?: { last_day_of_school?: string | null; first_day_of_school_next_year?: string | null };
  };
};

const BREAK_LABELS: Record<string, string> = {
  fall_break: "Fall Break",
  thanksgiving_break: "Thanksgiving Break",
  winter_break: "Winter Break",
  spring_break: "Spring Break",
  summer_break: "Summer Break",
};

function formatRange(start: string | undefined, end: string | undefined): string {
  if (!start) return "—";
  const d = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return end && end !== start ? `${d(start)} – ${d(end)}` : d(start);
}

export function SchoolCalendarSection({
  caseId,
  children: childrenProp,
}: {
  caseId: string | null;
  children: ChildRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [calendars, setCalendars] = useState<SchoolCalendarRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCalendar, setImportedCalendar] = useState<SchoolCalendarRow | null>(null);
  const [assignChecked, setAssignChecked] = useState<Record<string, boolean>>({});
  const [assignSaving, setAssignSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId) return;
    setLoading(true);
    fetch(`/api/school-calendar?case_id=${encodeURIComponent(caseId)}`)
      .then((r) => r.json())
      .then((data) => setCalendars(Array.isArray(data) ? data : []))
      .catch(() => setCalendars([]))
      .finally(() => setLoading(false));
  }, [caseId, importedCalendar]);

  async function handleImport() {
    if (!caseId || !calendarUrl.trim()) return;
    setImportError(null);
    setImportedCalendar(null);
    setImporting(true);
    try {
      const res = await fetch("/api/school-calendar/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: caseId,
          calendar_url: calendarUrl.trim(),
          school_name: schoolName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportError((data as { error?: string }).error ?? "Import failed");
        return;
      }
      setImportedCalendar((data as { calendar?: SchoolCalendarRow }).calendar ?? null);
      setCalendarUrl("");
      setSchoolName("");
      setAssignChecked({});
      router.refresh();
    } finally {
      setImporting(false);
    }
  }

  async function handleSaveAssignments() {
    if (!importedCalendar) return;
    setAssignSaving(true);
    try {
      const checked = Object.entries(assignChecked).filter(([, v]) => v).map(([id]) => id);
      await Promise.all(
        childrenProp.map((c) =>
          fetch(`/api/children/${c.id}/update`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              school_calendar_id: checked.includes(c.id) ? importedCalendar.id : null,
            }),
          })
        )
      );
      setImportedCalendar(null);
      router.refresh();
    } finally {
      setAssignSaving(false);
    }
  }

  async function handleRemove(cal: SchoolCalendarRow) {
    setRemovingId(cal.id);
    try {
      const res = await fetch(`/api/school-calendar/${cal.id}`, { method: "PATCH" });
      if (res.ok) {
        setCalendars((prev) => prev.filter((c) => c.id !== cal.id));
        if (importedCalendar?.id === cal.id) setImportedCalendar(null);
        router.refresh();
      }
    } finally {
      setRemovingId(null);
    }
  }

  function renderBreaks(cal: SchoolCalendarRow) {
    const breaks = cal.extracted_breaks?.breaks ?? {};
    const keyDates = cal.extracted_breaks?.key_dates ?? {};
    const lines: { label: string; text: string }[] = [];
    (Object.entries(breaks) as [string, { start?: string; end?: string } | null][]).forEach(([key, val]) => {
      if (val?.start) lines.push({ label: BREAK_LABELS[key] ?? key, text: formatRange(val.start, val.end ?? val.start) });
    });
    if (keyDates.last_day_of_school) lines.push({ label: "Last Day of School", text: formatRange(keyDates.last_day_of_school, undefined) });
    if (keyDates.first_day_of_school_next_year) lines.push({ label: "First Day (Next Year)", text: formatRange(keyDates.first_day_of_school_next_year, undefined) });
    return lines;
  }

  if (!caseId) return null;

  return (
    <div className="pt-4 mt-4 border-t border-border">
      <button
        type="button"
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-4 w-4 text-foreground-secondary shrink-0" /> : <ChevronRight className="h-4 w-4 text-foreground-secondary shrink-0" />}
        <h3 className="text-sm font-semibold text-foreground">School Calendars</h3>
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          {calendars.length === 0 && !importedCalendar && (
            <p className="text-sm text-foreground-secondary">Add your school district calendar to automatically fill in holiday dates.</p>
          )}

          <div className="rounded-card border border-border bg-muted/20 p-3 space-y-3">
            <Label className="text-xs font-medium text-foreground-secondary">Add School Calendar</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label htmlFor="school-name" className="text-xs">School name (optional)</Label>
                <Input
                  id="school-name"
                  placeholder="e.g. Cherry Creek High School"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  className="mt-0.5"
                />
              </div>
              <div>
                <Label htmlFor="calendar-url" className="text-xs">Calendar URL *</Label>
                <Input
                  id="calendar-url"
                  placeholder="Paste district calendar URL"
                  value={calendarUrl}
                  onChange={(e) => setCalendarUrl(e.target.value)}
                  className="mt-0.5"
                />
              </div>
            </div>
            {importError && (
              <p className="text-sm text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-200 rounded-card px-2 py-1.5">{importError}</p>
            )}
            <Button
              type="button"
              size="sm"
              className="rounded-full h-9 text-sm bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
              disabled={importing || !calendarUrl.trim()}
              onClick={handleImport}
            >
              {importing ? "Reading calendar... ✨" : "Import"}
            </Button>
          </div>

          {importedCalendar && (
            <Card className="border-border bg-[#7B9E87]/10 rounded-card">
              <CardHeader className="pb-2">
                <CardTitle className="font-heading text-sm font-semibold text-foreground">
                  {importedCalendar.school_name ?? "School"} — {importedCalendar.school_year}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <ul className="text-sm text-foreground-secondary space-y-1">
                  {renderBreaks(importedCalendar).map(({ label, text }) => (
                    <li key={label}>{label}: {text}</li>
                  ))}
                </ul>
                {childrenProp.length > 0 && (
                  <>
                    <p className="text-xs font-medium text-foreground-secondary">Assign children to this school</p>
                    <div className="flex flex-wrap gap-3">
                      {childrenProp.map((c) => (
                        <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={assignChecked[c.id] ?? false}
                            onChange={(e) => setAssignChecked((p) => ({ ...p, [c.id]: e.target.checked }))}
                            className="rounded border-border"
                          />
                          <span className="text-sm text-foreground">{c.first_name}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full h-8 text-xs bg-[#7B9E87] hover:bg-[#6A8A78] text-white"
                  disabled={assignSaving}
                  onClick={handleSaveAssignments}
                >
                  {assignSaving ? "Saving…" : "Save"}
                </Button>
              </CardContent>
            </Card>
          )}

          {loading ? (
            <p className="text-sm text-foreground-secondary">Loading calendars…</p>
          ) : calendars.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground-secondary">Existing calendars</p>
              {calendars.map((cal) => {
                const lines = renderBreaks(cal);
                const isExpanded = expandedId === cal.id;
                return (
                  <div key={cal.id} className="rounded-card border border-border bg-background overflow-hidden">
                    <div className="flex items-center justify-between gap-2 py-2 px-3">
                      <button
                        type="button"
                        className="flex items-center gap-2 min-w-0 flex-1 text-left"
                        onClick={() => setExpandedId(isExpanded ? null : cal.id)}
                      >
                        {lines.length > 0 ? (isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-foreground-secondary" /> : <ChevronRight className="h-4 w-4 shrink-0 text-foreground-secondary" />) : null}
                        <span className="text-sm font-medium text-foreground truncate">{cal.school_name ?? "School"} — {cal.school_year}</span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs h-8"
                        disabled={removingId === cal.id}
                        onClick={() => handleRemove(cal)}
                      >
                        {removingId === cal.id ? "Removing…" : "Remove"}
                      </Button>
                    </div>
                    {isExpanded && lines.length > 0 && (
                      <div className="px-3 pb-2 pt-0 border-t border-border">
                        <ul className="text-sm text-foreground-secondary space-y-1 mt-2">
                          {lines.map(({ label, text }) => (
                            <li key={label}>{label}: {text}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
