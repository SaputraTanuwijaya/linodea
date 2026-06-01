export const REMINDER_TYPES = [
  "main",
  "prep",
  "followup",
  "deadline",
  "cooldown",
] as const;

export type ReminderType = (typeof REMINDER_TYPES)[number];

export const REMINDER_STATUSES = [
  "pending",
  "done",
  "missed",
  "snoozed",
  "cancelled",
] as const;

export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const REMINDER_CATEGORIES = [
  "university",
  "investing",
  "personal",
  "tutoring",
  "urgent",
  "waiting",
  "uncategorized",
] as const;

export type ReminderCategory = (typeof REMINDER_CATEGORIES)[number];

export const NOTIFICATION_MODES = [
  "quiet",
  "balanced",
  "aggressive",
  "phone_first",
  "desktop_only",
] as const;

export type NotificationMode = (typeof NOTIFICATION_MODES)[number];

export const NOTIFICATION_ATTEMPT_STATUSES = [
  "pending",
  "sent",
  "displayed",
  "acked",
  "dismissed",
  "canceled",
  "failed",
] as const;

export type NotificationAttemptStatus =
  (typeof NOTIFICATION_ATTEMPT_STATUSES)[number];

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
  recurrence?: Recurrence;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  completedAt?: IsoDateTimeString;
  snoozedUntil?: IsoDateTimeString;
  createdOnDeviceId: DeviceId;
  syncVersion: number;
}

/**
 * A reminder plus its ordered children, recursively — the assembled chain
 * forest the chain view renders. Mirrors the Rust `ChainNode` returned by
 * `list_reminder_chains`: roots and each child group are ordered by their
 * previous/next links.
 */
export interface ChainNode {
  node: ReminderNode;
  children: ChainNode[];
}

export type ReminderPatch = Partial<
  Pick<
    ReminderNode,
    | "title"
    | "description"
    | "scheduledAt"
    | "timezone"
    | "type"
    | "status"
    | "category"
    | "parentId"
    | "previousId"
    | "nextId"
    | "checklist"
    | "confidence"
    | "completedAt"
    | "snoozedUntil"
  >
>;

export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;

export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/**
 * A repeat rule for a recurring reminder. The parser derives it from natural
 * language ("every monday 8am", "tiap hari", "every 2 days ×5"); the scheduler
 * advances `scheduledAt` by the rule each time the reminder fires.
 */
export interface Recurrence {
  freq: RecurrenceFrequency;
  /** Repeat every `interval` units (>= 1). "every other" → 2. */
  interval: number;
  /** 0..6 (Sun..Sat) — set only for weekly-on-a-named-day ("every monday"). */
  weekday?: number;
  /**
   * Occurrences remaining, including the currently scheduled one. Omitted means
   * unbounded (repeats until the user deletes it). Decremented on each fire.
   */
  count?: number;
}

export interface ParsedReminderDraft {
  title: string;
  scheduledAt?: IsoDateTimeString;
  timezone: IanaTimezone;
  type: ReminderType;
  category: ReminderCategory;
  checklist: string[];
  confidence: number;
  recurrence?: Recurrence;
}

export type ParserIssueCode =
  | "missing_time"
  | "ambiguous_time"
  | "ambiguous_date"
  | "unsupported_phrase"
  | "low_confidence"
  | "autocorrect"
  | "ambiguous_token";

export interface ParserIssue {
  code: ParserIssueCode;
  message: string;
  /** Original token as typed by the user. Set for `autocorrect` and `ambiguous_token`. */
  original?: string;
  /** Canonical vocabulary word the parser matched. Set for `autocorrect`. */
  corrected?: string;
  /** Edit distance between original and corrected. Set for `autocorrect`. */
  distance?: number;
  /** Candidate corrections when ambiguous. Set for `ambiguous_token`. */
  candidates?: string[];
}

export interface ReminderParseResult {
  rawInput: string;
  normalizedInput: string;
  parsedAt: IsoDateTimeString;
  draft: ParsedReminderDraft;
  issues: ParserIssue[];
  /**
   * True when the input used the `/countdown` command (exact-second timing).
   * Surfaced so the capture UI can show the on-screen countdown timer window.
   */
  countdown?: boolean;
  /** Repeat rule, when the input described a recurring reminder. */
  recurrence?: Recurrence;
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

function isOneOf<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isReminderType(value: unknown): value is ReminderType {
  return isOneOf(REMINDER_TYPES, value);
}

export function isReminderStatus(value: unknown): value is ReminderStatus {
  return isOneOf(REMINDER_STATUSES, value);
}

export function isReminderCategory(value: unknown): value is ReminderCategory {
  return isOneOf(REMINDER_CATEGORIES, value);
}

export function isNotificationMode(value: unknown): value is NotificationMode {
  return isOneOf(NOTIFICATION_MODES, value);
}

export function isNotificationAttemptStatus(
  value: unknown,
): value is NotificationAttemptStatus {
  return isOneOf(NOTIFICATION_ATTEMPT_STATUSES, value);
}
