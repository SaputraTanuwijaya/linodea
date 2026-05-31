/**
 * Public surface for the reminder entity.
 */

export {
  createReminderNodeCommand,
  deleteReminderNode,
  listReminderNodes,
  updateReminderNode,
  updateReminderNodeStatus,
  type ReminderEditPatch,
  type ReminderStatusPatch,
} from "./api/commands";
export {
  byScheduledAt,
  createReminderNode,
  isActionable,
} from "./model/reminder";
export {
  clearReminderFireRecord,
  enableReminderNotifications,
  getNotificationPermissionState,
  notifyDueReminders,
  type DueNotificationResult,
  type NotificationPermissionState,
} from "./lib/notifications";
export {
  startReminderNotificationScheduler,
  type ReminderNotificationScheduler,
} from "./lib/scheduler";
