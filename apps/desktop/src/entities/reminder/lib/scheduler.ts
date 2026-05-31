/**
 * Precise in-process notification scheduler.
 *
 * Replaces the old fixed 15s polling loop. Each `sync()`:
 *   1. runs a `notifyDueReminders()` pass — fires anything already due /
 *      crossed, dedupes, auto-dones (unchanged behavior);
 *   2. reads the pass's `nextFireMs` (earliest still-unfired prealert / due
 *      instant) and arms a single `setTimeout` for exactly that moment.
 *
 * When that timer fires, it re-syncs: the now-due item fires and the next
 * instant is re-armed. The result is second-level accuracy while the app is
 * running (and with Startup v0 launching Linodea into the tray on boot, that
 * is effectively always) without busy-polling.
 *
 * A coarse backstop interval still runs as a safety net — `setTimeout` can be
 * delayed or dropped across system sleep/wake, and external changes (a Done
 * from another surface) should eventually be reconciled. It is far less
 * frequent than the old poll because the precise timer carries the accuracy.
 *
 * Not in scope here (deliberately deferred — see S28 notes / notification
 * strategy doc): native OS-level scheduling (Windows `ToastNotificationManager`
 * etc.) that fires while the app is fully quit. That is per-platform Rust,
 * only verifiable from an installed build, and the always-on-tray model makes
 * it a narrow win.
 */

import { notifyDueReminders, type DueNotificationResult } from "./notifications";

/** Safety re-sync cadence. The precise timer carries accuracy; this only
 * catches sleep/wake drift, dropped timers, and external state changes. */
const BACKSTOP_INTERVAL_MS = 60_000;

/** `setTimeout` clamps delays above ~2^31-1 ms to fire immediately. Cap armed
 * delays well under that; a far-future fire just re-arms when the cap elapses. */
const MAX_TIMER_MS = 2_000_000_000;

export interface ReminderNotificationScheduler {
  /** Fire due/crossed alerts now, then (re)arm the precise next-fire timer. */
  sync(): Promise<DueNotificationResult | undefined>;
  /** Tear down the precise timer and the backstop interval. */
  stop(): void;
}

export function startReminderNotificationScheduler(): ReminderNotificationScheduler {
  let nextTimer: number | undefined;
  let backstop: number | undefined;
  let stopped = false;
  // Serialize passes: notifyDueReminders reads+writes one localStorage store,
  // and sync() can be triggered concurrently (timer, backstop, focus, save).
  // Overlapping passes could double-fire or drop dedupe writes.
  let running = false;
  let rerunRequested = false;

  function clearNextTimer() {
    if (nextTimer !== undefined) {
      window.clearTimeout(nextTimer);
      nextTimer = undefined;
    }
  }

  function arm(nextFireMs: number | undefined) {
    clearNextTimer();
    if (stopped || nextFireMs === undefined) return;
    const delay = Math.max(0, Math.min(nextFireMs - Date.now(), MAX_TIMER_MS));
    nextTimer = window.setTimeout(() => {
      nextTimer = undefined;
      void sync();
    }, delay);
  }

  async function sync(): Promise<DueNotificationResult | undefined> {
    if (stopped) return undefined;
    if (running) {
      // A pass is in flight; coalesce this request into a single re-run.
      rerunRequested = true;
      return undefined;
    }
    running = true;
    try {
      const result = await notifyDueReminders();
      if (!stopped) arm(result.nextFireMs);
      return result;
    } finally {
      running = false;
      if (rerunRequested && !stopped) {
        rerunRequested = false;
        void sync();
      }
    }
  }

  backstop = window.setInterval(() => void sync(), BACKSTOP_INTERVAL_MS);

  return {
    sync,
    stop() {
      stopped = true;
      clearNextTimer();
      if (backstop !== undefined) {
        window.clearInterval(backstop);
        backstop = undefined;
      }
    },
  };
}
