# GNOME Calendar TUI

A terminal user interface for viewing and managing [GNOME Calendar](https://apps.gnome.org/Calendar/) events, powered by [Bun](https://bun.com) and [OpenTUI](https://github.com/opentui/core). Uses vim-style motions for all navigation and editing. Reads and writes the same iCalendar (`.ics`) files that Evolution Data Server uses as its local backend, so changes appear in GNOME Calendar automatically.

Made with GLM 5.2.

## Features

- **Multi-calendar support** — auto-discovers every calendar under `~/.local/share/evolution/calendar/`, resolves friendly names from `~/.config/evolution/sources/*.source`, and merges all events into one sorted list.
- **Vim motions** — `j`/`k`, `gg`/`G`, `C-f`/`C-b`, `C-d`/`C-u` for fast navigation. No mouse required.
- **Create / edit / delete** events with a tabbed form (summary, all-day, start, end). Recurring events (`RRULE`), alarms (`VALARM`), and time zones (`TZID`) are preserved on edit.
- **Date filters** — `f` opens a filter overlay with five modes:
  1. Today
  2. Weekly (default, Monday–Sunday)
  3. Monthly
  4. All future (includes past recurring events without a past `UNTIL`)
  5. All
- **Live sync with GNOME Calendar** — writes are done in-place (preserving the file's inode) and bump `X-EVOLUTION-DATA-REVISION`, so `evolution-calendar-factory`'s inotify watches pick up changes and reload automatically. No restart required.
- **Single-file mode** — point at any `.ics` file with `--file` for ad-hoc editing.

## Requirements

- Linux with GNOME Calendar / Evolution Data Server installed
- [Bun](https://bun.com) 1.2+ (`curl -fsSL https://bun.sh/install | bash`)

## Install

```bash
bun install
```

## Run

```bash
bun start
```

By default the app scans `~/.local/share/evolution/calendar/`. Override the calendar directory or point at a single file:

```bash
bun run index.ts --dir /path/to/calendar
bun run index.ts --file /path/to/single.ics
```

The `CAL_DIR` environment variable is also honored when no `--dir`/`--file` flag is passed.

## Key bindings

### Normal mode

| Key           | Action                  |
| ------------- | ----------------------- |
| `j` / `k`     | Move down / up          |
| `gg`          | Go to first event       |
| `G`           | Go to last event        |
| `C-f` / `C-b` | Page forward / backward |
| `C-d` / `C-u` | Half-page down / up     |
| `e` / `Enter` | Edit selected event     |
| `n`           | New event               |
| `d`           | Delete selected event   |
| `f`           | Open filter overlay     |
| `r`           | Reload all calendars    |
| `?`           | Toggle help             |
| `q`           | Quit                    |

### Edit form

| Key            | Action              |
| -------------- | ------------------- |
| `Tab` / `S-Tab`| Next / prev field   |
| `Enter` / `C-s`| Save                |
| `Esc`          | Cancel              |

### Filter overlay

| Key     | Action                       |
| ------- | ---------------------------- |
| `j`/`k` | Move cursor                  |
| `Enter` | Select highlighted filter    |
| `1`–`5` | Jump-select a filter by number |
| `f`/`Esc`| Close                      |

New events are added to the calendar of the currently selected event, or to the Personal (`system`) calendar if the list is empty.

## Development

```bash
bun run typecheck   # tsc --noEmit
bun test            # run the test suite
bun run lint        # biome lint
bun run format      # biome format --write
bun run check       # biome check (lint + format)
```

Tests use synthetic ICS fixtures and never touch your real calendar files.

## How it syncs with GNOME Calendar

GNOME Calendar uses `evolution-data-server` as its backend, which stores local calendars as `.ics` files under `~/.local/share/evolution/calendar/<hash>/calendar.ics`. The factory process watches these files with inotify. The TUI writes changes directly to the same file (preserving its inode so inotify keeps firing) and increments the `X-EVOLUTION-DATA-REVISION` header on every write, which Evolution uses to detect external modifications. After writing, the TUI ensures the factory is running via DBus activation — but it never kills or restarts the factory, since gnome-calendar's DBus proxy does not recover from a factory restart.
