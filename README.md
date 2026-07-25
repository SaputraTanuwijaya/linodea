# Linodea

Linodea is a local-first desktop reminder app for fast capture and preparation-aware reminder chains.

Status: working local-first desktop MVP. The repository currently includes the desktop shell,
quick capture popup v1, shared types, a deterministic English + Indonesian parser
with absolute calendar dates, typo tolerance (fuzzy date words, checklist cues,
type cues, Indonesian time markers, conjunctions, and category keywords), and a local SQLite data layer with status and
due-reminder queries. The capture surface is a frameless floating popup: pressing
`Ctrl+Alt+Shift+Space` summons a small dark rounded textbox, typing a reminder
shows the parsed time inline, and Enter saves and dismisses. The popup now uses a
linked-node Linodea mark and rotates general example prompts when reopened;
invalid non-empty captures stay open and play a short
error cue. The popup auto-hides on focus loss. Tray icon and close-to-tray remain. The tray's Reminders view lists
queued reminders with per-row done / snooze / edit / delete. Settings use a category
navigator for theme, language, configurable prealerts, launch-on-startup, optional
AI Assist, updates, and a Support section with donation and feedback links. Linodea
checks for a newer version shortly after it starts and
always asks before downloading and restarting; the same check can be run by hand from
Settings. `/ai` opens Gemini setup and `/feedback` opens the feedback form in the
browser; normal reminders remain local and instant, while
enabled AI Assist only receives failed or suspicious reminder phrases as a fallback.
AI setup links directly to Google AI Studio, keeps connected credentials collapsed,
and reserves provider choices for future adapters without presenting them as available.
Reminders fire user-set
prealerts plus a due-time alert in a custom Linodea notification window (with Done /
Snooze and a short ping), scheduled by a precise in-process timer. Relative reminders snap to the
minute; add `/countdown` to keep exact-second timing for short countdowns.

## Architecture

Linodea follows the **local-first software** model: the device is the source of truth, and the network is optional. Reminders are stored in a local SQLite database. Nothing leaves the device by default; users who explicitly enable BYO-key AI Assist send only the reminder phrase being resolved plus its time context to Gemini.

The app uses a **native shell + web frontend** pattern via Tauri v2. A small Rust binary owns the OS surface — tray icon, global shortcut, notifications, autostart, the SQLite file — and a React/TypeScript UI renders inside a system WebView. The two halves talk through a typed command boundary.

Why this stack:

- **Offline-by-default** — no server to wait on, no account to create.
- **Privacy by default** — reminder history stays local; the optional AI fallback is explicit and narrowly scoped.
- **Fast cold start** — opening the popup is instant; no network round-trip.
- **OS-native feel** — real global shortcut, real tray icon, real toast notifications.
- **Small installer, one codebase** — Windows / macOS / Linux ship from the same source.

This pattern fits productivity tools where cloud sync is overkill, where reliability matters more than collaboration, and where the user owns their data. It is the wrong choice when an app needs real-time multi-user sync, cross-device hand-off, or rich server-side processing — none of which Linodea needs in the MVP.

## Core Flow

```txt
shortcut -> type reminder -> Enter -> gone
```

The goal is to let users capture a future obligation without leaving their current work.

## Concept

Linodea means Linear + Nodes. A reminder can become a small chain of connected nodes:

```txt
[Prep] -> [Main Reminder] -> [Follow-up]
```

The MVP should stay focused on quick capture, local reliability, and a simple way to see reminder chains.

## Planned MVP Features

- Global shortcut capture (`Ctrl+Alt+Shift+Space`).
- Quick capture window.
- Deterministic reminder parser.
- Raw input preservation.
- Local SQLite storage.
- Tray/background window behavior.
- Local desktop notifications.
- Simple reminder history.
- Roadmap-style view for prep, main, and follow-up chains.

## Non-Goals

- No cloud sync in the MVP.
- No backend in the MVP.
- No mobile app in the MVP.
- No mandatory or bundled AI dependency.
- No calendar replacement.
- No kanban board.
- No workspace or team productivity suite.

## Planned Stack

- Tauri v2.
- React + TypeScript.
- Tailwind CSS.
- SQLite local database.
- Rust/Tauri only for native desktop integration.

Later sync/backend work may use Go, PostgreSQL, and PASETO, but that is outside the MVP skeleton.

## License

Linodea is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may read, build, modify, and share it for any **noncommercial** purpose — including building from source yourself to verify a release — while commercial use is reserved to the author. See [`LICENSE`](LICENSE) for the full terms; this note is a summary, not a substitute.

## Local Tooling

- Node.js `22.14.0` is recorded in `.node-version`.
- npm `11.3.0` is recorded in `package.json`.
- Rust `1.88.0` is recorded in `rust-toolchain.toml` for the Tauri app.

## Repository Layout

```txt
linodea/
+-- apps/
|   +-- desktop/
+-- packages/
|   +-- parser/
|   +-- types/
|   +-- config/
+-- README.md
+-- .gitignore
+-- .node-version
+-- rust-toolchain.toml
+-- package.json
```
