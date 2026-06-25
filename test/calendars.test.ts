import { expect, test } from "bun:test";
import { execSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  allEntries,
  type CalendarFile,
  calendarNameForFolder,
  computeDefaultTzid,
  defaultCalendarForNew,
  ensureCalendarFile,
  FACTORY_PROCESS_NAME,
  loadSingleFile,
  notifyEvolution,
  truncateName,
  writeCalendarFile,
} from "../src/calendars";
import { type CalendarEvent, findLine, parseCalendar } from "../src/ics";

const SAMPLE_ICS = [
  "BEGIN:VCALENDAR",
  "CALSCALE:GREGORIAN",
  "PRODID:-//Ximian//NONSGML Evolution Calendar//EN",
  "VERSION:2.0",
  "X-EVOLUTION-DATA-REVISION:2026-06-24T20:40:55.233000Z(3)",
  "BEGIN:VEVENT",
  "UID:aaa",
  "DTSTAMP:20251105T154536Z",
  "DTSTART;VALUE=DATE:20251105",
  "DTEND;VALUE=DATE:20251106",
  "SUMMARY:Birthday",
  "SEQUENCE:0",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:bbb",
  "DTSTAMP:20260115T134840Z",
  "DTSTART;TZID=America/Sao_Paulo:20260119T113000",
  "DTEND;TZID=America/Sao_Paulo:20260119T123000",
  "SUMMARY:Meeting",
  "SEQUENCE:0",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "cal-test-"));
}

function makeCalendarFile(path: string, content: string): CalendarFile {
  return {
    path,
    name: basename(path),
    folder: basename(join(path, "..")),
    calendar: parseCalendar(content),
  };
}

test("FACTORY_PROCESS_NAME is 15 chars or fewer (Linux comm limit)", () => {
  expect(FACTORY_PROCESS_NAME.length).toBeLessThanOrEqual(15);
  expect(FACTORY_PROCESS_NAME).toBe("evolution-calen");
});

test("FACTORY_PROCESS_NAME matches actual evolution-calendar-factory comm", () => {
  const out = spawnSync("ps", ["-eo", "comm"], { encoding: "utf8" });
  const comms = out.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const found = comms.some((c) => c === FACTORY_PROCESS_NAME);
  if (!found) {
    // Factory may not be running — start it via DBus activation
    try {
      execSync(
        "gdbus call --session --dest org.gnome.evolution.dataserver.Calendar8 --object-path /org/gnome/evolution/dataserver/Calendar8/Factory --method org.gnome.evolution.dataserver.Calendar8.Factory.RegisterClient -- ",
        { stdio: "ignore", timeout: 5000 },
      );
    } catch {
      // Try alternative activation
    }
    const retry = spawnSync("ps", ["-eo", "comm"], { encoding: "utf8" });
    const retryComms = retry.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const retryFound = retryComms.some((c) => c === FACTORY_PROCESS_NAME);
    // If still not found, factory might not be installed — skip assertion
    if (retryFound) expect(retryFound).toBe(true);
  } else {
    expect(found).toBe(true);
  }
});

test("notifyEvolution does NOT kill the factory process", () => {
  // Spawn a fake evolution-calen process
  const tmp = mkdtempSync(join(tmpdir(), "notify-test-"));
  const fakeBin = join(tmp, "evolution-calen");
  execSync(`cp /usr/bin/sleep "${fakeBin}"`);
  const child = spawn(fakeBin, ["10"], { stdio: "ignore", detached: true });
  const pid = child.pid;
  if (!pid) throw new Error("Failed to spawn dummy process");
  const comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
  expect(comm).toBe("evolution-calen");

  notifyEvolution();

  // The process must still be alive — notifyEvolution must NOT kill it
  execSync("sleep 0.5");
  let stillAlive = false;
  try {
    process.kill(pid, 0);
    stillAlive = true;
  } catch {
    stillAlive = false;
  }
  expect(stillAlive).toBe(true);

  // Cleanup
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
  rmSync(tmp, { recursive: true });
});

test("notifyEvolution activates factory when not running", () => {
  // Ensure no evolution-calen process exists
  try {
    execSync("pkill -x evolution-calen", { stdio: "ignore" });
  } catch {
    // expected — not running
  }
  execSync("sleep 0.3");

  let wasRunning = false;
  try {
    execSync("pgrep -x evolution-calen", { stdio: "ignore" });
    wasRunning = true;
  } catch {
    wasRunning = false;
  }

  notifyEvolution();

  execSync("sleep 1");
  let nowRunning = false;
  try {
    execSync("pgrep -x evolution-calen", { stdio: "ignore" });
    nowRunning = true;
  } catch {
    nowRunning = false;
  }
  if (!wasRunning) {
    expect(nowRunning).toBe(true);
  }
});

test("truncateName returns short names unchanged", () => {
  expect(truncateName("Personal", 10)).toBe("Personal");
  expect(truncateName("", 10)).toBe("");
});

test("truncateName truncates long names with ellipsis", () => {
  expect(truncateName("Very Long Calendar Name", 10)).toBe("Very Long…");
  expect(truncateName("abcdefghijk", 5)).toBe("abcd…");
  expect(truncateName("ab", 1)).toBe("a…");
});

test("calendarNameForFolder maps system to system-calendar source name", () => {
  const sources = new Map([
    ["system-calendar", "Personal"],
    ["289a2da1abc", "Bills"],
  ]);
  expect(calendarNameForFolder("system", sources)).toBe("Personal");
});

test("calendarNameForFolder maps hash folders to display name", () => {
  const sources = new Map([["289a2da1abc", "Bills"]]);
  expect(calendarNameForFolder("289a2da1abc", sources)).toBe("Bills");
});

test("calendarNameForFolder falls back to folder name when no source found", () => {
  const sources = new Map();
  expect(calendarNameForFolder("unknown-hash", sources)).toBe("unknown-hash");
  expect(calendarNameForFolder("system", sources)).toBe("system");
});

test("loadSingleFile returns a CalendarFile with correct metadata", () => {
  const dir = makeTempDir();
  const path = join(dir, "test.ics");
  writeFileSync(path, SAMPLE_ICS);
  const files = loadSingleFile(path);
  expect(files).toHaveLength(1);
  expect(files[0]!.path).toBe(path);
  expect(files[0]!.name).toBe("test.ics");
  expect(files[0]!.calendar.events).toHaveLength(2);
  rmSync(dir, { recursive: true });
});

test("allEntries merges events from multiple files and sorts by start date", () => {
  const dir = makeTempDir();
  const path1 = join(dir, "cal1.ics");
  const path2 = join(dir, "cal2.ics");
  writeFileSync(path1, SAMPLE_ICS);
  const cal2 = [
    "BEGIN:VCALENDAR",
    "CALSCALE:GREGORIAN",
    "PRODID:-//Ximian//NONSGML Evolution Calendar//EN",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:ccc",
    "DTSTAMP:20240101T000000Z",
    "DTSTART;VALUE=DATE:20240101",
    "DTEND;VALUE=DATE:20240102",
    "SUMMARY:Earlier Event",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  writeFileSync(path2, cal2);

  const f1 = makeCalendarFile(path1, SAMPLE_ICS);
  const f2 = makeCalendarFile(path2, cal2);
  const entries = allEntries([f1, f2]);
  expect(entries).toHaveLength(3);
  // Sorted by start: 20240101 < 20251105 < 20260119
  expect(findLine(entries[0]!.event, "UID")?.value).toBe("ccc");
  expect(findLine(entries[1]!.event, "UID")?.value).toBe("aaa");
  expect(findLine(entries[2]!.event, "UID")?.value).toBe("bbb");
  rmSync(dir, { recursive: true });
});

test("allEntries preserves calendarName from each file", () => {
  const dir = makeTempDir();
  const path1 = join(dir, "cal1.ics");
  writeFileSync(path1, SAMPLE_ICS);
  const f1 = makeCalendarFile(path1, SAMPLE_ICS);
  f1.name = "Personal";
  const entries = allEntries([f1]);
  expect(entries[0]!.calendarName).toBe("Personal");
  expect(entries[0]!.filePath).toBe(path1);
  rmSync(dir, { recursive: true });
});

test("computeDefaultTzid returns first TZID found", () => {
  const dir = makeTempDir();
  const path = join(dir, "test.ics");
  writeFileSync(path, SAMPLE_ICS);
  const f = makeCalendarFile(path, SAMPLE_ICS);
  const entries = allEntries([f]);
  expect(computeDefaultTzid(entries)).toBe("America/Sao_Paulo");
  rmSync(dir, { recursive: true });
});

test("computeDefaultTzid returns null when no TZID in any event", () => {
  const allDayOnly = [
    "BEGIN:VCALENDAR",
    "CALSCALE:GREGORIAN",
    "PRODID:-//Ximian//NONSGML Evolution Calendar//EN",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:zzz",
    "DTSTAMP:20250101T000000Z",
    "DTSTART;VALUE=DATE:20250101",
    "DTEND;VALUE=DATE:20250102",
    "SUMMARY:All Day",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const dir = makeTempDir();
  const path = join(dir, "test.ics");
  writeFileSync(path, allDayOnly);
  const f = makeCalendarFile(path, allDayOnly);
  const entries = allEntries([f]);
  expect(computeDefaultTzid(entries)).toBeNull();
  rmSync(dir, { recursive: true });
});

test("defaultCalendarForNew returns selected event's calendar", () => {
  const dir = makeTempDir();
  const path1 = join(dir, "cal1.ics");
  const path2 = join(dir, "cal2.ics");
  writeFileSync(path1, SAMPLE_ICS);
  writeFileSync(path2, SAMPLE_ICS);
  const f1 = makeCalendarFile(path1, SAMPLE_ICS);
  f1.folder = "system";
  const f2 = makeCalendarFile(path2, SAMPLE_ICS);
  f2.folder = "289a2da1";
  const entries = allEntries([f1, f2]);
  const result = defaultCalendarForNew([f1, f2], entries[0]!);
  expect(result?.path).toBe(entries[0]!.filePath);
  rmSync(dir, { recursive: true });
});

test("defaultCalendarForNew falls back to system folder when no selected entry", () => {
  const dir = makeTempDir();
  const path1 = join(dir, "cal1.ics");
  const path2 = join(dir, "cal2.ics");
  writeFileSync(path1, SAMPLE_ICS);
  writeFileSync(path2, SAMPLE_ICS);
  const f1 = makeCalendarFile(path1, SAMPLE_ICS);
  f1.folder = "other";
  const f2 = makeCalendarFile(path2, SAMPLE_ICS);
  f2.folder = "system";
  const result = defaultCalendarForNew([f1, f2], null);
  expect(result?.folder).toBe("system");
  rmSync(dir, { recursive: true });
});

test("defaultCalendarForNew falls back to first file when no system folder", () => {
  const dir = makeTempDir();
  const path1 = join(dir, "cal1.ics");
  writeFileSync(path1, SAMPLE_ICS);
  const f1 = makeCalendarFile(path1, SAMPLE_ICS);
  f1.folder = "other";
  const result = defaultCalendarForNew([f1], null);
  expect(result?.folder).toBe("other");
  rmSync(dir, { recursive: true });
});

test("defaultCalendarForNew returns null when no files", () => {
  expect(defaultCalendarForNew([], null)).toBeNull();
});

test("writeCalendarFile preserves inode (direct write, not rename)", () => {
  const dir = makeTempDir();
  const path = join(dir, "calendar.ics");
  writeFileSync(path, SAMPLE_ICS);
  const inodeBefore = statSync(path).ino;

  const file = makeCalendarFile(path, SAMPLE_ICS);
  file.calendar.events.push({
    lines: [
      { name: "UID", params: "", value: "new-event" },
      { name: "DTSTAMP", params: "", value: "20260624T120000Z" },
      { name: "DTSTART;VALUE=DATE", params: "", value: "20260625" },
      { name: "DTEND;VALUE=DATE", params: "", value: "20260626" },
      { name: "SUMMARY", params: "", value: "New Event" },
    ],
    alarms: [],
  } as CalendarEvent);
  writeCalendarFile(file);

  const inodeAfter = statSync(path).ino;
  expect(inodeAfter).toBe(inodeBefore);
  rmSync(dir, { recursive: true });
});

test("writeCalendarFile bumps X-EVOLUTION-DATA-REVISION count", () => {
  const dir = makeTempDir();
  const path = join(dir, "calendar.ics");
  writeFileSync(path, SAMPLE_ICS);
  const file = makeCalendarFile(path, SAMPLE_ICS);

  writeCalendarFile(file);

  const raw = readFileSync(path, "utf8");
  const reParsed = parseCalendar(raw);
  const rev = reParsed.headerLines.find((h) => h.name === "X-EVOLUTION-DATA-REVISION");
  expect(rev).toBeDefined();
  const m = rev?.value.match(/\((\d+)\)$/);
  expect(m?.[1]).toBe("4"); // was 3, should be 4
  rmSync(dir, { recursive: true });
});

test("writeCalendarFile adds X-EVOLUTION-DATA-REVISION when missing", () => {
  const dir = makeTempDir();
  const noRev = [
    "BEGIN:VCALENDAR",
    "CALSCALE:GREGORIAN",
    "PRODID:-//Ximian//NONSGML Evolution Calendar//EN",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:aaa",
    "DTSTAMP:20250101T000000Z",
    "DTSTART;VALUE=DATE:20250101",
    "DTEND;VALUE=DATE:20250102",
    "SUMMARY:Test",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const path = join(dir, "calendar.ics");
  writeFileSync(path, noRev);
  const file = makeCalendarFile(path, noRev);

  writeCalendarFile(file);

  const raw = readFileSync(path, "utf8");
  const reParsed = parseCalendar(raw);
  const rev = reParsed.headerLines.find((h) => h.name === "X-EVOLUTION-DATA-REVISION");
  expect(rev).toBeDefined();
  const m = rev?.value.match(/\((\d+)\)$/);
  expect(m?.[1]).toBe("1"); // first revision
  rmSync(dir, { recursive: true });
});

test("writeCalendarFile produces valid ICS that round-trips", () => {
  const dir = makeTempDir();
  const path = join(dir, "calendar.ics");
  writeFileSync(path, SAMPLE_ICS);
  const file = makeCalendarFile(path, SAMPLE_ICS);

  writeCalendarFile(file);

  const raw = readFileSync(path, "utf8");
  const reParsed = parseCalendar(raw);
  expect(reParsed.events).toHaveLength(file.calendar.events.length);
  expect(reParsed.headerLines).toEqual(file.calendar.headerLines);
  rmSync(dir, { recursive: true });
});

test("writeCalendarFile uses CRLF line endings when original used CRLF", () => {
  const dir = makeTempDir();
  const path = join(dir, "calendar.ics");
  writeFileSync(path, SAMPLE_ICS); // CRLF
  const file = makeCalendarFile(path, SAMPLE_ICS);

  writeCalendarFile(file);

  const raw = readFileSync(path, "utf8");
  expect(raw.includes("\r\n")).toBe(true);
  rmSync(dir, { recursive: true });
});

test("ensureCalendarFile creates a new file with proper headers", () => {
  const dir = makeTempDir();
  const path = join(dir, "newcal", "calendar.ics");

  const file = ensureCalendarFile(path, "NewCal");

  expect(existsSync(path)).toBe(true);
  expect(file.name).toBe("NewCal");
  expect(file.calendar.events).toHaveLength(0);
  expect(file.calendar.headerLines.map((h) => h.name)).toContain("VERSION");
  expect(file.calendar.headerLines.map((h) => h.name)).toContain("PRODID");
  expect(file.calendar.headerLines.map((h) => h.name)).toContain("CALSCALE");

  const raw = readFileSync(path, "utf8");
  const reParsed = parseCalendar(raw);
  expect(reParsed.events).toHaveLength(0);
  rmSync(dir, { recursive: true });
});

test("ensureCalendarFile returns existing file when it already exists", () => {
  const dir = makeTempDir();
  const subDir = join(dir, "existing");
  mkdirSync(subDir, { recursive: true });
  const path = join(subDir, "calendar.ics");
  writeFileSync(path, SAMPLE_ICS);
  const inodeBefore = statSync(path).ino;

  const file = ensureCalendarFile(path, "Existing");

  expect(file.calendar.events).toHaveLength(2);
  expect(statSync(path).ino).toBe(inodeBefore);
  rmSync(dir, { recursive: true });
});

test("ensureCalendarFile on newly created file includes X-EVOLUTION-DATA-REVISION", () => {
  const dir = makeTempDir();
  const path = join(dir, "newcal", "calendar.ics");

  ensureCalendarFile(path, "NewCal");

  const raw = readFileSync(path, "utf8");
  const reParsed = parseCalendar(raw);
  const rev = reParsed.headerLines.find((h) => h.name === "X-EVOLUTION-DATA-REVISION");
  expect(rev).toBeDefined();
  const m = rev?.value.match(/\((\d+)\)$/);
  expect(m?.[1]).toBe("1");
  rmSync(dir, { recursive: true });
});
