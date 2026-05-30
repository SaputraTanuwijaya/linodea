# `entities/` — business objects

An entity is a domain object plus its platform-API wrappers. In Linodea today there's one: the reminder.

**Planned entities:**
- `reminder/` — model + typed wrappers around `invoke(...)` for the Rust SQLite commands + the notification polling loop.

**Rule:** features consume entities. Entities never import from features. If you find yourself wanting an entity to know about a specific feature, you're crossing a layer boundary — push the integration up into the feature instead.

**Note on types:** the canonical reminder types live in `@linodea/types` (a monorepo package). The `entities/reminder/` folder re-exports and extends them, but does not redefine them.

See `.claude/skills/linodea-frontend-architecture/SKILL.md` for the full architecture.
