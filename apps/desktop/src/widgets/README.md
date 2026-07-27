# `widgets/` — composite UI blocks

A widget is a reusable composite that combines multiple features into a single UI block. Create a widget only when there's a real candidate — don't put a "big-but-single" feature here. Big single features stay in `features/`.

**Today:**
- `popup-menu/` — the right-click / `•••` menu shared across modes. `ui/PopupMenu.tsx` renders it; `model/usePopupMenu.ts` owns anchor state, the dismiss rules (click-outside, Escape, navigation) and action routing. App.tsx keeps the render decision only, since the menu is positioned `fixed` against the window rather than nested in the widget.

**Possible future candidate:**
- `popup-shell/` — frameless popup chrome (logo, ribbon, menu trigger) wrapping any page.

The next widget arrives when extracting one buys clarity, not before.

See `.claude/skills/linodea-frontend-architecture/SKILL.md` for the full architecture.
