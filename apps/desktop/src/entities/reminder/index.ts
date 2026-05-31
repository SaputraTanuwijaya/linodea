/**
 * Public surface for the reminder entity.
 *
 * Today exposes the notification polling driver. The typed Tauri command
 * wrappers (`entities/reminder/api/commands.ts`) land in Phase 3.
 */

export {
  DUE_NOTIFICATION_POLL_INTERVAL_MS,
  enableReminderNotifications,
  getNotificationPermissionState,
  notifyDueReminders,
  type DueNotificationResult,
  type NotificationPermissionState,
} from "./lib/notifications";
