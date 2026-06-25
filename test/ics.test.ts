import { expect, test } from "bun:test";
import {
  addDaysYmd,
  applyEdit,
  type Calendar,
  createEvent,
  eventDateStr,
  eventTimeStr,
  eventToForm,
  findLine,
  fmtDisplay,
  getRRuleFreq,
  getSummary,
  getTzid,
  isAllDay,
  parseCalendar,
  parseUserDt,
  serializeCalendar,
  sortedEvents,
} from "../src/ics";

const REAL_FILE = "/home/alvaro/.local/share/evolution/calendar/system/calendar.ics";

const SAMPLE = [
  "BEGIN:VCALENDAR",
  "CALSCALE:GREGORIAN",
  "PRODID:-//Ximian//NONSGML Evolution Calendar//EN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:aaa",
  "DTSTAMP:20251105T154536Z",
  "DTSTART;VALUE=DATE:20251105",
  "DTEND;VALUE=DATE:20251106",
  "SUMMARY:Níver Luan Superlógica",
  "SEQUENCE:6",
  "RRULE:FREQ=YEARLY",
  "CREATED:20251105T154607Z",
  "LAST-MODIFIED:20251105T154641Z",
  "BEGIN:VALARM",
  "X-EVOLUTION-ALARM-UID:zzz",
  "ACTION:DISPLAY",
  "DESCRIPTION:Níver Luan Superlógica",
  "TRIGGER;RELATED=START:PT0S",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:bbb",
  "DTSTAMP:20260115T134840Z",
  "DTSTART;TZID=/freeassociation.sourceforge.net/America/Sao_Paulo:",
  " 20260119T113000",
  "DTEND;TZID=/freeassociation.sourceforge.net/America/Sao_Paulo:",
  " 20260119T123000",
  "SUMMARY:Revisão carro",
  "SEQUENCE:4",
  "CREATED:20260115T134928Z",
  "LAST-MODIFIED:20260119T140000Z",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\n");

test("parse unfolds continuation lines", () => {
  const cal = parseCalendar(SAMPLE);
  expect(cal.events).toHaveLength(2);
  const ds = findLine(cal.events[1]!, "DTSTART");
  expect(ds?.value).toBe("20260119T113000");
  expect(ds?.params).toBe("TZID=/freeassociation.sourceforge.net/America/Sao_Paulo");
});

test("parse preserves alarms and unicode summary", () => {
  const cal = parseCalendar(SAMPLE);
  expect(cal.events[0]?.alarms).toHaveLength(1);
  expect(getSummary(cal.events[0]!)).toBe("Níver Luan Superlógica");
  expect(cal.events[0]?.alarms[0]?.lines.map((l) => l.name)).toContain("ACTION");
});

test("round-trip parse -> serialize -> parse is structurally identical", () => {
  const cal1 = parseCalendar(SAMPLE);
  const serialized = serializeCalendar(cal1);
  const cal2 = parseCalendar(serialized);
  expect(cal2.events).toHaveLength(cal1.events.length);
  expect(cal2.headerLines).toEqual(cal1.headerLines);
  expect(cal2.events).toEqual(cal1.events);
});

test("serialize folds long lines (<=75 bytes) and they unfold back", () => {
  const cal = parseCalendar(SAMPLE);
  const out = serializeCalendar(cal);
  const physical = out.split("\n");
  for (const l of physical) {
    if (l.length === 0) continue;
    expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
  }
  const idx = physical.findIndex((l) => l.startsWith("DTSTART;TZID="));
  expect(idx).toBeGreaterThanOrEqual(0);
  expect(physical[idx + 1]?.startsWith(" ")).toBe(true);
  const re = parseCalendar(out);
  const ds = findLine(re.events[1]!, "DTSTART");
  expect(ds?.value).toBe("20260119T113000");
});

test("fmtDisplay formats all-day and timed values", () => {
  expect(fmtDisplay("20251105", true)).toBe("2025-11-05");
  expect(fmtDisplay("20260119T113000", false)).toBe("2026-01-19 11:30");
  expect(fmtDisplay("20260119T113000", true)).toBe("2026-01-19");
});

test("eventDateStr and eventTimeStr split date and time columns", () => {
  const cal = parseCalendar(SAMPLE);
  expect(eventDateStr(cal.events[0]!)).toBe("2025-11-05");
  expect(eventTimeStr(cal.events[0]!)).toBe("all-day");
  expect(eventDateStr(cal.events[1]!)).toBe("2026-01-19");
  expect(eventTimeStr(cal.events[1]!)).toBe("11:30");
});

test("parseUserDt accepts valid and rejects invalid", () => {
  expect(parseUserDt("2026-07-03", true)).toBe("20260703");
  expect(parseUserDt("2026-07-03 10:00", false)).toBe("20260703T100000");
  expect(parseUserDt("2026-07-03 10:00:30", false)).toBe("20260703T100030");
  expect(parseUserDt("2026-13-03", true)).toBeNull();
  expect(parseUserDt("2026-07-03", false)).toBeNull();
  expect(parseUserDt("bad", true)).toBeNull();
});

test("addDaysYmd handles month boundaries", () => {
  expect(addDaysYmd("20251105", 1)).toBe("20251106");
  expect(addDaysYmd("20251130", 1)).toBe("20251201");
  expect(addDaysYmd("20260101", -1)).toBe("20251231");
  expect(addDaysYmd("20251106", -1)).toBe("20251105");
});

test("eventToForm shows inclusive end for all-day events", () => {
  const cal = parseCalendar(SAMPLE);
  const form = eventToForm(cal.events[0]!);
  expect(form.allDay).toBe(true);
  expect(form.start).toBe("2025-11-05");
  expect(form.end).toBe("2025-11-05");
  const timed = eventToForm(cal.events[1]!);
  expect(timed.allDay).toBe(false);
  expect(timed.start).toBe("2026-01-19 11:30");
  expect(timed.end).toBe("2026-01-19 12:30");
  expect(timed.tzid).toBe("/freeassociation.sourceforge.net/America/Sao_Paulo");
});

test("createEvent builds a valid event with exclusive all-day end", () => {
  const ev = createEvent({
    summary: "Test",
    allDay: true,
    start: "2026-07-03",
    end: "2026-07-03",
    tzid: null,
  });
  expect(ev).not.toBeNull();
  expect(findLine(ev!, "DTSTART")?.value).toBe("20260703");
  expect(findLine(ev!, "DTEND")?.value).toBe("20260704");
  expect(findLine(ev!, "SUMMARY")?.value).toBe("Test");
  expect(findLine(ev!, "SEQUENCE")?.value).toBe("0");
});

test("createEvent rejects end not after start", () => {
  expect(
    createEvent({
      summary: "X",
      allDay: false,
      start: "2026-07-03 10:00",
      end: "2026-07-03 09:00",
      tzid: null,
    }),
  ).toBeNull();
});

test("applyEdit updates fields and increments sequence", () => {
  const cal = parseCalendar(SAMPLE);
  const ev = cal.events[1]!;
  const before = Number(findLine(ev, "SEQUENCE")?.value);
  const ok = applyEdit(ev, {
    summary: "Revisão carro v2",
    allDay: false,
    start: "2026-01-19 11:00",
    end: "2026-01-19 12:00",
    tzid: getTzid(ev),
  });
  expect(ok).toBe(true);
  expect(getSummary(ev)).toBe("Revisão carro v2");
  expect(findLine(ev, "DTSTART")?.value).toBe("20260119T110000");
  expect(Number(findLine(ev, "SEQUENCE")?.value)).toBe(before + 1);
});

test("applyEdit can switch timed to all-day", () => {
  const cal = parseCalendar(SAMPLE);
  const ev = cal.events[1]!;
  const ok = applyEdit(ev, {
    summary: "AllDay",
    allDay: true,
    start: "2026-01-19",
    end: "2026-01-19",
    tzid: null,
  });
  expect(ok).toBe(true);
  expect(isAllDay(ev)).toBe(true);
  expect(findLine(ev, "DTSTART")?.params).toBe("VALUE=DATE");
  expect(findLine(ev, "DTSTART")?.value).toBe("20260119");
  expect(findLine(ev, "DTEND")?.value).toBe("20260120");
});

test("sortedEvents sorts by start ascending", () => {
  const cal = parseCalendar(SAMPLE);
  const sorted = sortedEvents(cal.events);
  expect(getSummary(sorted[0]!)).toBe("Níver Luan Superlógica");
  expect(getSummary(sorted[1]!)).toBe("Revisão carro");
});

test("getRRuleFreq parses FREQ", () => {
  const cal = parseCalendar(SAMPLE);
  expect(getRRuleFreq(cal.events[0]!)).toBe("YEARLY");
  expect(getRRuleFreq(cal.events[1]!)).toBeNull();
});

test("real calendar file parses to 7 events with preserved alarms (read-only)", async () => {
  const file = Bun.file(REAL_FILE);
  const raw = await file.text();
  const cal = parseCalendar(raw);
  expect(cal.events).toHaveLength(7);
  const reSerialized = serializeCalendar(cal);
  const reParsed = parseCalendar(reSerialized);
  expect(reParsed.events).toEqual(cal.events);
  expect(reParsed.headerLines).toEqual(cal.headerLines);
  const alarmCounts = cal.events.map((e) => e.alarms.length);
  expect(alarmCounts).toEqual([1, 1, 2, 2, 2, 2, 2]);
});

test("delete event reduces count and reserializes correctly", () => {
  const cal = parseCalendar(SAMPLE);
  const before = cal.events.length;
  cal.events.splice(1, 1);
  const out = serializeCalendar(cal);
  const re = parseCalendar(out);
  expect(re.events).toHaveLength(before - 1);
  expect(getSummary(re.events[0]!)).toBe("Níver Luan Superlógica");
});

test("Calendar type is exported and usable", () => {
  const cal: Calendar = parseCalendar(SAMPLE);
  expect(cal.lineEnding).toBe("\n");
});
