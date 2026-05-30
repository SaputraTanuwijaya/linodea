# `features/` — user-facing capabilities

A feature is one discrete thing the user can do: pick a theme, edit prealerts, toggle autostart, see autocorrect feedback. Each feature owns its UI, its state hook, and its strings.

**Layout inside a feature:**
```
features/<name>/
├── ui/          # components
├── model/       # state hooks, persistence, config types
├── api/         # I/O (rare; most lives in entities/)
├── settingsSection.ts  # if it contributes a Settings section
└── index.ts     # public surface — re-exports only what other layers need
```

**Rules:**
- One `use<Feature>` hook per feature owns persistence and exposes `[value, setValue]`.
- Cross-feature imports are forbidden. If two features need to share something, it moves to `shared/`.
- Other layers import only from `features/<name>` (the `index.ts`), never internal files.

**Planned features:** `theme`, `language`, `prealerts`, `startup`, `autocorrect-display`.

See `.claude/skills/linodea-frontend-architecture/SKILL.md` for the full architecture.
