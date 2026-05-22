export declare const REMINDER_TYPES: readonly ["main", "prep", "followup", "deadline", "cooldown"];
export type ReminderType = (typeof REMINDER_TYPES)[number];
export declare const REMINDER_STATUSES: readonly ["pending", "done", "missed", "snoozed", "cancelled"];
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];
export declare const REMINDER_CATEGORIES: readonly ["university", "investing", "personal", "tutoring", "urgent", "waiting", "uncategorized"];
export type ReminderCategory = (typeof REMINDER_CATEGORIES)[number];
export declare const NOTIFICATION_MODES: readonly ["quiet", "balanced", "aggressive", "phone_first", "desktop_only"];
export type NotificationMode = (typeof NOTIFICATION_MODES)[number];
export declare const NOTIFICATION_ATTEMPT_STATUSES: readonly ["pending", "sent", "displayed", "acked", "dismissed", "canceled", "failed"];
export type NotificationAttemptStatus = (typeof NOTIFICATION_ATTEMPT_STATUSES)[number];
export type IsoDateTimeString = string;
export type IanaTimezone = string;
export type ReminderNodeId = string;
export type DeviceId = string;
export type ShortcutChord = string;
export interface ReminderNode {
    id: ReminderNodeId;
    userId?: string;
    title: string;
    rawInput: string;
    description?: string;
    scheduledAt: IsoDateTimeString;
    timezone: IanaTimezone;
    type: ReminderType;
    status: ReminderStatus;
    category: ReminderCategory;
    parentId?: ReminderNodeId;
    previousId?: ReminderNodeId;
    nextId?: ReminderNodeId;
    checklist: string[];
    confidence: number;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
    completedAt?: IsoDateTimeString;
    snoozedUntil?: IsoDateTimeString;
    createdOnDeviceId: DeviceId;
    syncVersion: number;
}
export type ReminderPatch = Partial<Pick<ReminderNode, "title" | "description" | "scheduledAt" | "timezone" | "type" | "status" | "category" | "parentId" | "previousId" | "nextId" | "checklist" | "confidence" | "completedAt" | "snoozedUntil">>;
export interface ParsedReminderDraft {
    title: string;
    scheduledAt?: IsoDateTimeString;
    timezone: IanaTimezone;
    type: ReminderType;
    category: ReminderCategory;
    checklist: string[];
    confidence: number;
}
export type ParserIssueCode = "missing_time" | "ambiguous_time" | "ambiguous_date" | "unsupported_phrase" | "low_confidence";
export interface ParserIssue {
    code: ParserIssueCode;
    message: string;
}
export interface ReminderParseResult {
    rawInput: string;
    normalizedInput: string;
    parsedAt: IsoDateTimeString;
    draft: ParsedReminderDraft;
    issues: ParserIssue[];
}
export interface ShortcutSettings {
    quickCapture: ShortcutChord;
    openMainApp?: ShortcutChord;
    shortcutsEnabled: boolean;
    disabledUntil?: IsoDateTimeString;
}
export interface StartupSettings {
    launchOnStartup: boolean;
    startMinimizedToTray: boolean;
}
export interface NotificationSettings {
    mode: NotificationMode;
    desktopEnabled: boolean;
    audioEnabled: boolean;
}
export interface AppSettings {
    schemaVersion: number;
    timezone: IanaTimezone;
    shortcuts: ShortcutSettings;
    startup: StartupSettings;
    notifications: NotificationSettings;
    createdOnDeviceId: DeviceId;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
}
export interface NotificationAttempt {
    id: string;
    reminderId: ReminderNodeId;
    stage: "prealert" | "due" | "fallback";
    status: NotificationAttemptStatus;
    dedupeKey: string;
    scheduledFor: IsoDateTimeString;
    attemptedAt?: IsoDateTimeString;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
}
export declare function isReminderType(value: unknown): value is ReminderType;
export declare function isReminderStatus(value: unknown): value is ReminderStatus;
export declare function isReminderCategory(value: unknown): value is ReminderCategory;
export declare function isNotificationMode(value: unknown): value is NotificationMode;
export declare function isNotificationAttemptStatus(value: unknown): value is NotificationAttemptStatus;
//# sourceMappingURL=index.d.ts.map