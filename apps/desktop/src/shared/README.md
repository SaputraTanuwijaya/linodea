# `shared/` — reusable building blocks

Bits with no business logic that any other layer can import: UI primitives, helpers, types, i18n core, theme registry.

**Planned structure:**
```
shared/
├── i18n/        # base machinery; per-feature strings live with their feature
├── ui/          # tiny primitives: SettingsSection wrapper, Toggle, Card
├── lib/         # runtime checks (isTauriRuntime), date helpers, etc.
└── config/      # constants like MODE_EVENT, storage keys
```

**Rule:** `shared/` must never import from any other layer. Everything else can import from `shared/`. If you find yourself wanting `shared/` to know about a feature, the thing belongs in the feature, not here.

See `.claude/skills/linodea-frontend-architecture/SKILL.md` for the full architecture.
