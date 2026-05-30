# `app/` — bootstrap layer

Top-level wiring that runs once, at startup, before anything else can render.

**Contents (target state):**
- `App.tsx` — orchestrator only: mode state, `linodea:mode` event listener, popup menu state, global keyboard handlers, composition of pages. No feature-specific UI or state.
- `main.tsx` — React mount + pre-mount theme/language application.
- `index.css` / `App.css` — global tokens, theme variables.

**Rule:** if it's not bootstrap or orchestration, it doesn't go here.

See `.claude/skills/linodea-frontend-architecture/SKILL.md` for the full architecture.
