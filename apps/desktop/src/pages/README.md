# `pages/` — top-level views

In Linodea, "pages" are the popup modes the user can be in. Each mode is a folder.

**Planned pages:**
- `capture/` — the quick-capture form (default mode).
- `list/` — the stop-gap reminders list.
- `settings/` — the settings panel (composes feature sections via the section registry).

**Rule:** a page composes features and widgets. It does not own business logic — it routes user input to the right feature hooks and renders feature components.

See `.claude/skills/linodea-frontend-architecture/SKILL.md` for the full architecture.
