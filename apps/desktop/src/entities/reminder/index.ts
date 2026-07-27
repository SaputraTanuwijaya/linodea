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
  setReminderTags,
  updateReminderNode,
  updateReminderNodeStatus,
  type AdvanceRecurrencePatch,
  type MovePatch,
  type ReminderTagsPatch,
  type ReminderEditPatch,
  type ReminderStatusPatch,
} from "./api/commands";
export {
  byScheduledAt,
  collectTagsInUse,
  createLinkedReminderNode,
  createReminderNode,
  groupChainsByTag,
  isActionable,
  primaryTag,
  UNTAGGED,
  type TagSection,
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
