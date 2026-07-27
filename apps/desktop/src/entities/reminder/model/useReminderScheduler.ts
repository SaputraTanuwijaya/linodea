/**
 * React binding for the reminder notification scheduler.
 *
 * Owns the scheduler's lifetime (start on mount, stop on unmount), every
 * reconciliation trigger that isn't the scheduler's own timer, and the missed
 * count derived from each pass.
 *
 * The scheduler engine itself is `../lib/scheduler`; this hook is only the
 * wiring that a React tree needs. It lives with the entity so the whole
 * "reminders fire, and stale ones become missed" story stays in one place.
 *
 * CRITICAL: the scheduler must start exactly once. `applySyncResult` is
 * `useCallback([], …)` and the caller's `onNewlyMissed` is held in a ref for
 * that reason — if either became unstable, the effect below would tear down and
 * restart the scheduler on every render, re-running the cold-start retry loop
 * and re-arming timers.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { isTauriRuntime } from "@/shared/lib";

import { enableReminderNotifications } from "../lib/notifications";
import {
  startReminderNotificationScheduler,
  type ReminderNotificationScheduler,
} from "../lib/scheduler";

export function useReminderScheduler({
  listVisible,
  onNewlyMissed,
}: {
  /** True while the reminder list is on screen; drives an open-time pass. */
  listVisible: boolean;
  /** Called when a pass has just moved reminders into `missed`. */
  onNewlyMissed: () => void;
}) {
  const schedulerRef = useRef<ReminderNotificationScheduler | null>(null);
  // Count of reminders sitting in the `missed` state, read from each scheduler
  // sync. Surfaced as a badge on the capture bar's menu button so a user who
  // relaunches (landing in capture, not the list) sees they have missed items.
  const [missedCount, setMissedCount] = useState(0);

  const onNewlyMissedRef = useRef(onNewlyMissed);
  useEffect(() => {
    onNewlyMissedRef.current = onNewlyMissed;
  });

  // Apply a scheduler pass's result: update the missed badge, and if the pass
  // just moved reminders into `missed`, signal the caller to refresh. Marking
  // missed is async; without this an already-open list keeps showing them as
  // pending (it read the rows before the pass wrote the new status) until it's
  // reopened. A coalesced pass returns undefined, so this no-ops for those.
  const applySyncResult = useCallback(
    (result?: { missedCount: number; newlyMissed: number }) => {
      if (!result) return;
      setMissedCount(result.missedCount);
      if (result.newlyMissed > 0) onNewlyMissedRef.current();
    },
    [],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void enableReminderNotifications().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const scheduler = startReminderNotificationScheduler();
    schedulerRef.current = scheduler;

    // The very first sync can land before the Tauri IPC bridge is ready at cold
    // start; `listReminderNodes()` then fails, the scheduler swallows it, and
    // nothing is marked missed — so the badge/list only caught up on a later
    // interaction-triggered sync (the reported bug). `sync()` returns a result
    // on success and `undefined` on failure, so retry a few times until one
    // lands. (The 15s backstop would eventually recover it; this just makes the
    // first pass prompt so the missed badge shows right after relaunch.)
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 6 && !cancelled; attempt += 1) {
        const result = await scheduler.sync();
        if (cancelled) return;
        if (result) {
          applySyncResult(result);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
    })();

    // Re-sync when the window regains focus: cheap reconciliation after the
    // machine wakes or the popup is summoned, on top of the precise timer.
    const onFocus = () => void scheduler.sync().then(applySyncResult);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      scheduler.stop();
      schedulerRef.current = null;
    };
  }, [applySyncResult]);

  // Opening the reminder list runs a scheduler pass first, so any reminder that
  // just crossed into `missed` is marked before/at open time rather than waiting
  // for the next backstop tick. `applySyncResult` then refreshes the open list.
  useEffect(() => {
    if (!listVisible || !isTauriRuntime()) return;
    void schedulerRef.current?.sync().then(applySyncResult);
  }, [listVisible, applySyncResult]);

  /**
   * Run a pass now. Used after a capture or a list mutation so a just-armed
   * reminder gets a precise timer instead of waiting for the backstop tick.
   */
  const sync = useCallback(() => {
    void schedulerRef.current?.sync().then(applySyncResult);
  }, [applySyncResult]);

  return { missedCount, sync };
}
