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

/**
 * Tags replaced the old closed `ReminderCategory` enum (university / investing /
 * personal / tutoring / urgent / waiting). That set was one person's life, not a
 * taxonomy: it had near-zero recall for anyone else, and it mixed two axes —
 * domains (university) with states (urgent, waiting) — so a reminder that was
 * both had to arbitrarily pick one. Tags are free text the user authors, so
 * there is nothing to guess and nothing to generalize.
 */

/** Max characters in one tag, after normalization. */
export const TAG_MAX_LENGTH = 24;

/** Max tags stored on one reminder. Keeps a row's tag strip readable. */
export const MAX_TAGS_PER_REMINDER = 5;

/**
 * Canonical form of a user-authored tag: lowercased, leading `#` stripped,
 * punctuation and spaces dropped (`-` and `_` survive), length-capped. Letters
 * are matched by Unicode class, not `a-z`, so Indonesian tags are first-class.
 *
 * Returns null when nothing usable is left, or when the result doesn't start
 * with a letter — `#2` in "buy #2 pencil" must stay part of the title rather
 * than become a tag named "2".
 */
export function normalizeTag(raw: string): string | null {
  const stripped = raw.trim().replace(/^#+/, "").toLowerCase();
  let kept = "";
  for (const char of stripped) {
    if (/[\p{L}\p{N}]/u.test(char) || char === "-" || char === "_") kept += char;
  }
  const tag = kept.slice(0, TAG_MAX_LENGTH).replace(/^[-_]+|[-_]+$/g, "");
  return tag && /^\p{L}/u.test(tag) ? tag : null;
}

/**
 * Normalize a list of tags: drop unusable ones, dedupe (first spelling wins),
 * and cap at `MAX_TAGS_PER_REMINDER`. Order is preserved, so `tags[0]` stays
 * the tag the user typed first — the chain view groups on it.
 */
export function normalizeTags(raw: readonly string[]): string[] {
  const tags = new Set<string>();
  for (const value of raw) {
    const tag = normalizeTag(value);
    if (tag) tags.add(tag);
    if (tags.size >= MAX_TAGS_PER_REMINDER) break;
  }
  return [...tags];
}

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
  /** Normalized, deduped, `#`-less. `tags[0]` is the chain view's grouping key. */
  tags: string[];
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
    | "tags"
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
  /** `#tag` tokens found in the input, normalized. Empty when none were typed. */
  tags: string[];
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

export function isNotificationMode(value: unknown): value is NotificationMode {
  return isOneOf(NOTIFICATION_MODES, value);
}

export function isNotificationAttemptStatus(
  value: unknown,
): value is NotificationAttemptStatus {
  return isOneOf(NOTIFICATION_ATTEMPT_STATUSES, value);
}
