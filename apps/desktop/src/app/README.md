# `app/` — bootstrap layer

Top-level wiring that runs once, at startup, before anything else can render.

**Contents:**
- `App.tsx` — composition only: calls one hook per concern and lays out the shell. The only state it holds is `listRefreshKey`, the one signal with two genuine owners (a capture that saved, a scheduler pass that marked reminders missed).
- `model/useMode.ts` — which surface is showing, and the `linodea:mode` listener. No setter: Rust is the only source of mode changes.
- `model/useAppSettings.ts` — composes the feature hooks into the `SettingsBundle`.
- `model/useConfirmResultRouting.ts` — routes the themed confirm window's answer (quit / autostart / autostartOff).
- `main.tsx` — React mount + pre-mount theme/language application.
- `index.css` / `App.css` — global tokens, theme variables.

**Rule:** if it's not bootstrap or orchestration, it doesn't go here. A hook belongs in `app/model/` only when it spans layers no single feature may reach across — otherwise it lives with its feature, entity, or widget.

See `.claude/skills/linodea-frontend-architecture/SKILL.md` for the full architecture.
