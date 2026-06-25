import { randomBytes } from "node:crypto";

export interface ContentLine {
  name: string;
  params: string;
  value: string;
}

export interface Alarm {
  lines: ContentLine[];
}

export interface CalendarEvent {
  lines: ContentLine[];
  alarms: Alarm[];
}

export interface Calendar {
  headerLines: ContentLine[];
  events: CalendarEvent[];
  lineEnding: string;
}

export interface FormData {
  summary: string;
  allDay: boolean;
  start: string;
  end: string;
  tzid: string | null;
}

function splitContentLine(line: string): ContentLine {
  let inQuote = false;
  let colonIdx = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ":" && !inQuote) {
      colonIdx = i;
      break;
    }
  }
  if (colonIdx === -1) return { name: line, params: "", value: "" };
  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const semi = left.indexOf(";");
  if (semi === -1) return { name: left, params: "", value };
  return { name: left.slice(0, semi), params: left.slice(semi + 1), value };
}

function unfold(raw: string): string[] {
  const rawLines = raw.split(/\r\n|\r|\n/);
  const out: string[] = [];
  for (const l of rawLines) {
    if ((l.startsWith(" ") || l.startsWith("\t")) && out.length > 0) {
      const last = out[out.length - 1];
      if (last !== undefined) out[out.length - 1] = last + l.slice(1);
    } else {
      out.push(l);
    }
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

function byteLen(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function foldLine(line: string): string[] {
  if (byteLen(line) <= 75) return [line];
  const parts: string[] = [];
  let i = 0;
  let limit = 75;
  while (i < line.length) {
    let chunk = "";
    let chunkLen = 0;
    while (i < line.length) {
      const ch = line[i] ?? "";
      const chLen = byteLen(ch);
      if (chunkLen + chLen > limit) break;
      chunk += ch;
      chunkLen += chLen;
      i++;
    }
    parts.push(chunk);
    limit = 74;
  }
  return parts.map((p, idx) => (idx === 0 ? p : ` ${p}`));
}

function serializeContentLine(cl: ContentLine): string {
  return cl.params ? `${cl.name};${cl.params}:${cl.value}` : `${cl.name}:${cl.value}`;
}

export function parseCalendar(raw: string): Calendar {
  const lineEnding = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = unfold(raw);
  const headerLines: ContentLine[] = [];
  const events: CalendarEvent[] = [];
  let i = 0;
  while (i < lines.length && lines[i] !== "BEGIN:VCALENDAR") i++;
  i++;
  while (i < lines.length && lines[i] !== "END:VCALENDAR") {
    const cur = lines[i];
    if (cur === undefined) break;
    if (cur === "BEGIN:VEVENT") {
      i++;
      const ev: CalendarEvent = { lines: [], alarms: [] };
      while (i < lines.length && lines[i] !== "END:VEVENT") {
        const c = lines[i];
        if (c === undefined) break;
        if (c === "BEGIN:VALARM") {
          i++;
          const alarm: Alarm = { lines: [] };
          while (i < lines.length && lines[i] !== "END:VALARM") {
            const ac = lines[i];
            if (ac === undefined) break;
            alarm.lines.push(splitContentLine(ac));
            i++;
          }
          i++;
          ev.alarms.push(alarm);
        } else {
          ev.lines.push(splitContentLine(c));
          i++;
        }
      }
      i++;
      events.push(ev);
    } else if (cur.startsWith("BEGIN:") || cur.startsWith("END:")) {
      i++;
    } else {
      headerLines.push(splitContentLine(cur));
      i++;
    }
  }
  return { headerLines, events, lineEnding };
}

export function serializeCalendar(cal: Calendar): string {
  const out: string[] = ["BEGIN:VCALENDAR"];
  for (const h of cal.headerLines) out.push(...foldLine(serializeContentLine(h)));
  for (const ev of cal.events) {
    out.push("BEGIN:VEVENT");
    for (const l of ev.lines) out.push(...foldLine(serializeContentLine(l)));
    for (const a of ev.alarms) {
      out.push("BEGIN:VALARM");
      for (const l of a.lines) out.push(...foldLine(serializeContentLine(l)));
      out.push("END:VALARM");
    }
    out.push("END:VEVENT");
  }
  out.push("END:VCALENDAR");
  return out.join(cal.lineEnding) + cal.lineEnding;
}

export function findLine(ev: CalendarEvent, name: string): ContentLine | undefined {
  return ev.lines.find((l) => l.name === name);
}

function setLine(ev: CalendarEvent, name: string, params: string, value: string): void {
  const idx = ev.lines.findIndex((l) => l.name === name);
  if (idx >= 0) {
    ev.lines[idx] = { name, params, value };
  } else {
    ev.lines.push({ name, params, value });
  }
}

export function getSummary(ev: CalendarEvent): string {
  return findLine(ev, "SUMMARY")?.value ?? "";
}

export function isAllDay(ev: CalendarEvent): boolean {
  return findLine(ev, "DTSTART")?.params.includes("VALUE=DATE") ?? false;
}

export function getTzid(ev: CalendarEvent): string | null {
  const d = findLine(ev, "DTSTART");
  if (!d) return null;
  const m = d.params.match(/(?:^|;)TZID=([^;]+)/);
  return m?.[1] ?? null;
}

export function getRRuleFreq(ev: CalendarEvent): string | null {
  const r = findLine(ev, "RRULE");
  if (!r) return null;
  const m = r.value.match(/FREQ=([A-Z]+)/);
  return m?.[1] ?? null;
}

export function fmtDisplay(value: string, allDay: boolean): string {
  if (value.length < 8) return value;
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (allDay) return date;
  if (value.length >= 13) return `${date} ${value.slice(9, 11)}:${value.slice(11, 13)}`;
  return date;
}

export function eventDateStr(ev: CalendarEvent): string {
  const ds = findLine(ev, "DTSTART");
  return ds && ds.value.length >= 8 ? fmtDisplay(ds.value, true) : "????-??-??";
}

export function eventTimeStr(ev: CalendarEvent): string {
  if (isAllDay(ev)) return "all-day";
  const ds = findLine(ev, "DTSTART");
  if (!ds || ds.value.length < 13) return "";
  return `${ds.value.slice(9, 11)}:${ds.value.slice(11, 13)}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const y = Number(ymd.slice(0, 4));
  const mo = Number(ymd.slice(4, 6)) - 1;
  const d = Number(ymd.slice(6, 8));
  const dt = new Date(y, mo, d + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function validRanges(y: string, mo: string, d: string, h: string, mi: string): boolean {
  const yN = Number(y),
    moN = Number(mo),
    dN = Number(d),
    hN = Number(h),
    miN = Number(mi);
  if (!(yN >= 1900 && yN <= 9999)) return false;
  if (!(moN >= 1 && moN <= 12)) return false;
  if (!(dN >= 1 && dN <= 31)) return false;
  if (!(hN >= 0 && hN <= 23)) return false;
  if (!(miN >= 0 && miN <= 59)) return false;
  return true;
}

export function parseUserDt(input: string, allDay: boolean): string | null {
  const s = input.trim();
  const dateRe = /^(\d{4})-(\d{2})-(\d{2})$/;
  const dtRe = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
  if (allDay) {
    const m = s.match(dateRe);
    if (!m) return null;
    const y = m[1] ?? "",
      mo = m[2] ?? "",
      d = m[3] ?? "";
    if (!validRanges(y, mo, d, "0", "0")) return null;
    return `${y}${mo}${d}`;
  }
  const m = s.match(dtRe);
  if (!m) return null;
  const y = m[1] ?? "",
    mo = m[2] ?? "",
    d = m[3] ?? "",
    h = m[4] ?? "",
    mi = m[5] ?? "";
  const sec = m[6] ?? "00";
  if (!validRanges(y, mo, d, h, mi)) return null;
  return `${y}${mo}${d}T${h}${mi}${sec}`;
}

export function sortKey(ev: CalendarEvent): string {
  const d = findLine(ev, "DTSTART");
  if (!d) return "99999999T999999";
  let v = d.value;
  if (isAllDay(ev)) v = `${v}T000000`;
  if (v.endsWith("Z")) v = v.slice(0, -1);
  return v;
}

export function nowUtcIcs(): string {
  return new Date()
    .toISOString()
    .replace(/-/g, "")
    .replace(/:/g, "")
    .replace(/\.\d+Z$/, "Z");
}

export function newUid(): string {
  return randomBytes(20).toString("hex");
}

export function eventToForm(ev: CalendarEvent): FormData {
  const allDay = isAllDay(ev);
  const ds = findLine(ev, "DTSTART");
  const de = findLine(ev, "DTEND");
  const start = ds ? fmtDisplay(ds.value, allDay) : "";
  let end = de ? fmtDisplay(de.value, allDay) : "";
  if (allDay && de) end = fmtDisplay(addDaysYmd(de.value, -1), true);
  return { summary: getSummary(ev), allDay, start, end, tzid: getTzid(ev) };
}

function paramsFor(allDay: boolean, tzid: string | null): string {
  if (allDay) return "VALUE=DATE";
  return tzid ? `TZID=${tzid}` : "";
}

export function createEvent(form: FormData): CalendarEvent | null {
  const startIcs = parseUserDt(form.start, form.allDay);
  let endIcs = parseUserDt(form.end, form.allDay);
  if (!startIcs || !endIcs) return null;
  if (form.allDay) endIcs = addDaysYmd(endIcs, 1);
  if (endIcs <= startIcs) return null;
  const now = nowUtcIcs();
  const params = paramsFor(form.allDay, form.tzid);
  const ev: CalendarEvent = { lines: [], alarms: [] };
  ev.lines.push({ name: "UID", params: "", value: newUid() });
  ev.lines.push({ name: "DTSTAMP", params: "", value: now });
  ev.lines.push({ name: "DTSTART", params, value: startIcs });
  ev.lines.push({ name: "DTEND", params, value: endIcs });
  ev.lines.push({ name: "SUMMARY", params: "", value: form.summary });
  ev.lines.push({ name: "SEQUENCE", params: "", value: "0" });
  ev.lines.push({ name: "CREATED", params: "", value: now });
  ev.lines.push({ name: "LAST-MODIFIED", params: "", value: now });
  return ev;
}

export function applyEdit(ev: CalendarEvent, form: FormData): boolean {
  const startIcs = parseUserDt(form.start, form.allDay);
  let endIcs = parseUserDt(form.end, form.allDay);
  if (!startIcs || !endIcs) return false;
  if (form.allDay) endIcs = addDaysYmd(endIcs, 1);
  if (endIcs <= startIcs) return false;
  const params = paramsFor(form.allDay, form.tzid);
  setLine(ev, "DTSTART", params, startIcs);
  setLine(ev, "DTEND", params, endIcs);
  setLine(ev, "SUMMARY", "", form.summary);
  const seq = findLine(ev, "SEQUENCE");
  const nextSeq = String((seq ? parseInt(seq.value, 10) : 0) + 1);
  setLine(ev, "SEQUENCE", "", nextSeq);
  const now = nowUtcIcs();
  setLine(ev, "LAST-MODIFIED", "", now);
  setLine(ev, "DTSTAMP", "", now);
  return true;
}

export function sortedEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}
