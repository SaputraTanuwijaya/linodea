export const REMINDER_TYPES = [
    "main",
    "prep",
    "followup",
    "deadline",
    "cooldown",
];
export const REMINDER_STATUSES = [
    "pending",
    "done",
    "missed",
    "snoozed",
    "cancelled",
];
export const REMINDER_CATEGORIES = [
    "university",
    "investing",
    "personal",
    "tutoring",
    "urgent",
    "waiting",
    "uncategorized",
];
export const NOTIFICATION_MODES = [
    "quiet",
    "balanced",
    "aggressive",
    "phone_first",
    "desktop_only",
];
export const NOTIFICATION_ATTEMPT_STATUSES = [
    "pending",
    "sent",
    "displayed",
    "acked",
    "dismissed",
    "canceled",
    "failed",
];
function isOneOf(values, value) {
    return typeof value === "string" && values.includes(value);
}
export function isReminderType(value) {
    return isOneOf(REMINDER_TYPES, value);
}
export function isReminderStatus(value) {
    return isOneOf(REMINDER_STATUSES, value);
}
export function isReminderCategory(value) {
    return isOneOf(REMINDER_CATEGORIES, value);
}
export function isNotificationMode(value) {
    return isOneOf(NOTIFICATION_MODES, value);
}
export function isNotificationAttemptStatus(value) {
    return isOneOf(NOTIFICATION_ATTEMPT_STATUSES, value);
}
//# sourceMappingURL=index.js.map