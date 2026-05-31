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
 * instant is re-armed. When the window is focused, this gives second-level
 * accuracy without busy-polling.
 *
 * The backstop interval is NOT just a sleep/wake safety net — it's the
 * reliability floor. WebView2/Chromium throttles (and can effectively suspend)
 * `setTimeout` in a HIDDEN window, so a far-out precise timer can't be trusted
 * to fire on time while the popup is hidden. A short, dumb interval still fires
 * reliably (interval throttling enforces a minimum cadence, not suspension) —
 * which is exactly how the pre-S28 15s poll delivered toasts while hidden. We
 * keep that 15s floor so worst-case latency matches the old proven behavior;
 * the precise timer is a foreground accuracy bonus on top, not the sole path.
 *
 * Not in scope here (deliberately deferred — see S28 notes / notification
 * strategy doc): native OS-level scheduling (Windows `ToastNotificationManager`
 * etc.) that fires while the app is fully quit. That is per-platform Rust,
 * only verifiable from an installed build, and the always-on-tray model makes
 * it a narrow win.
 */

import { notifyDueReminders, type DueNotificationResult } from "./notifications";

/** Reliability floor. Matches the proven pre-S28 poll cadence so a throttled /
 * suspended precise timer in a hidden window can't delay a toast beyond ~15s. */
const BACKSTOP_INTERVAL_MS = 15_000;

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
    } catch {
      // A transient failure (DB lock, permission race) must not kill the loop.
      // The backstop interval retries on its next tick.
      return undefined;
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
