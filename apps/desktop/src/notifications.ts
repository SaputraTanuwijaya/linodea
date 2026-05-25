import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { ReminderNode } from "@linodea/types";

export const DUE_NOTIFICATION_POLL_INTERVAL_MS = 15_000;

const NOTIFIED_DUE_IDS_STORAGE_KEY = "linodea.notifiedDueReminderIds.v1";
const MAX_STORED_NOTIFIED_IDS = 500;

export type NotificationPermissionState = "unknown" | "granted" | "denied";

export interface DueNotificationResult {
  dueReminders: ReminderNode[];
  sentCount: number;
  permissionGranted: boolean;
}

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

export async function notifyDueReminders(): Promise<DueNotificationResult> {
  const dueReminders = await invoke<ReminderNode[]>("list_due_reminder_nodes", {
    now: new Date().toISOString(),
  });
  const permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    return { dueReminders, sentCount: 0, permissionGranted };
  }

  const notifiedDueIds = readNotifiedDueIds();
  let sentCount = 0;

  for (const reminder of dueReminders) {
    if (notifiedDueIds.has(reminder.id)) {
      continue;
    }

    sendNotification({
      title: "Linodea reminder",
      body: notificationBody(reminder),
    });
    notifiedDueIds.add(reminder.id);
    sentCount += 1;
  }

  writeNotifiedDueIds(notifiedDueIds);

  return { dueReminders, sentCount, permissionGranted };
}

function notificationBody(reminder: ReminderNode): string {
  const scheduledTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(reminder.scheduledAt));

  return `${reminder.title} - ${scheduledTime}`;
}

function readNotifiedDueIds(): Set<string> {
  try {
    const rawValue = localStorage.getItem(NOTIFIED_DUE_IDS_STORAGE_KEY);
    if (!rawValue) {
      return new Set();
    }

    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return new Set();
    }

    return new Set(
      parsedValue.filter((value): value is string => typeof value === "string"),
    );
  } catch {
    return new Set();
  }
}

function writeNotifiedDueIds(notifiedDueIds: Set<string>) {
  const prunedIds = Array.from(notifiedDueIds).slice(-MAX_STORED_NOTIFIED_IDS);
  localStorage.setItem(NOTIFIED_DUE_IDS_STORAGE_KEY, JSON.stringify(prunedIds));
}
