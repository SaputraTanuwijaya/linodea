/**
 * Public surface for the reminder entity.
 */

export {
  advanceReminderRecurrence,
  createReminderNodeCommand,
  deleteReminderNode,
  listReminderChains,
  listReminderNodes,
  moveReminderNode,
  updateReminderNode,
  updateReminderNodeStatus,
  type AdvanceRecurrencePatch,
  type MovePatch,
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
