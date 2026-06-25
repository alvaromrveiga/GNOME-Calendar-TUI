import type { CalendarEvent } from "./ics";
import { findLine, isAllDay } from "./ics";

export type FilterMode = "today" | "weekly" | "monthly" | "all";

export const FILTER_MODES: FilterMode[] = ["today", "weekly", "monthly", "all"];

export const FILTER_LABELS: Record<FilterMode, string> = {
  today: "Today",
  weekly: "Weekly",
  monthly: "Monthly",
  all: "All",
};

export const DEFAULT_FILTER: FilterMode = "weekly";

function eventStartYmd(ev: CalendarEvent): string {
  const ds = findLine(ev, "DTSTART");
  if (!ds || ds.value.length < 8) return "99999999";
  return ds.value.slice(0, 8);
}

function todayYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function startOfWeekYmd(now = new Date()): string {
  const dow = now.getDay();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 1);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const day = String(monday.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function endOfWeekYmd(now = new Date()): string {
  const dow = now.getDay();
  const sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 7);
  const y = sunday.getFullYear();
  const m = String(sunday.getMonth() + 1).padStart(2, "0");
  const day = String(sunday.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function startOfMonthYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}${m}01`;
}

function endOfMonthYmd(now = new Date()): string {
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const y = last.getFullYear();
  const m = String(last.getMonth() + 1).padStart(2, "0");
  const day = String(last.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export function filterRange(mode: FilterMode, now = new Date()): { start: string; end: string } {
  if (mode === "all") return { start: "00000000", end: "99999999" };
  if (mode === "today") {
    const t = todayYmd(now);
    return { start: t, end: t };
  }
  if (mode === "weekly") {
    return { start: startOfWeekYmd(now), end: endOfWeekYmd(now) };
  }
  return { start: startOfMonthYmd(now), end: endOfMonthYmd(now) };
}

export function eventInRange(ev: CalendarEvent, mode: FilterMode, now = new Date()): boolean {
  if (mode === "all") return true;
  const { start, end } = filterRange(mode, now);
  const evStart = eventStartYmd(ev);
  return evStart >= start && evStart <= end;
}

export function filterEntries<T extends { event: CalendarEvent }>(
  entries: T[],
  mode: FilterMode,
  now = new Date(),
): T[] {
  if (mode === "all") return entries;
  return entries.filter((e) => eventInRange(e.event, mode, now));
}

export function nextFilter(mode: FilterMode): FilterMode {
  const idx = FILTER_MODES.indexOf(mode);
  return FILTER_MODES[(idx + 1) % FILTER_MODES.length]!;
}

export function filterByNumber(n: number): FilterMode | null {
  if (n < 1 || n > FILTER_MODES.length) return null;
  return FILTER_MODES[n - 1]!;
}

export function isAllDayEvent(ev: CalendarEvent): boolean {
  return isAllDay(ev);
}
