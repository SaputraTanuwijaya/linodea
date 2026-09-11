/**
 * Pins the popup sizing arithmetic.
 *
 * Colleague report (S84): "sometimes doing `/` doesn't show every command".
 * One of its two causes was this math — the window grew downward from a
 * centered top with no regard for where the screen ended, so the tail of the
 * command list rendered past the bottom edge and simply wasn't there. The
 * screens below are the real ones it shipped to.
 */

import { describe, expect, it } from "vitest";

import {
  CAPTURE_DEFAULT_HEIGHT,
  SLASH_COMMAND_ROW_HEIGHT,
  anchorPopupHeight,
  popupCeilingFor,
  slashListHeightFor,
  slashPopupHeight,
} from "./popupLayout";

/** Work-area heights, in CSS px, of the screens this shipped to. */
const SCREEN = {
  /** 1920x1080 at 100% scaling, minus the taskbar. */
  fullHd: 1032,
  /** 1920x1080 at 125% scaling — the common Windows laptop default. */
  fullHdScaled: 824,
  /** 1366x768 at 100% scaling. */
  smallLaptop: 728,
};

/** Every command in the registry, i.e. what a bare `/` with no filter shows. */
const ALL_COMMANDS = 8;

/** Geometry for a window Rust centered at the collapsed capture height. */
function centered(availHeight: number) {
  return {
    availHeight,
    availTop: 0,
    windowTop: (availHeight - CAPTURE_DEFAULT_HEIGHT) / 2,
  };
}

describe("popupCeilingFor", () => {
  it("never lets the popup pass the bottom of the work area", () => {
    for (const avail of Object.values(SCREEN)) {
      const geometry = centered(avail);
      expect(geometry.windowTop + popupCeilingFor(geometry)).toBeLessThanOrEqual(
        avail,
      );
    }
  });

  it("measures from the real window top rather than assuming centered", () => {
    // A bar nearer the top of the screen has more room below it. Re-deriving
    // the centering here instead of measuring would miss that.
    const high = popupCeilingFor({ availHeight: 1032, availTop: 0, windowTop: 200 });
    const low = popupCeilingFor({ availHeight: 1032, availTop: 0, windowTop: 600 });
    expect(high).toBeGreaterThan(low);
    expect(200 + high).toBeLessThanOrEqual(1032);
  });

  it("falls back to a centered estimate when the position looks wrong", () => {
    const expected = popupCeilingFor(centered(SCREEN.fullHd));
    // screenY reads 0 before the window is placed, and can land off the work
    // area entirely; neither should produce a ceiling taller than the screen.
    expect(popupCeilingFor({ availHeight: SCREEN.fullHd, windowTop: 0 })).toBe(
      expected,
    );
    expect(
      popupCeilingFor({ availHeight: SCREEN.fullHd, windowTop: 99_999 }),
    ).toBe(expected);
  });

  it("survives a webview that reports no usable screen at all", () => {
    expect(popupCeilingFor({ availHeight: 0, windowTop: 0 })).toBe(
      popupCeilingFor({ availHeight: 768, windowTop: 0 }),
    );
    expect(
      popupCeilingFor({ availHeight: Number.NaN, windowTop: Number.NaN }),
    ).toBeGreaterThanOrEqual(CAPTURE_DEFAULT_HEIGHT);
  });
});

describe("slash menu sizing", () => {
  it("keeps the popup on screen on every real screen", () => {
    for (const avail of Object.values(SCREEN)) {
      const geometry = centered(avail);
      const height = slashPopupHeight(
        slashListHeightFor(ALL_COMMANDS, popupCeilingFor(geometry)),
      );
      // The regression: this used to be ~652px regardless of screen, so on
      // every one of these the tail of the list rendered off the bottom.
      expect(geometry.windowTop + height).toBeLessThanOrEqual(avail);
    }
  });

  // How many of the eight rows are visible without scrolling, per screen. These
  // are low because the bar is centered — half the screen sits unused above it,
  // and 58px rows are expensive. Capping stops the silent cut-off, but raising
  // the capture anchor and tightening the rows is what would show all eight;
  // that's a product change, not a bug fix, so it is deliberately not done here.
  // Update these numbers if either lever moves.
  it.each([
    ["1080p", SCREEN.fullHd, 6],
    ["1080p @125%", SCREEN.fullHdScaled, 4],
    ["1366x768", SCREEN.smallLaptop, 3],
  ])("shows %s: %i px of work area -> %i rows before scrolling", (_, avail, rows) => {
    const listHeight = slashListHeightFor(
      ALL_COMMANDS,
      popupCeilingFor(centered(avail)),
    );
    expect(Math.floor(listHeight / SLASH_COMMAND_ROW_HEIGHT)).toBe(rows);
  });

  it("shows every row outright once there is room below the bar", () => {
    // What a higher anchor would buy: the same screen, bar nearer the top.
    const ceiling = popupCeilingFor({
      availHeight: SCREEN.fullHd,
      availTop: 0,
      windowTop: 260,
    });
    expect(slashListHeightFor(ALL_COMMANDS, ceiling)).toBe(
      ALL_COMMANDS * SLASH_COMMAND_ROW_HEIGHT,
    );
  });

  it("shrinks with the filtered list", () => {
    const ceiling = popupCeilingFor(centered(SCREEN.fullHd));
    expect(slashListHeightFor(1, ceiling)).toBe(SLASH_COMMAND_ROW_HEIGHT);
  });
});

describe("anchorPopupHeight", () => {
  it("stays on screen and reserves a row even with no anchors to show", () => {
    const ceiling = popupCeilingFor(centered(SCREEN.smallLaptop));
    expect(anchorPopupHeight(0, ceiling)).toBe(anchorPopupHeight(1, ceiling));
    expect(anchorPopupHeight(99, ceiling)).toBeLessThanOrEqual(ceiling);
  });
});
