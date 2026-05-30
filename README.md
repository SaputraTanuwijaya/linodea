# Linodea

Linodea is a local-first desktop reminder app for fast capture and preparation-aware reminder chains.

Status: early MVP skeleton. The repository currently includes the desktop shell,
quick capture popup v1, shared types, deterministic parser v1 (with typo
tolerance), and a first local SQLite data layer with status and due-reminder
queries. The capture surface is now a frameless floating popup: pressing
`Ctrl+Alt+Shift+Space` summons a small dark rounded textbox, typing a reminder
shows the parsed time inline, and Enter saves and dismisses. The popup auto-hides
on focus loss. Tray icon and close-to-tray remain. Local notifications v0 polls
due reminders and sends one deduped desktop toast per due reminder while the app
is running.

## Architecture

Linodea follows the **local-first software** model: the device is the source of truth, and the network is optional. Reminders are stored in a local SQLite database; nothing leaves the device.

The app uses a **native shell + web frontend** pattern via Tauri v2. A small Rust binary owns the OS surface — tray icon, global shortcut, notifications, autostart, the SQLite file — and a React/TypeScript UI renders inside a system WebView. The two halves talk through a typed command boundary.

Why this stack:

- **Offline-by-default** — no server to wait on, no account to create.
- **Privacy** — data never leaves the device.
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
- No AI dependency.
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
