/**
 * Public surface for the reminder entity.
 */

export {
  createReminderNodeCommand,
  listReminderNodes,
  updateReminderNodeStatus,
  type ReminderStatusPatch,
} from "./api/commands";
export {
  byScheduledAt,
  createReminderNode,
  isActionable,
} from "./model/reminder";
export {
  DUE_NOTIFICATION_POLL_INTERVAL_MS,
  enableReminderNotifications,
  getNotificationPermissionState,
  notifyDueReminders,
  type DueNotificationResult,
  type NotificationPermissionState,
} from "./lib/notifications";
