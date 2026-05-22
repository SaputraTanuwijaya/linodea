# Linodea

Linodea is a local-first desktop reminder app for fast capture and preparation-aware reminder chains.

Status: early MVP skeleton. The repository currently includes the desktop shell,
quick capture shell v0, shared types, deterministic parser v0, and a first local
SQLite persistence slice.

## Category

Linodea is desktop-first productivity software, not a web app. It uses web technologies for the desktop UI, but the product depends on native desktop behavior such as a global shortcut, tray/background execution, local notifications, startup behavior, and local storage.

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

- Global shortcut capture.
- Quick capture window.
- Deterministic reminder parser.
- Raw input preservation.
- Local SQLite storage.
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
