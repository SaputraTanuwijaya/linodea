/**
 * Reminder notification polling loop.
 *
 * Lives in the reminder entity because it composes reminder lifecycle
 * (fire dispatch + missed/recurrence transitions) with notification dispatch.
 * A due reminder is NOT auto-completed — see the T-due branch. It reads two feature
 * configs (prealerts, language) but does not import from features/ —
 * instead it pulls from the underlying registries and storage helpers in
 * shared/i18n and feature model files. (Both directions are valid: this
 * file is one layer up, so importing from `features/*` is allowed.)
 *
 * Dedupe is stored in SQLite (the `reminder_fire_state` table), keyed
 * per-reminder, per-stage. It lived in WebView2 localStorage until S64 — moved
 * so a cleared webview cache can't lose dedupe and re-fire historically-due
 * prealerts. Any records left in the old localStorage keys are migrated into
 * SQLite once, on the first pass of a session (`migrateLocalFireStoreOnce`),
 * which also absorbs the even older v1 store (array of "fired due" ids).
 */

import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { invoke } from "@tauri-apps/api/core";
import { addRecurrenceInterval } from "@linodea/parser";
import type { ReminderNode } from "@linodea/types";

import { getStoredPrealerts, sortDescending } from "@/features/prealerts";

import {
  advanceReminderRecurrence,
  clearReminderFireRecordCommand,
  getReminderFireRecords,
  listReminderNodes,
  setReminderFireRecord,
  updateReminderNodeStatus,
  type FireRecord,
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

// Legacy localStorage keys, kept only for the one-time migration into SQLite.
const FIRES_STORAGE_KEY = "linodea.notifiedFires.v2";
const LEGACY_DUE_IDS_KEY = "linodea.notifiedDueReminderIds.v1";
const MS_PER_MINUTE = 60_000;
/**
 * Boundary between a *late-fire* and a *missed* reminder — the OS-sleep / app-off
 * catch-up policy.
 *
 * While the app runs, the precise timer / 15s backstop fires within ~15s of due,
 * so being overdue at all means we weren't watching when it came due (the app
 * was quit, or the machine was asleep so timers didn't tick). Two bands:
 *   - overdue by ≤ this window → *late-fire*: pop the alert now and auto-done as
 *     usual. The user just came back (relaunch / wake), so a slightly-late alert
 *     is still useful, not a silent completion. 15s ≪ this window, so a running
 *     app's on-time fires are never near the boundary.
 *   - overdue by > this window → `missed`: too stale to ambush the user with a
 *     surprise alert, so surface it (persistent, in the list) instead of firing.
 *
 * The window also bounds a wake burst: after a long sleep only the last few
 * minutes' worth of reminders late-fire; everything older is quietly `missed`.
 */
const LATE_FIRE_WINDOW_MS = 5 * MS_PER_MINUTE;

export type NotificationPermissionState = "unknown" | "granted" | "denied";

export interface DueNotificationResult {
  sentCount: number;
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

/** In-memory snapshot of the fire-dedupe store for one scheduler pass. */
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
 *   - fires the T-due toast (once) when due time has passed, leaving the
 *     reminder `pending` (acknowledge-to-complete — done only on the user's
 *     Done click; an unacknowledged fire stays pending + overdue, never `done`).
 */
export async function notifyDueReminders(): Promise<DueNotificationResult> {
  // The custom Linodea alert window does not depend on OS notification
  // permission (that gate is only relevant to the deferred app-off OS-toast
  // fallback), so we never block firing on it.
  const permissionGranted = await isPermissionGranted().catch(() => false);

  const reminders = await listReminderNodes();
  const actionable = reminders.filter(isActionable);
  const sortedOffsets = sortDescending(getStoredPrealerts().offsets);
  // Read once (IPC is proven up — listReminderNodes just succeeded). Mutations
  // this pass are collected and flushed after the walk, keyed per reminder, so
  // one failing write can't abort the rest of the pass.
  const store = await readFireStore();
  const changed = new Map<string, FireRecord>();
  const removed = new Set<string>();
  const now = Date.now();
  let sentCount = 0;
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

    // Came due while we weren't watching AND is now too stale to surprise-fire
    // (more than the late-fire window past due, never fired): mark it `missed`
    // instead of firing a stale alert and auto-doning it. Reminders overdue by
    // less than the window fall through and *late-fire* below. Recurring
    // reminders are left to roll forward on their own (existing fire+advance).
    if (!record.due && !reminder.recurrence && dueMs <= now - LATE_FIRE_WINDOW_MS) {
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
    // Only while the reminder is still upcoming: a prealert is a "get ready"
    // lead-up, so once the reminder is due/overdue its prealerts are obsolete —
    // the T-due handling below (late-fire or `missed`) takes over. This also
    // stops a wake burst from popping a pile of stale prealerts for reminders
    // whose due already passed during the sleep.
    if (dueMs > now) {
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
        changed.set(reminder.id, record);
        sentCount += 1;
      }
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
            removed.add(reminder.id);
            changed.delete(reminder.id);
            const nextMs = new Date(nextIso).getTime();
            if (Number.isFinite(nextMs)) nextFireMs = Math.min(nextFireMs, nextMs);
            continue;
          } catch {
            // Re-arm failed (offline DB, etc.) but the alert already fired.
            // Mark `due` so we don't spam; it stays pending in SQLite and a
            // later pass can recover.
            record.due = true;
            changed.set(reminder.id, record);
          }
        } else {
          // Acknowledge-to-complete: fire the alert but do NOT auto-mark the
          // reminder done. A reminder must never silently complete while the
          // user is away from the desk — it's marked done only when the user
          // clicks Done (on the alert window or in the list). `record.due = true`
          // blocks a re-fire, so an unacknowledged reminder just stays `pending`
          // and overdue; the list tags past-due pending rows "Overdue" so a fire
          // the user didn't catch stays visible instead of vanishing into `done`.
          record.due = true;
          changed.set(reminder.id, record);
        }
      } else {
        // Future due time — candidate for the next precise wake.
        nextFireMs = Math.min(nextFireMs, dueMs);
      }
    }
  }

  // Flush the pass's dedupe changes to SQLite. Rare in practice — only reminders
  // that actually fired this pass. Swallow per-write failures: a dropped write
  // just re-fires next pass, matching the pre-S64 best-effort localStorage write.
  for (const id of removed) {
    await clearReminderFireRecordCommand(id).catch(() => undefined);
  }
  for (const [id, record] of changed) {
    await setReminderFireRecord(id, record).catch(() => undefined);
  }

  return {
    sentCount,
    missedCount,
    newlyMissed,
    permissionGranted,
    nextFireMs: Number.isFinite(nextFireMs) ? nextFireMs : undefined,
  };
}

/**
 * The instant a reminder should actually fire. A snoozed reminder fires at its
 * `snoozedUntil`, not its original `scheduledAt`; everything else fires at
 * `scheduledAt`. Prealerts and the T-due fire both key off this.
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
 * snoozed or edited after it already fired (its `due`/prealert dedupe would
 * otherwise block the re-fire at the new time). Safe to call for never-fired
 * reminders (the DELETE is a no-op) and best-effort (swallows IPC errors).
 */
export async function clearReminderFireRecord(id: string): Promise<void> {
  await clearReminderFireRecordCommand(id).catch(() => undefined);
}

/** Set once the one-time localStorage→SQLite migration has run this session. */
let localFireStoreMigrated = false;

/** Read the fire-dedupe store from SQLite, migrating any legacy localStorage
 * records into it first. Returns an empty store if the read fails. */
async function readFireStore(): Promise<FireStore> {
  await migrateLocalFireStoreOnce();
  try {
    return await getReminderFireRecords();
  } catch {
    // Read failed (transient IPC/DB issue). Treat as empty — a later pass, or
    // the 15s backstop, retries. Callers only ever add records, never clobber.
    return {};
  }
}

/**
 * One-time move of any pre-S64 fire records still sitting in WebView2
 * localStorage into SQLite, then delete the old keys so it never runs again.
 * Idempotent: a fresh/migrated install reads nothing and just flips the flag.
 * If a write fails the flag stays false and localStorage is left intact, so a
 * later pass retries. Runs only after `listReminderNodes` proved IPC is up.
 */
async function migrateLocalFireStoreOnce(): Promise<void> {
  if (localFireStoreMigrated) return;
  try {
    for (const [id, record] of Object.entries(readLegacyLocalFireStore())) {
      await setReminderFireRecord(id, record);
    }
    localStorage.removeItem(FIRES_STORAGE_KEY);
    localStorage.removeItem(LEGACY_DUE_IDS_KEY);
    localFireStoreMigrated = true;
  } catch {
    // Leave the flag false and localStorage intact; retry on a later pass.
  }
}

/**
 * Parse any pre-S64 fire records out of localStorage: the v2 object store, or
 * the even older v1 array of "fired due" ids. Read-only — the caller removes
 * the keys after a successful SQLite import.
 */
function readLegacyLocalFireStore(): FireStore {
  try {
    const raw = localStorage.getItem(FIRES_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as FireStore;
      }
    }
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
        return migrated;
      }
    }
  } catch {
    // Ignore parse failures — nothing to migrate.
  }
  return {};
}
