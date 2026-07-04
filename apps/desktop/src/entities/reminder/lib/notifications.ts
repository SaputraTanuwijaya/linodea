/**
 * Reminder notification polling loop.
 *
 * Lives in the reminder entity because it composes reminder lifecycle
 * (auto-done at T-due) with notification dispatch. It reads two feature
 * configs (prealerts, language) but does not import from features/ —
 * instead it pulls from the underlying registries and storage helpers in
 * shared/i18n and feature model files. (Both directions are valid: this
 * file is one layer up, so importing from `features/*` is allowed.)
 *
 * Dedupe lives in localStorage keyed per-reminder, per-stage. The legacy
 * v1 store (array of "fired due" ids) is migrated on first read.
 */

import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { invoke } from "@tauri-apps/api/core";
import { addRecurrenceInterval } from "@linodea/parser";
import type { ReminderNode } from "@linodea/types";

import { getStoredPrealerts, sortDescending } from "@/features/prealerts";

import {
  advanceReminderRecurrence,
  listReminderNodes,
  updateReminderNodeStatus,
} from "../api/commands";
import { isActionable } from "../model/reminder";

/** Payload for the custom Linodea alert window (`show_alert` Rust command).
 * The alert webview formats the text via i18n, so we pass structured data. */
interface AlertPayload {
  reminderId: string;
  title: string;
  kind: "due" | "prealert";
  leadMinutes?: number;
  whenMs: number;
}

function showAlert(payload: AlertPayload): void {
  void invoke("show_alert", { payload }).catch(() => undefined);
}

const FIRES_STORAGE_KEY = "linodea.notifiedFires.v2";
const LEGACY_DUE_IDS_KEY = "linodea.notifiedDueReminderIds.v1";
const MAX_STORED_REMINDER_RECORDS = 500;
const MS_PER_MINUTE = 60_000;
/**
 * Grace window for the "missed while the app was off" rule. While the app runs,
 * the precise timer / 15s backstop fires a reminder within ~15s of its due time.
 * So a non-recurring reminder that is still unfired and more than this far past
 * due means the app almost certainly wasn't running when it came due — mark it
 * `missed` (persistent, surfaced in the list) instead of firing a stale alert
 * and auto-doning it, which would "silently" complete it if the user wasn't
 * looking. Reminders due within the grace are treated as a normal on-time fire.
 */
const MISSED_GRACE_MS = 60_000;

export type NotificationPermissionState = "unknown" | "granted" | "denied";

export interface DueNotificationResult {
  sentCount: number;
  autoDoneCount: number;
  /** Reminders currently in the `missed` state (surfaced, awaiting the user). */
  missedCount: number;
  /**
   * Reminders this pass *transitioned* into `missed` (were pending/snoozed
   * before). Non-zero means an open list is now stale and must re-fetch — it
   * read the reminders before this async pass wrote the new status.
   */
  newlyMissed: number;
  permissionGranted: boolean;
  /**
   * Epoch-ms of the earliest still-unfired prealert or due fire across all
   * actionable reminders, or `undefined` if nothing is pending. The scheduler
   * uses this to arm a precise timer instead of coarse polling.
   */
  nextFireMs?: number;
}

interface FireRecord {
  due?: true;
  prealerts?: number[];
}

type FireStore = Record<string, FireRecord>;

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  return (await isPermissionGranted()) ? "granted" : "unknown";
}

export async function enableReminderNotifications(): Promise<NotificationPermissionState> {
  if (await isPermissionGranted()) {
    return "granted";
  }

  const permission = await requestPermission();
  return permission === "granted" ? "granted" : "denied";
}

/**
 * Poll-tick driver. Reads the current prealert config, walks every
 * actionable reminder, and:
 *   - marks a non-recurring reminder `missed` if it came due while the app was
 *     off (well past due, never fired) — no stale alert, no auto-done,
 *   - fires any prealert whose window has been crossed and not yet fired,
 *   - fires the T-due toast (once) when due time has passed,
 *   - immediately auto-marks the reminder `done` after the T-due fire.
 */
export async function notifyDueReminders(): Promise<DueNotificationResult> {
  // The custom Linodea alert window does not depend on OS notification
  // permission (that gate is only relevant to the deferred app-off OS-toast
  // fallback), so we never block firing on it.
  const permissionGranted = await isPermissionGranted().catch(() => false);

  const reminders = await listReminderNodes();
  const actionable = reminders.filter(isActionable);
  const sortedOffsets = sortDescending(getStoredPrealerts().offsets);
  const store = readFireStore();
  const now = Date.now();
  let sentCount = 0;
  let autoDoneCount = 0;
  let missedCount = 0;
  let newlyMissed = 0;
  let nextFireMs = Infinity;

  for (const reminder of actionable) {
    const dueMs = effectiveDueMs(reminder);
    if (!Number.isFinite(dueMs)) {
      continue;
    }
    const createdMs = new Date(reminder.createdAt).getTime();
    const record: FireRecord = store[reminder.id] ?? {};

    // Already surfaced as `missed` — inert here; it waits in the list until the
    // user marks it done, reschedules (edit revives it), or deletes it.
    if (reminder.status === "missed") {
      missedCount += 1;
      continue;
    }

    // Came due while the app was off (well past due, never fired): mark it
    // `missed` instead of firing a stale alert and auto-doning it. Recurring
    // reminders are left to roll forward on their own (existing fire+advance).
    if (!record.due && !reminder.recurrence && dueMs <= now - MISSED_GRACE_MS) {
      try {
        await updateReminderNodeStatus({
          id: reminder.id,
          status: "missed",
          updatedAt: new Date(now).toISOString(),
        });
        missedCount += 1;
        newlyMissed += 1;
      } catch {
        // DB write failed; leave it pending and let a later pass retry.
      }
      continue;
    }

    // Prealerts -------------------------------------------------------
    for (const offset of sortedOffsets) {
      const fireMs = dueMs - offset.minutes * MS_PER_MINUTE;
      // Skip prealerts whose fire-time is already past T-due (offset 0),
      // that would have fired before the reminder existed, or already fired.
      if (fireMs >= dueMs) continue;
      if (Number.isFinite(createdMs) && fireMs < createdMs) continue;
      if (record.prealerts?.includes(offset.minutes)) continue;
      // Not yet time — record it as a candidate for the next precise wake.
      if (fireMs > now) {
        nextFireMs = Math.min(nextFireMs, fireMs);
        continue;
      }

      showAlert({
        reminderId: reminder.id,
        title: reminder.title,
        kind: "prealert",
        leadMinutes: offset.minutes,
        whenMs: fireMs,
      });
      record.prealerts = [...(record.prealerts ?? []), offset.minutes];
      sentCount += 1;
    }

    // T-due — fire, then either re-arm (recurring) or auto-done ------
    if (!record.due) {
      if (dueMs <= now) {
        showAlert({
          reminderId: reminder.id,
          title: reminder.title,
          kind: "due",
          whenMs: dueMs,
        });
        sentCount += 1;
        const nowIso = new Date(now).toISOString();

        const rule = reminder.recurrence;
        const hasNextOccurrence =
          rule !== undefined && (rule.count === undefined || rule.count > 1);

        if (rule && hasNextOccurrence) {
          // Recurring: re-arm the next occurrence instead of marking done.
          // Advance from `scheduledAt` (the regular slot), not a snooze time.
          const nextIso = addRecurrenceInterval(
            reminder.scheduledAt,
            rule,
            reminder.timezone,
          );
          try {
            await advanceReminderRecurrence({
              id: reminder.id,
              scheduledAt: nextIso,
              recurrence: {
                ...rule,
                count: rule.count === undefined ? undefined : rule.count - 1,
              },
              updatedAt: nowIso,
            });
            // Forget this cycle's fire record so the next occurrence re-fires
            // its prealerts + due, and arm the precise timer for it now.
            delete store[reminder.id];
            const nextMs = new Date(nextIso).getTime();
            if (Number.isFinite(nextMs)) nextFireMs = Math.min(nextFireMs, nextMs);
            continue;
          } catch {
            // Re-arm failed (offline DB, etc.) but the alert already fired.
            // Mark `due` so we don't spam; it stays pending in SQLite and a
            // later pass can recover.
            record.due = true;
          }
        } else {
          record.due = true;
          try {
            await updateReminderNodeStatus({
              id: reminder.id,
              status: "done",
              updatedAt: nowIso,
              completedAt: nowIso,
            });
            autoDoneCount += 1;
          } catch {
            // Mark-done failed (offline DB, etc.) but the toast already
            // fired. Keep `record.due = true` so we never re-fire. The
            // reminder will stay pending in SQLite; the next sync pass will
            // attempt to mark-done again because we re-detect dueMs<=now
            // but `record.due` blocks re-firing. (Cost: orphan pending row
            // until manual cleanup or a future repair pass.)
          }
        }
      } else {
        // Future due time — candidate for the next precise wake.
        nextFireMs = Math.min(nextFireMs, dueMs);
      }
    }

    store[reminder.id] = record;
  }

  writeFireStore(store);
  return {
    sentCount,
    autoDoneCount,
    missedCount,
    newlyMissed,
    permissionGranted,
    nextFireMs: Number.isFinite(nextFireMs) ? nextFireMs : undefined,
  };
}

/**
 * The instant a reminder should actually fire. A snoozed reminder fires at its
 * `snoozedUntil`, not its original `scheduledAt`; everything else fires at
 * `scheduledAt`. Prealerts and the due/auto-done step both key off this.
 */
function effectiveDueMs(reminder: ReminderNode): number {
  if (reminder.status === "snoozed" && reminder.snoozedUntil) {
    const snoozed = new Date(reminder.snoozedUntil).getTime();
    if (Number.isFinite(snoozed)) return snoozed;
  }
  return new Date(reminder.scheduledAt).getTime();
}

/**
 * Forget a reminder's fire record so it can fire again. Used when a reminder is
 * snoozed after it already fired (its `due`/prealert dedupe would otherwise
 * block the re-fire at the new time). Safe to call for never-fired reminders.
 */
export function clearReminderFireRecord(id: string): void {
  const store = readFireStore();
  if (store[id]) {
    delete store[id];
    writeFireStore(store);
  }
}

function readFireStore(): FireStore {
  try {
    const raw = localStorage.getItem(FIRES_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as FireStore;
      }
    }
    // Migrate legacy v1 (array of reminder ids that fired T-due).
    const legacy = localStorage.getItem(LEGACY_DUE_IDS_KEY);
    if (legacy) {
      const ids: unknown = JSON.parse(legacy);
      if (Array.isArray(ids)) {
        const migrated: FireStore = {};
        for (const id of ids) {
          if (typeof id === "string") {
            migrated[id] = { due: true };
          }
        }
        localStorage.setItem(FIRES_STORAGE_KEY, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_DUE_IDS_KEY);
        return migrated;
      }
    }
  } catch {
    // Ignore parse failures; fall through to empty store.
  }
  return {};
}

function writeFireStore(store: FireStore) {
  const entries = Object.entries(store);
  const pruned =
    entries.length > MAX_STORED_REMINDER_RECORDS
      ? entries.slice(-MAX_STORED_REMINDER_RECORDS)
      : entries;
  localStorage.setItem(FIRES_STORAGE_KEY, JSON.stringify(Object.fromEntries(pruned)));
}
