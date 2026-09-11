/**
 * Popup sizing arithmetic for capture mode.
 *
 * Rust centers the capture window at `CAPTURE_DEFAULT_HEIGHT` on show, then
 * `set_popup_height` grows it *downward from that fixed top* — deliberate, since
 * re-centering makes the bar jump as it grows (see the Rust comment on
 * `set_popup_height`). Nothing in that stopped a tall dropdown from growing past
 * the bottom of the screen: the full eight-command `/` list asks for ~650px,
 * while a centered bar on a 1080p screen leaves only ~565px below it — and just
 * ~465px at 125% scaling. The overflowing rows were not clipped with a
 * scrollbar, they were off-screen and invisible.
 *
 * So the popup is capped at the room actually below the bar, and the menu
 * scrolls inside that. The room is *measured* from where Rust really put the
 * window rather than re-deriving its centering here, so the two can't drift.
 *
 * Kept pure and separate from the component so the arithmetic that broke is
 * pinned by tests.
 */

export const CAPTURE_DEFAULT_HEIGHT = 130;
export const CAPTURE_MENU_BASE_HEIGHT = 150;
export const SLASH_COMMAND_ROW_HEIGHT = 58;
export const SLASH_MENU_HEADER_HEIGHT = 38;
export const ANCHOR_PICKER_ROW_HEIGHT = 40;
export const ANCHOR_PICKER_HEADER_HEIGHT = 42;
export const MAX_VISIBLE_ANCHORS = 5;

/** Slack below a grown popup so it clears the screen edge and the taskbar. */
const POPUP_BOTTOM_MARGIN = 16;
/** Work-area height assumed when the webview won't report one. */
const FALLBACK_AVAIL_HEIGHT = 768;

/** What the webview can tell us about where it sits. */
export interface PopupGeometry {
  /** `screen.availHeight` — work area height, taskbar excluded. */
  availHeight: number;
  /** `screen.availTop` — non-standard, so treated as optional. */
  availTop?: number;
  /** `window.screenY` — the window's top edge in screen coordinates. */
  windowTop: number;
}

/**
 * Tallest the popup may grow: from its top edge down to the bottom of the work
 * area. Falls back to a centered-window estimate when the webview reports a
 * position that can't be right (0 during startup, or off the work area).
 */
export function popupCeilingFor(geometry: PopupGeometry): number {
  const { availHeight, availTop, windowTop } = geometry;
  const avail =
    Number.isFinite(availHeight) && availHeight > 0
      ? availHeight
      : FALLBACK_AVAIL_HEIGHT;
  const top = Number.isFinite(availTop) ? (availTop as number) : 0;
  const measured = top + avail - windowTop;
  const usable =
    Number.isFinite(measured) && windowTop > top && measured > CAPTURE_DEFAULT_HEIGHT
      ? measured
      : avail - Math.max(0, (avail - CAPTURE_DEFAULT_HEIGHT) / 2);
  return Math.max(CAPTURE_DEFAULT_HEIGHT, usable - POPUP_BOTTOM_MARGIN);
}

/** The live ceiling, read off the real window. */
export function popupCeiling(): number {
  if (typeof window === "undefined") {
    return popupCeilingFor({ availHeight: FALLBACK_AVAIL_HEIGHT, windowTop: 0 });
  }
  const screen = window.screen as Screen & { availTop?: number };
  return popupCeilingFor({
    availHeight: screen?.availHeight,
    availTop: screen?.availTop,
    windowTop: window.screenY,
  });
}

/**
 * Height for the slash menu's scrolling row area: what the rows want, capped by
 * what is left on screen once the bar and the menu header are paid for. The
 * menu scrolls within this, so a capped list hides nothing — it scrolls.
 */
export function slashListHeightFor(
  suggestionCount: number,
  ceiling: number,
): number {
  return Math.min(
    suggestionCount * SLASH_COMMAND_ROW_HEIGHT,
    ceiling - CAPTURE_MENU_BASE_HEIGHT - SLASH_MENU_HEADER_HEIGHT,
  );
}

/** Window height that shows `listHeight` worth of command rows. */
export function slashPopupHeight(listHeight: number): number {
  return CAPTURE_MENU_BASE_HEIGHT + SLASH_MENU_HEADER_HEIGHT + listHeight;
}

/** Window height for the `/link` anchor picker, capped the same way. */
export function anchorPopupHeight(anchorCount: number, ceiling: number): number {
  const rows = Math.max(1, Math.min(anchorCount, MAX_VISIBLE_ANCHORS));
  return Math.min(
    ceiling,
    CAPTURE_MENU_BASE_HEIGHT +
      ANCHOR_PICKER_HEADER_HEIGHT +
      rows * ANCHOR_PICKER_ROW_HEIGHT,
  );
}
