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

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { ReminderNode } from "@linodea/types";

import { getStoredLanguage } from "@/features/language";
import { getStoredPrealerts, sortDescending } from "@/features/prealerts";
import { stringsFor } from "@/shared/i18n";

import { listReminderNodes, updateReminderNodeStatus } from "../api/commands";
import { isActionable } from "../model/reminder";

const FIRES_STORAGE_KEY = "linodea.notifiedFires.v2";
const LEGACY_DUE_IDS_KEY = "linodea.notifiedDueReminderIds.v1";
const MAX_STORED_REMINDER_RECORDS = 500;
const MS_PER_MINUTE = 60_000;

export type NotificationPermissionState = "unknown" | "granted" | "denied";

export interface DueNotificationResult {
  sentCount: number;
  autoDoneCount: number;
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
 *   - fires any prealert whose window has been crossed and not yet fired,
 *   - fires the T-due toast (once) when due time has passed,
 *   - immediately auto-marks the reminder `done` after the T-due fire.
 */
export async function notifyDueReminders(): Promise<DueNotificationResult> {
  const permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    return { sentCount: 0, autoDoneCount: 0, permissionGranted };
  }

  const reminders = await listReminderNodes();
  const actionable = reminders.filter(isActionable);
  const sortedOffsets = sortDescending(getStoredPrealerts().offsets);
  const strings = stringsFor(getStoredLanguage());
  const store = readFireStore();
  const now = Date.now();
  let sentCount = 0;
  let autoDoneCount = 0;
  let nextFireMs = Infinity;

  for (const reminder of actionable) {
    const dueMs = effectiveDueMs(reminder);
    if (!Number.isFinite(dueMs)) {
      continue;
    }
    const createdMs = new Date(reminder.createdAt).getTime();
    const record: FireRecord = store[reminder.id] ?? {};

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

      sendNotification({
        title: "Linodea",
        body: strings.notificationBody.prealert(reminder.title, offset.minutes),
      });
      record.prealerts = [...(record.prealerts ?? []), offset.minutes];
      sentCount += 1;
    }

    // T-due + auto-done ----------------------------------------------
    if (!record.due) {
      if (dueMs <= now) {
        sendNotification({
          title: "Linodea",
          body: strings.notificationBody.due(reminder.title, formatScheduledTime(reminder)),
        });
        record.due = true;
        sentCount += 1;

        const nowIso = new Date(now).toISOString();
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

function formatScheduledTime(reminder: ReminderNode): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(effectiveDueMs(reminder)));
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
