import {
  BoxRenderable,
  bg,
  bold,
  type CliRenderer,
  createCliRenderer,
  fg,
  InputRenderable,
  type KeyEvent,
  TextRenderable,
  t,
  underline,
} from "@opentui/core";
import {
  allEntries,
  type CalendarFile,
  computeDefaultTzid,
  DEFAULT_CAL_DIR,
  defaultCalendarForNew,
  type EventEntry,
  loadSingleFile,
  notifyEvolution,
  scanCalendarDir,
  truncateName,
  writeCalendarFile,
} from "./src/calendars";
import {
  applyEdit,
  createEvent,
  eventDateStr,
  eventTimeStr,
  eventToForm,
  type FormData,
  findLine,
  getRRuleFreq,
  getSummary,
  getTzid,
} from "./src/ics";

const BG = "#0d1117";
const TEXT = "#c9d1d9";
const DIM = "#6e7681";
const ACCENT = "#58a6ff";
const SEL_BG = "#2f81f7";
const SEL_FG = "#ffffff";
const BORDER = "#30363d";
const ERROR = "#f85149";
const OK = "#3fb950";
const CAL_COL = 10;

type Mode = "normal" | "edit" | "confirm" | "help";

let renderer: CliRenderer;
let baseDir: string;
let singleFile: string | null = null;
let files: CalendarFile[] = [];
let entries: EventEntry[] = [];
let defaultTzid: string | null = null;
let selected = 0;
let topIndex = 0;
let mode: Mode = "normal";
let statusMsg = "";
let statusIsError = false;
let statusTimer: ReturnType<typeof setTimeout> | null = null;
let pendingG = false;
let pendingGTimer: ReturnType<typeof setTimeout> | null = null;

let editIsNew = false;
let editEntry: EventEntry | null = null;
let editTargetFile: CalendarFile | null = null;
let currentTzid: string | null = null;
let focusIndex = 0;
let form: {
  box: BoxRenderable;
  summary: InputRenderable;
  allDay: InputRenderable;
  start: InputRenderable;
  end: InputRenderable;
} | null = null;
let confirmBox: BoxRenderable | null = null;
let helpBox: BoxRenderable | null = null;

let appBox: BoxRenderable;
let titleText: TextRenderable;
let colHeaderText: TextRenderable;
let listBox: BoxRenderable;
let statusText: TextRenderable;
let overlayBox: BoxRenderable;

interface Args {
  dir: string | null;
  file: string | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = { dir: null, file: null };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--dir" && argv[i + 1]) {
      out.dir = argv[i + 1]!;
      i += 2;
      continue;
    }
    if (a?.startsWith("--dir=")) {
      out.dir = a.slice(6);
      i++;
      continue;
    }
    if (a === "--file" && argv[i + 1]) {
      out.file = argv[i + 1]!;
      i += 2;
      continue;
    }
    if (a?.startsWith("--file=")) {
      out.file = a.slice(7);
      i++;
      continue;
    }
    i++;
  }
  if (!out.dir && !out.file) out.dir = process.env.CAL_DIR ?? DEFAULT_CAL_DIR;
  return out;
}

function setStatus(msg: string, isError = false): void {
  statusMsg = msg;
  statusIsError = isError;
  if (statusTimer) clearTimeout(statusTimer);
  if (msg) {
    statusTimer = setTimeout(() => {
      statusMsg = "";
      renderStatus();
    }, 2800);
  }
  renderStatus();
}

function visibleRows(): number {
  return Math.max(1, renderer.height - 3);
}

function adjustViewport(): void {
  const vr = visibleRows();
  if (selected < topIndex) topIndex = selected;
  if (selected >= topIndex + vr) topIndex = selected - vr + 1;
  if (topIndex < 0) topIndex = 0;
}

function pageForward(): void {
  const vr = visibleRows();
  const maxSel = entries.length - 1;
  if (selected >= maxSel && topIndex >= maxSel - vr + 1) return;
  selected = Math.min(selected + vr, maxSel);
  topIndex = Math.min(topIndex + vr, Math.max(0, maxSel - vr + 1));
  renderList();
}

function pageBackward(): void {
  const vr = visibleRows();
  if (selected <= 0 && topIndex <= 0) return;
  selected = Math.max(selected - vr, 0);
  topIndex = Math.max(topIndex - vr, 0);
  renderList();
}

function halfPageDown(): void {
  const vr = visibleRows();
  const delta = Math.max(1, Math.floor(vr / 2));
  const maxSel = entries.length - 1;
  selected = Math.min(selected + delta, maxSel);
  topIndex = Math.min(topIndex + delta, Math.max(0, maxSel - vr + 1));
  renderList();
}

function halfPageUp(): void {
  const vr = visibleRows();
  const delta = Math.max(1, Math.floor(vr / 2));
  selected = Math.max(selected - delta, 0);
  topIndex = Math.max(topIndex - delta, 0);
  renderList();
}

function multiCalendar(): boolean {
  return files.length > 1;
}

function renderHeader(): void {
  const count = entries.length;
  const recurring = entries.filter((e) => getRRuleFreq(e.event) !== null).length;
  const countLabel = `${count} event${count === 1 ? "" : "s"}`;
  const recLabel = recurring ? `  (${recurring} recurring)` : "";
  const calLabel = `${files.length} calendar${files.length === 1 ? "" : "s"}`;
  const source = singleFile ?? baseDir;
  titleText.content = t` ${bold(fg(ACCENT)("Fedora Calendar"))}  ${bold(fg(ACCENT)(countLabel))}${fg(DIM)(recLabel)}  ${fg(DIM)(calLabel)}  ${fg(DIM)(source)}`;
  const calHead = multiCalendar() ? "Calendar".padEnd(CAL_COL) : "";
  colHeaderText.content = t`${fg(DIM)(underline(` ${"Date".padEnd(12)}${"Time".padEnd(9)}${calHead}Summary`))}`;
}

function renderStatus(): void {
  const color = statusIsError ? ERROR : statusMsg ? OK : DIM;
  let left: ReturnType<typeof t>;
  if (statusMsg) {
    left = t` ${fg(color)(statusMsg)}`;
  } else if (mode === "normal") {
    left = t` ${fg(ACCENT)("NORMAL")}  ${fg(DIM)("j/k move · C-f/C-b page · C-d/C-u half · e edit · n new · d delete · ? help · q quit")}`;
  } else if (mode === "edit") {
    left = t` ${fg(ACCENT)("EDIT")}  ${fg(DIM)("[Enter]/[C-s] save · [Tab]/[S-Tab] next/prev field · [Esc] cancel")}`;
  } else if (mode === "confirm") {
    left = t` ${fg(ACCENT)("CONFIRM")}  ${fg(DIM)("[y] yes · [n/Esc] no")}`;
  } else {
    left = t` ${fg(ACCENT)("HELP")}  ${fg(DIM)("[?/Esc] close")}`;
  }
  statusText.content = left;
}

function rowContent(entry: EventEntry, idx: number, width: number) {
  const ev = entry.event;
  const date = eventDateStr(ev);
  const time = eventTimeStr(ev);
  const freq = getRRuleFreq(ev);
  const sum = getSummary(ev) || "(no summary)";
  const calName = multiCalendar() ? truncateName(entry.calendarName, CAL_COL).padEnd(CAL_COL) : "";
  const isSel = idx === selected;
  const indicator = isSel ? ">" : " ";
  const freqSuffix = freq ? ` (${freq})` : "";
  const visible = `${indicator} ${date.padEnd(12)}${time.padEnd(9)}${calName}${sum}${freqSuffix}`;
  if (isSel) {
    return t`${bg(SEL_BG)(fg(SEL_FG)(visible.padEnd(width)))}`;
  }
  return t`${" "}${fg(TEXT)(date.padEnd(12))}${fg(DIM)(time.padEnd(9))}${calName ? fg(DIM)(calName) : ""}${fg(TEXT)(sum)}${freq ? fg(DIM)(freqSuffix) : ""}`;
}

function renderList(): void {
  const kids = listBox.getChildren();
  for (const k of kids) k.destroy();
  if (entries.length === 0) {
    listBox.add(
      new TextRenderable(renderer, {
        content: " No events. Press 'n' to create one.",
        fg: DIM,
      }),
    );
    return;
  }
  const vr = visibleRows();
  const width = renderer.width;
  let i = topIndex;
  let shown = 0;
  while (i < entries.length && shown < vr) {
    const entry = entries[i]!;
    const row = new TextRenderable(renderer, {
      content: rowContent(entry, i, width),
      width: "100%",
    });
    listBox.add(row);
    i++;
    shown++;
  }
}

function render(): void {
  renderHeader();
  renderList();
  renderStatus();
}

function loadAll(): void {
  if (singleFile) {
    files = loadSingleFile(singleFile);
  } else {
    files = scanCalendarDir(baseDir);
  }
  entries = allEntries(files);
  defaultTzid = computeDefaultTzid(entries);
}

function reload(): void {
  try {
    loadAll();
    if (selected >= entries.length) selected = Math.max(0, entries.length - 1);
    adjustViewport();
    render();
    setStatus("Reloaded");
  } catch (e) {
    setStatus(`Reload failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

function findFile(path: string): CalendarFile | null {
  return files.find((f) => f.path === path) ?? null;
}

function writeFile(file: CalendarFile): boolean {
  try {
    writeCalendarFile(file);
    return true;
  } catch (e) {
    setStatus(`Write failed: ${e instanceof Error ? e.message : String(e)}`, true);
    return false;
  }
}

function selectByUid(uid: string): void {
  const idx = entries.findIndex((e) => findLine(e.event, "UID")?.value === uid);
  if (idx >= 0) {
    selected = idx;
    adjustViewport();
  }
}

function emptyForm(): FormData {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const start = `${y}-${m}-${d} 09:00`;
  const end = `${y}-${m}-${d} 10:00`;
  return { summary: "", allDay: false, start, end, tzid: defaultTzid };
}

function refmtDt(s: string, allDay: boolean): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return trimmed;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (allDay) return date;
  const time = m[4] && m[5] ? `${m[4]}:${m[5]}` : "00:00";
  return `${date} ${time}`;
}

function labeledInput(label: string, input: InputRenderable): BoxRenderable {
  const row = new BoxRenderable(renderer, {
    flexDirection: "row",
    gap: 1,
    alignItems: "center",
  });
  row.add(new TextRenderable(renderer, { content: label, fg: DIM, width: 11 }));
  row.add(input);
  return row;
}

function openEdit(isNew: boolean): void {
  if (!isNew && entries.length === 0) return;
  editIsNew = isNew;
  let data: FormData;
  if (isNew) {
    data = emptyForm();
    const selEntry = entries.length > 0 ? entries[selected]! : null;
    editTargetFile = defaultCalendarForNew(files, selEntry);
    currentTzid = defaultTzid;
  } else {
    editEntry = entries[selected]!;
    data = eventToForm(editEntry.event);
    editTargetFile = findFile(editEntry.filePath);
    currentTzid = getTzid(editEntry.event);
  }
  if (!editTargetFile) {
    setStatus("No calendar file available", true);
    return;
  }

  const summary = new InputRenderable(renderer, {
    id: "f-summary",
    value: data.summary,
    placeholder: "Event title",
    width: 40,
    backgroundColor: "#161b22",
    focusedBackgroundColor: "#1f2937",
    textColor: TEXT,
    cursorColor: ACCENT,
  });
  const allDay = new InputRenderable(renderer, {
    id: "f-allday",
    value: data.allDay ? "y" : "n",
    placeholder: "y/n",
    width: 40,
    backgroundColor: "#161b22",
    focusedBackgroundColor: "#1f2937",
    textColor: TEXT,
    cursorColor: ACCENT,
  });
  const start = new InputRenderable(renderer, {
    id: "f-start",
    value: data.start,
    placeholder: "YYYY-MM-DD HH:MM",
    width: 40,
    backgroundColor: "#161b22",
    focusedBackgroundColor: "#1f2937",
    textColor: TEXT,
    cursorColor: ACCENT,
  });
  const end = new InputRenderable(renderer, {
    id: "f-end",
    value: data.end,
    placeholder: "YYYY-MM-DD HH:MM",
    width: 40,
    backgroundColor: "#161b22",
    focusedBackgroundColor: "#1f2937",
    textColor: TEXT,
    cursorColor: ACCENT,
  });

  const title = isNew ? ` New event — ${editTargetFile.name} ` : " Edit event ";
  const box = new BoxRenderable(renderer, {
    width: 62,
    borderStyle: "rounded",
    borderColor: BORDER,
    title,
    titleColor: ACCENT,
    padding: 1,
    flexDirection: "column",
    gap: 1,
    backgroundColor: BG,
  });
  box.add(labeledInput("Summary", summary));
  box.add(labeledInput("All-day", allDay));
  box.add(labeledInput("Start", start));
  box.add(labeledInput("End", end));
  box.add(
    new TextRenderable(renderer, {
      content: " Start/End: YYYY-MM-DD  or  YYYY-MM-DD HH:MM",
      fg: DIM,
    }),
  );
  box.add(
    new TextRenderable(renderer, {
      content: " [Enter]/[C-s] save   [Tab]/[S-Tab] next/prev   [Esc] cancel",
      fg: DIM,
    }),
  );

  clearOverlayInner();
  overlayBox.add(box);
  overlayBox.visible = true;
  form = { box, summary, allDay, start, end };
  mode = "edit";
  focusIndex = 0;
  setTimeout(() => focusField(0), 0);
  renderStatus();
}

function focusField(i: number): void {
  if (!form) return;
  const inputs = [form.summary, form.allDay, form.start, form.end];
  inputs[i]?.focus();
}

function cycleField(dir: number): void {
  if (!form) return;
  const old = focusIndex;
  focusIndex = (focusIndex + dir + 4) % 4;
  if (old === 1) {
    const allDay = form.allDay.value.trim().toLowerCase().startsWith("y");
    form.start.value = refmtDt(form.start.value, allDay);
    form.end.value = refmtDt(form.end.value, allDay);
  }
  focusField(focusIndex);
}

function closeEdit(): void {
  if (form) {
    form.box.destroy();
    form = null;
  }
  editEntry = null;
  overlayBox.visible = false;
  mode = "normal";
  renderStatus();
}

function saveForm(): void {
  if (!form || !editTargetFile) return;
  const allDay = form.allDay.value.trim().toLowerCase().startsWith("y");
  const summary = form.summary.value.trim();
  const start = refmtDt(form.start.value, allDay);
  const end = refmtDt(form.end.value, allDay);
  const tzid = allDay ? null : editIsNew ? defaultTzid : currentTzid;
  if (!summary) {
    setStatus("Summary cannot be empty", true);
    return;
  }
  const formData: FormData = { summary, allDay, start, end, tzid };

  if (editIsNew) {
    const ev = createEvent(formData);
    if (!ev) {
      setStatus("Invalid dates or end not after start", true);
      return;
    }
    const uid = findLine(ev, "UID")?.value ?? "";
    editTargetFile.calendar.events.push(ev);
    if (!writeFile(editTargetFile)) return;
    notifyEvolution();
    closeEdit();
    reloadKeepSelected(uid);
    setStatus("Event created");
  } else {
    if (!editEntry) {
      setStatus("Event not found", true);
      return;
    }
    const uid = findLine(editEntry.event, "UID")?.value ?? "";
    if (!applyEdit(editEntry.event, formData)) {
      setStatus("Invalid dates or end not after start", true);
      return;
    }
    if (!writeFile(editTargetFile)) return;
    notifyEvolution();
    closeEdit();
    reloadKeepSelected(uid);
    setStatus("Event saved");
  }
}

function reloadKeepSelected(uid: string): void {
  try {
    loadAll();
    selectByUid(uid);
    render();
  } catch (e) {
    setStatus(`Reload failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

function openConfirmDelete(): void {
  if (entries.length === 0) return;
  const entry = entries[selected]!;
  const sum = getSummary(entry.event);
  clearOverlayInner();
  const box = new BoxRenderable(renderer, {
    width: 52,
    borderStyle: "rounded",
    borderColor: ERROR,
    title: " Delete event? ",
    titleColor: ERROR,
    padding: 1,
    flexDirection: "column",
    gap: 1,
    backgroundColor: BG,
  });
  box.add(
    new TextRenderable(renderer, {
      content: t` ${fg(ERROR)("Delete")} "${sum}"?`,
      fg: TEXT,
    }),
  );
  if (multiCalendar()) {
    box.add(
      new TextRenderable(renderer, {
        content: ` From: ${entry.calendarName}`,
        fg: DIM,
      }),
    );
  }
  box.add(
    new TextRenderable(renderer, {
      content: " This cannot be undone.",
      fg: DIM,
    }),
  );
  box.add(new TextRenderable(renderer, { content: " [y] yes   [n/Esc] no", fg: DIM }));
  overlayBox.add(box);
  overlayBox.visible = true;
  confirmBox = box;
  mode = "confirm";
  renderStatus();
}

function closeConfirm(): void {
  if (confirmBox) {
    confirmBox.destroy();
    confirmBox = null;
  }
  overlayBox.visible = false;
  mode = "normal";
  renderStatus();
}

function confirmDelete(): void {
  const entry = entries[selected];
  if (!entry) {
    closeConfirm();
    return;
  }
  const uid = findLine(entry.event, "UID")?.value ?? "";
  const file = findFile(entry.filePath);
  if (!file) {
    setStatus("Calendar file not found", true);
    closeConfirm();
    return;
  }
  const idx = file.calendar.events.findIndex((e) => findLine(e, "UID")?.value === uid);
  if (idx >= 0) file.calendar.events.splice(idx, 1);
  if (!writeFile(file)) return;
  notifyEvolution();
  closeConfirm();
  try {
    loadAll();
    if (selected >= entries.length) selected = Math.max(0, entries.length - 1);
    adjustViewport();
    render();
    setStatus("Event deleted");
  } catch (e) {
    setStatus(`Reload failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

function openHelp(): void {
  clearOverlayInner();
  const lines = [
    " Fedora Calendar — vim motions",
    "",
    "  j / k        move down / up",
    "  g g          go to first event",
    "  G            go to last event",
    "  C-f / C-b    page forward / backward",
    "  C-d / C-u    half-page down / up",
    "  e / Enter    edit selected event",
    "  n            new event",
    "  d            delete selected event",
    "  r            reload all calendars",
    "  ?            toggle this help",
    "  q            quit",
    "",
    "  New events are added to the calendar of the",
    "  selected event (or Personal if the list is empty).",
    "",
    "  In edit form:  [Tab]/[S-Tab] fields, [Enter]/[C-s] save, [Esc] cancel",
  ];
  const box = new BoxRenderable(renderer, {
    width: 60,
    borderStyle: "rounded",
    borderColor: BORDER,
    title: " Help ",
    titleColor: ACCENT,
    padding: 1,
    flexDirection: "column",
    gap: 0,
    backgroundColor: BG,
  });
  for (const l of lines) {
    box.add(
      new TextRenderable(renderer, {
        content: l,
        fg: l.startsWith(" ") && l.trim().length > 0 ? TEXT : DIM,
      }),
    );
  }
  overlayBox.add(box);
  overlayBox.visible = true;
  helpBox = box;
  mode = "help";
  renderStatus();
}

function closeHelp(): void {
  if (helpBox) {
    helpBox.destroy();
    helpBox = null;
  }
  overlayBox.visible = false;
  mode = "normal";
  renderStatus();
}

function clearOverlayInner(): void {
  const kids = overlayBox.getChildren();
  for (const k of kids) k.destroy();
  form = null;
  confirmBox = null;
  helpBox = null;
}

function quit(): void {
  renderer.destroy();
  process.exit(0);
}

function handleNormalKey(key: KeyEvent): void {
  const name = key.name ?? "";
  const lower = name.toLowerCase();
  const isG = name === "g" || name === "G";
  const isShiftG = isG && (key.shift || name === "G");

  if (key.ctrl) {
    if (lower === "f") {
      pageForward();
      return;
    }
    if (lower === "b") {
      pageBackward();
      return;
    }
    if (lower === "d") {
      halfPageDown();
      return;
    }
    if (lower === "u") {
      halfPageUp();
      return;
    }
  }

  if (pendingG) {
    if (pendingGTimer) clearTimeout(pendingGTimer);
    pendingG = false;
    if (isG && !isShiftG) {
      selected = 0;
      adjustViewport();
      renderList();
    }
    return;
  }

  if (isShiftG) {
    selected = Math.max(0, entries.length - 1);
    adjustViewport();
    renderList();
    return;
  }
  if (isG && !isShiftG) {
    pendingG = true;
    pendingGTimer = setTimeout(() => {
      pendingG = false;
    }, 1000);
    return;
  }

  if (lower === "j" || name === "down") {
    if (selected < entries.length - 1) {
      selected++;
      adjustViewport();
      renderList();
    }
    return;
  }
  if (lower === "k" || name === "up") {
    if (selected > 0) {
      selected--;
      adjustViewport();
      renderList();
    }
    return;
  }
  if (lower === "e" || name === "return") {
    openEdit(false);
    return;
  }
  if (lower === "n") {
    openEdit(true);
    return;
  }
  if (lower === "d") {
    openConfirmDelete();
    return;
  }
  if (lower === "r") {
    reload();
    return;
  }
  if (key.sequence === "?" || lower === "?") {
    openHelp();
    return;
  }
  if (lower === "q") {
    quit();
    return;
  }
}

function handleEditKey(key: KeyEvent): void {
  const name = key.name ?? "";
  if (name === "escape") {
    closeEdit();
    return;
  }
  if (name === "tab") {
    cycleField(key.shift ? -1 : 1);
    return;
  }
  if (name === "return" || (key.ctrl && name === "s")) {
    saveForm();
    return;
  }
}

function handleConfirmKey(key: KeyEvent): void {
  const lower = (key.name ?? "").toLowerCase();
  if (lower === "y") {
    confirmDelete();
    return;
  }
  if (lower === "n" || key.name === "escape") {
    closeConfirm();
    return;
  }
}

function handleHelpKey(key: KeyEvent): void {
  const lower = (key.name ?? "").toLowerCase();
  if (lower === "?" || key.name === "escape") {
    closeHelp();
    return;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.file) {
    singleFile = args.file;
    baseDir = args.file;
  } else {
    baseDir = args.dir ?? DEFAULT_CAL_DIR;
  }

  try {
    loadAll();
  } catch (e) {
    console.error(`Cannot load calendars: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  renderer = await createCliRenderer({
    exitOnCtrlC: false,
    backgroundColor: BG,
    useMouse: false,
  });

  appBox = new BoxRenderable(renderer, {
    id: "app",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: BG,
  });
  titleText = new TextRenderable(renderer, {
    id: "title",
    content: " Fedora Calendar",
  });
  colHeaderText = new TextRenderable(renderer, {
    id: "colhead",
    content: " Date       Time    Summary",
  });
  listBox = new BoxRenderable(renderer, {
    id: "list",
    flexGrow: 1,
    flexDirection: "column",
    backgroundColor: BG,
  });
  statusText = new TextRenderable(renderer, {
    id: "status",
    content: "",
    fg: DIM,
    width: "100%",
  });
  overlayBox = new BoxRenderable(renderer, {
    id: "overlay",
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: BG,
    visible: false,
  });

  appBox.add(titleText);
  appBox.add(colHeaderText);
  appBox.add(listBox);
  appBox.add(statusText);
  appBox.add(overlayBox);
  renderer.root.add(appBox);

  renderer.on("resize", () => {
    adjustViewport();
    render();
  });

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      quit();
      return;
    }
    if (mode === "edit") {
      handleEditKey(key);
      return;
    }
    if (mode === "confirm") {
      handleConfirmKey(key);
      return;
    }
    if (mode === "help") {
      handleHelpKey(key);
      return;
    }
    handleNormalKey(key);
  });

  render();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
