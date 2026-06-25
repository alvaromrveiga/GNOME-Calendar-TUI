import { execSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fdatasyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  type Calendar,
  type CalendarEvent,
  findLine,
  getTzid,
  parseCalendar,
  serializeCalendar,
  sortedEvents,
} from "./ics";

export const DEFAULT_CAL_DIR = join(homedir(), ".local", "share", "evolution", "calendar");
const SOURCES_DIR = join(homedir(), ".config", "evolution", "sources");

export interface CalendarFile {
  path: string;
  name: string;
  folder: string;
  calendar: Calendar;
}

export interface EventEntry {
  event: CalendarEvent;
  filePath: string;
  calendarName: string;
}

function parseDisplayName(sourcePath: string): string | null {
  let text: string;
  try {
    text = readFileSync(sourcePath, "utf8");
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("DisplayName=")) {
      return line.slice("DisplayName=".length).trim();
    }
  }
  return null;
}

export function loadSourceNames(): Map<string, string> {
  const map = new Map<string, string>();
  let entries: string[];
  try {
    entries = readdirSync(SOURCES_DIR);
  } catch {
    return map;
  }
  for (const e of entries) {
    if (!e.endsWith(".source")) continue;
    const uid = e.slice(0, -".source".length);
    const name = parseDisplayName(join(SOURCES_DIR, e));
    if (name) map.set(uid, name);
  }
  return map;
}

export function calendarNameForFolder(folder: string, sourceNames: Map<string, string>): string {
  if (folder === "system") {
    const name = sourceNames.get("system-calendar");
    if (name) return name;
  }
  const direct = sourceNames.get(folder);
  if (direct) return direct;
  return folder;
}

export function scanCalendarDir(baseDir: string): CalendarFile[] {
  const sourceNames = loadSourceNames();
  const files: CalendarFile[] = [];
  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (name === "trash") continue;
    const fullPath = join(baseDir, name);
    let isDir: boolean;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const icsPath = join(baseDir, name, "calendar.ics");
    if (!existsSync(icsPath)) continue;
    const calName = calendarNameForFolder(name, sourceNames);
    const raw = readFileSync(icsPath, "utf8");
    const calendar = parseCalendar(raw);
    files.push({ path: icsPath, name: calName, folder: name, calendar });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

export function loadSingleFile(path: string): CalendarFile[] {
  const raw = readFileSync(path, "utf8");
  const calendar = parseCalendar(raw);
  return [{ path, name: basename(path), folder: basename(path), calendar }];
}

export function allEntries(files: CalendarFile[]): EventEntry[] {
  const entries: EventEntry[] = [];
  for (const f of files) {
    for (const ev of sortedEvents(f.calendar.events)) {
      entries.push({ event: ev, filePath: f.path, calendarName: f.name });
    }
  }
  entries.sort((a, b) => sortKeyOf(a.event).localeCompare(sortKeyOf(b.event)));
  return entries;
}

function sortKeyOf(ev: CalendarEvent): string {
  const d = findLine(ev, "DTSTART");
  if (!d) return "99999999T999999";
  let v = d.value;
  if (v.endsWith("Z")) v = v.slice(0, -1);
  if (v.length === 8) v = `${v}T000000`;
  return v;
}

export function computeDefaultTzid(entries: EventEntry[]): string | null {
  for (const e of entries) {
    const tz = getTzid(e.event);
    if (tz) return tz;
  }
  return null;
}

export function defaultCalendarForNew(
  files: CalendarFile[],
  selectedEntry: EventEntry | null,
): CalendarFile | null {
  if (selectedEntry) {
    const f = files.find((x) => x.path === selectedEntry.filePath);
    if (f) return f;
  }
  const sys = files.find((f) => f.folder === "system");
  if (sys) return sys;
  return files[0] ?? null;
}

function bumpRevision(file: CalendarFile): void {
  const headers = file.calendar.headerLines;
  const idx = headers.findIndex((h) => h.name === "X-EVOLUTION-DATA-REVISION");
  let count = 0;
  if (idx >= 0) {
    const m = headers[idx]?.value.match(/\((\d+)\)$/);
    if (m) count = parseInt(m[1]!, 10);
  }
  count++;
  const iso = new Date().toISOString();
  const ts = iso.replace(/\.(\d{3})Z$/, ".$1000Z");
  const value = `${ts}(${count})`;
  if (idx >= 0) {
    headers[idx]!.value = value;
  } else {
    headers.push({ name: "X-EVOLUTION-DATA-REVISION", params: "", value });
  }
}

export function writeCalendarFile(file: CalendarFile): boolean {
  bumpRevision(file);
  const data = serializeCalendar(file.calendar);
  const fd = openSync(file.path, "w", 0o600);
  try {
    writeSync(fd, data);
    fdatasyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return true;
}

export const FACTORY_PROCESS_NAME = "evolution-calen";

function factoryRunning(): boolean {
  try {
    execSync(`pgrep -x ${FACTORY_PROCESS_NAME}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function activateFactory(): void {
  try {
    execSync(
      "busctl --user call org.gnome.evolution.dataserver.Calendar8 /org/gnome/evolution/dataserver/CalendarFactory org.gnome.evolution.dataserver.CalendarFactory OpenCalendar s system-calendar",
      { stdio: "ignore", timeout: 5000 },
    );
  } catch {
    // DBus activation happens automatically on next client access
  }
}

export function notifyEvolution(): void {
  if (!factoryRunning()) {
    activateFactory();
  }
}

export function ensureCalendarFile(path: string, name: string): CalendarFile {
  if (existsSync(path)) {
    return {
      path,
      name,
      folder: basename(join(path, "..")),
      calendar: parseCalendar(readFileSync(path, "utf8")),
    };
  }
  mkdirSync(join(path, ".."), { recursive: true });
  const cal: Calendar = {
    headerLines: [
      { name: "CALSCALE", params: "", value: "GREGORIAN" },
      {
        name: "PRODID",
        params: "",
        value: "-//Ximian//NONSGML Evolution Calendar//EN",
      },
      { name: "VERSION", params: "", value: "2.0" },
    ],
    events: [],
    lineEnding: "\r\n",
  };
  const file: CalendarFile = {
    path,
    name,
    folder: basename(join(path, "..")),
    calendar: cal,
  };
  writeCalendarFile(file);
  return file;
}

export function truncateName(name: string, max: number): string {
  if (name.length <= max) return name;
  return `${name.slice(0, Math.max(1, max - 1))}…`;
}
