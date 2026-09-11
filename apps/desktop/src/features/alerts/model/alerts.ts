/**
 * Alert presence — how hard a fired reminder tries to get noticed.
 *
 * Early feedback (S84) was that the alert is "too silent" and "too small for
 * reminding". Both are the same complaint from two angles: the card was tuned
 * for not-distracting, and landed below the threshold where it actually
 * reminds anyone. Rather than just move the numbers and trade one complaint for
 * the opposite one, presence is a single user-facing dial that moves volume,
 * size, dwell and ping count together — so the quiet original is still
 * reachable, it just isn't the default any more.
 *
 * One dial rather than four sliders: these values only make sense in
 * combination. A huge card that pings once, or a tiny one that pings five
 * times, are not settings anyone wants.
 *
 * The window *size* for each level lives in Rust (`desktop.rs`), which owns the
 * alert window; everything rendered inside it is here.
 *
 * Persistence: localStorage key `linodea.alerts.v1`.
 */

export const ALERT_PRESENCE_IDS = ["subtle", "normal", "insistent"] as const;

export type AlertPresence = (typeof ALERT_PRESENCE_IDS)[number];

export const DEFAULT_ALERT_PRESENCE: AlertPresence = "normal";

const STORAGE_KEY = "linodea.alerts.v1";

export interface AlertProfile {
  /**
   * Playback level. Above 1 this amplifies past the source file's own ceiling —
   * the shipped ping is mastered quiet, so plain element volume topped out
   * below what people wanted (see `shared/lib/sounds.ts`).
   */
  volume: number;
  /** How long the card stays before auto-dismissing. */
  dwellMs: number;
  /**
   * Extra pings after the one on show, as ms from show. Each level stops well
   * before its dwell ends, so the card never closes on a ping.
   */
  pingRepeatMs: number[];
  /** Tailwind type scale for the card, so a bigger window reads bigger. */
  titleClass: string;
  bodyClass: string;
  buttonClass: string;
  /** Card padding, scaled with the window so the content doesn't float. */
  padClass: string;
  /**
   * How much of a long title the card shows. The extra height at the larger
   * levels is spent letting a real reminder title wrap rather than on empty
   * space — a bigger card that still truncates to "Kirim laporan bulanan ke
   * Pak Budi sebelum..." is bigger without being more useful.
   */
  titleClampClass: string;
}

export const ALERT_PROFILES: Record<AlertPresence, AlertProfile> = {
  // The pre-S84 alert, kept for anyone who liked it that way.
  subtle: {
    volume: 0.7,
    dwellMs: 20_000,
    pingRepeatMs: [],
    titleClass: "text-sm font-semibold",
    bodyClass: "text-xs",
    buttonClass: "h-9 px-4 text-xs",
    padClass: "px-4 py-3",
    titleClampClass: "truncate",
  },
  normal: {
    volume: 1.8,
    dwellMs: 30_000,
    pingRepeatMs: [10_000, 20_000],
    titleClass: "text-base font-semibold",
    bodyClass: "text-sm",
    buttonClass: "h-10 px-5 text-sm",
    padClass: "px-5 py-3.5",
    titleClampClass: "line-clamp-2",
  },
  insistent: {
    volume: 2.8,
    dwellMs: 60_000,
    pingRepeatMs: [8_000, 16_000, 24_000, 32_000, 40_000],
    titleClass: "text-lg font-semibold",
    bodyClass: "text-sm",
    buttonClass: "h-11 px-5 text-sm",
    padClass: "px-5 py-4",
    titleClampClass: "line-clamp-2",
  },
};

export function alertProfile(presence: AlertPresence | undefined): AlertProfile {
  return ALERT_PROFILES[presence ?? DEFAULT_ALERT_PRESENCE] ?? ALERT_PROFILES.normal;
}

function isAlertPresence(value: unknown): value is AlertPresence {
  return ALERT_PRESENCE_IDS.includes(value as AlertPresence);
}

/**
 * Read outside React too: the notification driver reads it on each poll tick to
 * stamp the alert payload, exactly as it reads the prealert config.
 */
export function getStoredAlertPresence(): AlertPresence {
  if (typeof window === "undefined") return DEFAULT_ALERT_PRESENCE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return isAlertPresence(raw) ? raw : DEFAULT_ALERT_PRESENCE;
}

export function persistAlertPresence(presence: AlertPresence): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, presence);
}
