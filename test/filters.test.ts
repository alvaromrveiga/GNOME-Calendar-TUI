import { expect, test } from "bun:test";
import {
  DEFAULT_FILTER,
  eventInRange,
  FILTER_LABELS,
  FILTER_MODES,
  type FilterMode,
  filterByNumber,
  filterEntries,
  filterRange,
  nextFilter,
} from "../src/filters";
import { type CalendarEvent, parseCalendar } from "../src/ics";

function makeEventWithDtstart(dtstart: string): CalendarEvent {
  const isDate = dtstart.length === 8;
  const params = isDate ? "VALUE=DATE" : "";
  const cal = parseCalendar(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:test",
      `DTSTART${params ? `;${params}` : ""}:${dtstart}`,
      "SUMMARY:Test",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\n"),
  );
  return cal.events[0]!;
}

function makeRecurringEvent(dtstart: string, rrule: string): CalendarEvent {
  const isDate = dtstart.length === 8;
  const params = isDate ? "VALUE=DATE" : "";
  const cal = parseCalendar(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:recurring",
      `DTSTART${params ? `;${params}` : ""}:${dtstart}`,
      `RRULE:${rrule}`,
      "SUMMARY:Recurring",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\n"),
  );
  return cal.events[0]!;
}

const NOW = new Date(2026, 5, 24);

test("FILTER_MODES has 5 modes in order: today, weekly, monthly, future, all", () => {
  expect(FILTER_MODES).toEqual(["today", "weekly", "monthly", "future", "all"]);
  expect(FILTER_MODES).toHaveLength(5);
});

test("DEFAULT_FILTER is weekly", () => {
  expect(DEFAULT_FILTER).toBe("weekly");
});

test("FILTER_LABELS has display names for all modes", () => {
  expect(FILTER_LABELS.today).toBe("Today");
  expect(FILTER_LABELS.weekly).toBe("Weekly");
  expect(FILTER_LABELS.monthly).toBe("Monthly");
  expect(FILTER_LABELS.future).toBe("All future");
  expect(FILTER_LABELS.all).toBe("All");
});

test("filterRange for 'all' returns full range", () => {
  const r = filterRange("all");
  expect(r.start).toBe("00000000");
  expect(r.end).toBe("99999999");
});

test("filterRange for 'today' returns today's date as both start and end", () => {
  const r = filterRange("today", NOW);
  expect(r.start).toBe("20260624");
  expect(r.end).toBe("20260624");
});

test("filterRange for 'weekly' returns Monday to Sunday of current week", () => {
  const r = filterRange("weekly", NOW);
  expect(r.start).toBe("20260622");
  expect(r.end).toBe("20260628");
});

test("filterRange for 'monthly' returns first to last day of current month", () => {
  const r = filterRange("monthly", NOW);
  expect(r.start).toBe("20260601");
  expect(r.end).toBe("20260630");
});

test("filterRange for 'monthly' handles February in non-leap year", () => {
  const feb = new Date(2025, 1, 15);
  const r = filterRange("monthly", feb);
  expect(r.start).toBe("20250201");
  expect(r.end).toBe("20250228");
});

test("filterRange for 'monthly' handles February in leap year", () => {
  const feb = new Date(2024, 1, 15);
  const r = filterRange("monthly", feb);
  expect(r.start).toBe("20240201");
  expect(r.end).toBe("20240229");
});

test("filterRange for 'monthly' handles December", () => {
  const dec = new Date(2026, 11, 15);
  const r = filterRange("monthly", dec);
  expect(r.start).toBe("20261201");
  expect(r.end).toBe("20261231");
});

test("eventInRange returns true for 'all' mode regardless of date", () => {
  const ev = makeEventWithDtstart("19990101");
  expect(eventInRange(ev, "all", NOW)).toBe(true);
});

test("eventInRange for 'today' matches event on today's date", () => {
  const ev = makeEventWithDtstart("20260624");
  expect(eventInRange(ev, "today", NOW)).toBe(true);
});

test("eventInRange for 'today' rejects event on different date", () => {
  const ev = makeEventWithDtstart("20260625");
  expect(eventInRange(ev, "today", NOW)).toBe(false);
});

test("eventInRange for 'today' works with timed events", () => {
  const ev = makeEventWithDtstart("20260624T113000");
  expect(eventInRange(ev, "today", NOW)).toBe(true);
});

test("eventInRange for 'today' works with UTC events", () => {
  const ev = makeEventWithDtstart("20260624T113000Z");
  expect(eventInRange(ev, "today", NOW)).toBe(true);
});

test("eventInRange for 'weekly' matches event on Monday", () => {
  const ev = makeEventWithDtstart("20260622");
  expect(eventInRange(ev, "weekly", NOW)).toBe(true);
});

test("eventInRange for 'weekly' matches event on Sunday", () => {
  const ev = makeEventWithDtstart("20260628");
  expect(eventInRange(ev, "weekly", NOW)).toBe(true);
});

test("eventInRange for 'weekly' rejects event before the week", () => {
  const ev = makeEventWithDtstart("20260621");
  expect(eventInRange(ev, "weekly", NOW)).toBe(false);
});

test("eventInRange for 'weekly' rejects event after the week", () => {
  const ev = makeEventWithDtstart("20260629");
  expect(eventInRange(ev, "weekly", NOW)).toBe(false);
});

test("eventInRange for 'monthly' matches event on first day", () => {
  const ev = makeEventWithDtstart("20260601");
  expect(eventInRange(ev, "monthly", NOW)).toBe(true);
});

test("eventInRange for 'monthly' matches event on last day", () => {
  const ev = makeEventWithDtstart("20260630");
  expect(eventInRange(ev, "monthly", NOW)).toBe(true);
});

test("eventInRange for 'monthly' rejects event in previous month", () => {
  const ev = makeEventWithDtstart("20260531");
  expect(eventInRange(ev, "monthly", NOW)).toBe(false);
});

test("eventInRange for 'monthly' rejects event in next month", () => {
  const ev = makeEventWithDtstart("20260701");
  expect(eventInRange(ev, "monthly", NOW)).toBe(false);
});

test("filterEntries returns all entries for 'all' mode", () => {
  const entries = [
    { event: makeEventWithDtstart("20200101"), filePath: "", calendarName: "" },
    { event: makeEventWithDtstart("20260624"), filePath: "", calendarName: "" },
    { event: makeEventWithDtstart("20301231"), filePath: "", calendarName: "" },
  ];
  const filtered = filterEntries(entries, "all", NOW);
  expect(filtered).toHaveLength(3);
});

test("filterEntries filters to only matching entries for 'today'", () => {
  const entries = [
    { event: makeEventWithDtstart("20260624"), filePath: "", calendarName: "A" },
    { event: makeEventWithDtstart("20260625"), filePath: "", calendarName: "B" },
    { event: makeEventWithDtstart("20260624T100000"), filePath: "", calendarName: "C" },
  ];
  const filtered = filterEntries(entries, "today", NOW);
  expect(filtered).toHaveLength(2);
  expect(filtered[0]!.calendarName).toBe("A");
  expect(filtered[1]!.calendarName).toBe("C");
});

test("filterEntries returns empty array when no events match", () => {
  const entries = [{ event: makeEventWithDtstart("20200101"), filePath: "", calendarName: "" }];
  const filtered = filterEntries(entries, "today", NOW);
  expect(filtered).toHaveLength(0);
});

test("filterEntries preserves entry properties", () => {
  const entries = [
    {
      event: makeEventWithDtstart("20260624"),
      filePath: "/path",
      calendarName: "Personal",
      extra: 42,
    },
  ];
  const filtered = filterEntries(entries, "today", NOW);
  expect(filtered[0]!.filePath).toBe("/path");
  expect(filtered[0]!.calendarName).toBe("Personal");
});

test("nextFilter cycles through all modes", () => {
  expect(nextFilter("today")).toBe("weekly");
  expect(nextFilter("weekly")).toBe("monthly");
  expect(nextFilter("monthly")).toBe("future");
  expect(nextFilter("future")).toBe("all");
  expect(nextFilter("all")).toBe("today");
});

test("filterByNumber returns correct mode for 1-5", () => {
  expect(filterByNumber(1)).toBe("today");
  expect(filterByNumber(2)).toBe("weekly");
  expect(filterByNumber(3)).toBe("monthly");
  expect(filterByNumber(4)).toBe("future");
  expect(filterByNumber(5)).toBe("all");
});

test("filterByNumber returns null for invalid numbers", () => {
  expect(filterByNumber(0)).toBeNull();
  expect(filterByNumber(6)).toBeNull();
  expect(filterByNumber(-1)).toBeNull();
});

test("weekly filter handles week spanning across month boundary", () => {
  const aug1 = new Date(2026, 7, 1);
  const r = filterRange("weekly", aug1);
  expect(r.start).toBe("20260727");
  expect(r.end).toBe("20260802");
});

test("weekly filter handles week spanning across year boundary", () => {
  const jan1 = new Date(2026, 0, 1);
  const r = filterRange("weekly", jan1);
  expect(r.start).toBe("20251229");
  expect(r.end).toBe("20260104");
});

test("eventInRange handles event with no DTSTART", () => {
  const ev: CalendarEvent = { lines: [{ name: "UID", params: "", value: "x" }], alarms: [] };
  expect(eventInRange(ev, "today", NOW)).toBe(false);
  expect(eventInRange(ev, "all", NOW)).toBe(true);
});

test("FilterMode type is usable", () => {
  const m: FilterMode = "today";
  expect(FILTER_LABELS[m]).toBe("Today");
});

test("future filter includes events today", () => {
  const ev = makeEventWithDtstart("20260624");
  expect(eventInRange(ev, "future", NOW)).toBe(true);
});

test("future filter includes events after today", () => {
  const ev = makeEventWithDtstart("20260625");
  expect(eventInRange(ev, "future", NOW)).toBe(true);
});

test("future filter excludes past non-recurring events", () => {
  const ev = makeEventWithDtstart("20260623");
  expect(eventInRange(ev, "future", NOW)).toBe(false);
});

test("future filter includes past recurring events without UNTIL", () => {
  const ev = makeRecurringEvent("20200101", "FREQ=YEARLY");
  expect(eventInRange(ev, "future", NOW)).toBe(true);
});

test("future filter includes past recurring events with future UNTIL", () => {
  const ev = makeRecurringEvent("20200101", "FREQ=YEARLY;UNTIL=20271231");
  expect(eventInRange(ev, "future", NOW)).toBe(true);
});

test("future filter excludes past recurring events with past UNTIL", () => {
  const ev = makeRecurringEvent("20200101", "FREQ=YEARLY;UNTIL=20251231");
  expect(eventInRange(ev, "future", NOW)).toBe(false);
});

test("future filter excludes past recurring events with UNTIL ending today", () => {
  const ev = makeRecurringEvent("20200101", "FREQ=DAILY;UNTIL=20260623");
  expect(eventInRange(ev, "future", NOW)).toBe(false);
});

test("future filter includes recurring event with UNTIL today", () => {
  const ev = makeRecurringEvent("20200101", "FREQ=DAILY;UNTIL=20260624");
  expect(eventInRange(ev, "future", NOW)).toBe(true);
});

test("future filter works with timed events", () => {
  const ev = makeEventWithDtstart("20260624T113000");
  expect(eventInRange(ev, "future", NOW)).toBe(true);
});

test("future filter works with UTC events", () => {
  const ev = makeEventWithDtstart("20260625T113000Z");
  expect(eventInRange(ev, "future", NOW)).toBe(true);
});

test("filterEntries for 'future' keeps future and recurring, drops past non-recurring", () => {
  const entries = [
    { event: makeEventWithDtstart("20200101"), filePath: "", calendarName: "Past" },
    {
      event: makeRecurringEvent("20200101", "FREQ=YEARLY"),
      filePath: "",
      calendarName: "Recurring",
    },
    { event: makeEventWithDtstart("20260624"), filePath: "", calendarName: "Today" },
    { event: makeEventWithDtstart("20260701"), filePath: "", calendarName: "Future" },
  ];
  const filtered = filterEntries(entries, "future", NOW);
  expect(filtered).toHaveLength(3);
  expect(filtered.map((e) => e.calendarName)).toEqual(["Recurring", "Today", "Future"]);
});
