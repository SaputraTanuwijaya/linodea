# `widgets/` — composite UI blocks

A widget is a reusable composite that combines multiple features into a single UI block. Create a widget only when there's a real candidate — don't put a "big-but-single" feature here. Big single features stay in `features/`.

**Possible future candidates:**
- `popup-shell/` — frameless popup chrome (logo, ribbon, menu trigger) wrapping any page.
- `popup-menu/` — the right-click / `•••` context menu shared across modes.

**Empty today.** First widget arrives when extracting one buys clarity, not before.

See `.claude/skills/linodea-frontend-architecture/SKILL.md` for the full architecture.
