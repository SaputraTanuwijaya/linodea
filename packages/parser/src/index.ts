import type {
  IanaTimezone,
  IsoDateTimeString,
  ParserIssue,
  ParsedReminderDraft,
  ReminderCategory,
  ReminderParseResult,
  ReminderType,
} from "@linodea/types";

export interface ParseReminderOptions {
  now?: Date | string;
  timezone?: IanaTimezone;
}

interface TextSegment {
  start: number;
  end: number;
}

interface DateTimeParse {
  scheduledAt?: IsoDateTimeString;
  segments: TextSegment[];
  issues: ParserIssue[];
  hasScheduledAt: boolean;
  hasDate: boolean;
  hasTime: boolean;
}

interface ChecklistParse {
  titleSource: string;
  checklist: string[];
}

interface TimeParts {
  hour: number;
  minute: number;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function normalizeReminderInput(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function parseReminder(
  rawInput: string,
  options: ParseReminderOptions = {},
): ReminderParseResult {
  return parseReminderWithNow(rawInput, {
    now: options.now ?? new Date(),
    timezone: options.timezone ?? getLocalTimezone(),
  });
}

export function parseReminderWithNow(
  rawInput: string,
  options: Required<ParseReminderOptions>,
): ReminderParseResult {
  const normalizedInput = normalizeReminderInput(rawInput);
  const now = coerceDate(options.now);
  const parsedAt = now.toISOString();
  const dateTime = parseDateTime(normalizedInput, now, options.timezone);
  const type = detectReminderType(normalizedInput);
  const typeSegments = findTypeSegments(normalizedInput);
  const textWithoutMeta = removeSegments(normalizedInput, [
    ...dateTime.segments,
    ...typeSegments,
  ]);
  const checklistParse = extractChecklist(textWithoutMeta);
  const title = cleanTitle(checklistParse.titleSource);
  const issues = [...dateTime.issues];
  const confidence = scoreConfidence({
    hasTitle: title.length > 0,
    hasScheduledAt: dateTime.hasScheduledAt,
    hasChecklist: checklistParse.checklist.length > 0,
    issueCount: issues.length,
  });

  if (confidence < 0.65) {
    issues.push({
      code: "low_confidence",
      message: "Parser confidence is low; ask the user to confirm the reminder.",
    });
  }

  const draft: ParsedReminderDraft = {
    title: title || "Reminder",
    scheduledAt: dateTime.scheduledAt,
    timezone: options.timezone,
    type,
    category: detectReminderCategory(normalizedInput),
    checklist: checklistParse.checklist,
    confidence,
  };

  return {
    rawInput,
    normalizedInput,
    parsedAt,
    draft,
    issues,
  };
}

function parseDateTime(
  input: string,
  now: Date,
  timezone: IanaTimezone,
): DateTimeParse {
  const relative = findRelativeTime(input);
  if (relative) {
    return {
      scheduledAt: new Date(now.getTime() + relative.minutes * 60_000).toISOString(),
      segments: [relative.segment],
      issues: [],
      hasScheduledAt: true,
      hasDate: true,
      hasTime: true,
    };
  }

  const date = findDateOffset(input);
  const time = findClockTime(input, date !== undefined);
  const segments = [
    ...(date ? [date.segment] : []),
    ...(time ? [time.segment] : []),
  ];

  if (date && time) {
    const baseDate = addDaysInTimezone(now, timezone, date.dayOffset);
    return {
      scheduledAt: localDateTimeToUtcIso(
        {
          year: baseDate.year,
          month: baseDate.month,
          day: baseDate.day,
          hour: time.parts.hour,
          minute: time.parts.minute,
          second: 0,
        },
        timezone,
      ),
      segments,
      issues: [],
      hasScheduledAt: true,
      hasDate: true,
      hasTime: true,
    };
  }

  if (time) {
    const scheduledAt = nextTimeOccurrence(now, timezone, time.parts);
    return {
      scheduledAt,
      segments,
      issues: [
        {
          code: "ambiguous_date",
          message: "No date was found; scheduled the next matching clock time.",
        },
      ],
      hasScheduledAt: true,
      hasDate: false,
      hasTime: true,
    };
  }

  if (date) {
    return {
      segments,
      issues: [
        {
          code: "missing_time",
          message: "A date was found, but no clock time was found.",
        },
      ],
      hasScheduledAt: false,
      hasDate: true,
      hasTime: false,
    };
  }

  return {
    segments,
    issues: [
      {
        code: "missing_time",
        message: "No reminder time was found.",
      },
    ],
    hasScheduledAt: false,
    hasDate: false,
    hasTime: false,
  };
}

function findRelativeTime(input: string):
  | { minutes: number; segment: TextSegment }
  | undefined {
  const patterns = [
    /\bin\s+(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i,
    /\b(\d{1,3})\s*(m|min|menit|h|jam)\s+lagi\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (!match || match.index === undefined) {
      continue;
    }

    return {
      minutes: toMinutes(Number(match[1]), match[2]),
      segment: { start: match.index, end: match.index + match[0].length },
    };
  }

  return undefined;
}

function findDateOffset(input: string):
  | { dayOffset: number; segment: TextSegment }
  | undefined {
  const patterns: Array<{ pattern: RegExp; dayOffset: number }> = [
    { pattern: /\b(today|hari ini)\b/i, dayOffset: 0 },
    { pattern: /\b(tomorrow|besok)\b/i, dayOffset: 1 },
    { pattern: /\blusa\b/i, dayOffset: 2 },
  ];

  for (const { pattern, dayOffset } of patterns) {
    const match = pattern.exec(input);
    if (!match || match.index === undefined) {
      continue;
    }

    return {
      dayOffset,
      segment: { start: match.index, end: match.index + match[0].length },
    };
  }

  return undefined;
}

function findClockTime(
  input: string,
  allowBareTime: boolean,
): { parts: TimeParts; segment: TextSegment } | undefined {
  const english = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(input);
  if (english?.index !== undefined) {
    return {
      parts: toTwelveHourTime(
        Number(english[1]),
        Number(english[2] ?? 0),
        english[3].toLowerCase(),
      ),
      segment: { start: english.index, end: english.index + english[0].length },
    };
  }

  const indonesian =
    /\bjam\s+(\d{1,2})(?::(\d{2}))?\s*(pagi|siang|sore|malam)?\b/i.exec(input);
  if (indonesian?.index !== undefined) {
    return {
      parts: toIndonesianTime(
        Number(indonesian[1]),
        Number(indonesian[2] ?? 0),
        indonesian[3]?.toLowerCase(),
      ),
      segment: {
        start: indonesian.index,
        end: indonesian.index + indonesian[0].length,
      },
    };
  }

  if (!allowBareTime) {
    return undefined;
  }

  const bare = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(input);
  if (!bare || bare.index === undefined) {
    return undefined;
  }

  return {
    parts: { hour: Number(bare[1]), minute: Number(bare[2]) },
    segment: { start: bare.index, end: bare.index + bare[0].length },
  };
}

function detectReminderType(input: string): ReminderType {
  const lower = input.toLowerCase();

  if (/\bh-\d+\b/.test(lower) || /\b(before|sebelum)\b/.test(lower)) {
    return "prep";
  }

  if (/\b(t\+\d+|follow[- ]?up|follow up|tindak lanjut)\b/.test(lower)) {
    return "followup";
  }

  if (/\b(deadline|due|batas akhir)\b/.test(lower)) {
    return "deadline";
  }

  if (/\b(cooldown|cool down|cool-off|cool off)\b/.test(lower)) {
    return "cooldown";
  }

  return "main";
}

function findTypeSegments(input: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const prefix = /\bh-\d+\b/i.exec(input);

  if (prefix?.index !== undefined) {
    segments.push({ start: prefix.index, end: prefix.index + prefix[0].length });
  }

  return segments;
}

function extractChecklist(input: string): ChecklistParse {
  const match =
    /\b(bring|bawa|prepare|siapin|open|buka)\b\s+(.+)$/i.exec(input);

  if (!match || match.index === undefined) {
    return { titleSource: input, checklist: [] };
  }

  const cue = match[1].toLowerCase();
  const rawItems = stripTimingTail(match[2]);
  const checklist = splitChecklistItems(rawItems, cue);

  return {
    titleSource: input.slice(0, match.index),
    checklist,
  };
}

function splitChecklistItems(rawItems: string, cue: string): string[] {
  const cleaned = rawItems
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return [];
  }

  if (/[,+]/.test(cleaned) || /\b(and|dan)\b/i.test(cleaned)) {
    return cleaned
      .split(/\s*(?:,|\+|\band\b|\bdan\b)\s*/i)
      .map(cleanChecklistItem)
      .filter(Boolean);
  }

  if (["bring", "bawa", "prepare", "siapin"].includes(cue)) {
    const words = cleaned.split(" ").map(cleanChecklistItem).filter(Boolean);
    return words.length <= 5 ? words : [cleaned];
  }

  return [cleaned];
}

function stripTimingTail(input: string): string {
  return input
    .replace(
      /\b\d{1,3}\s*(m|min|mins|minute|minutes|menit|h|hr|hrs|hour|hours|jam)\s*(before|sebelum)\b.*$/i,
      "",
    )
    .trim();
}

function cleanChecklistItem(input: string): string {
  return input.replace(/^[-:;]+|[-:;]+$/g, "").trim();
}

function cleanTitle(input: string): string {
  return input
    .replace(/[,:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectReminderCategory(input: string): ReminderCategory {
  const lower = input.toLowerCase();

  if (/\b(les|tutor|tutoring|privat)\b/.test(lower)) {
    return "tutoring";
  }

  if (/\b(lab|class|kelas|kuliah|campus|kampus|ktm|grading|rubric|slides)\b/.test(
    lower,
  )) {
    return "university";
  }

  if (/\b(cpi|fomc|earnings|crypto|saham|stock|invest|thesis)\b/.test(lower)) {
    return "investing";
  }

  if (/\b(urgent|asap|penting|darurat)\b/.test(lower)) {
    return "urgent";
  }

  if (/\b(waiting|menunggu|follow up|follow-up)\b/.test(lower)) {
    return "waiting";
  }

  if (/\b(personal|home|rumah|family|keluarga)\b/.test(lower)) {
    return "personal";
  }

  return "uncategorized";
}

function scoreConfidence(input: {
  hasTitle: boolean;
  hasScheduledAt: boolean;
  hasChecklist: boolean;
  issueCount: number;
}): number {
  let score = 0.5;

  if (input.hasTitle) {
    score += 0.15;
  }

  if (input.hasScheduledAt) {
    score += 0.25;
  }

  if (input.hasChecklist) {
    score += 0.05;
  }

  score -= input.issueCount * 0.1;
  return Math.max(0.1, Math.min(0.95, Number(score.toFixed(2))));
}

function removeSegments(input: string, segments: TextSegment[]): string {
  if (segments.length === 0) {
    return input;
  }

  const ordered = [...segments].sort((a, b) => b.start - a.start);
  let output = input;

  for (const segment of ordered) {
    output = `${output.slice(0, segment.start)} ${output.slice(segment.end)}`;
  }

  return output.replace(/\s+/g, " ").trim();
}

function toMinutes(amount: number, unit: string): number {
  return /^(h|hr|hrs|hour|hours|jam)$/i.test(unit) ? amount * 60 : amount;
}

function toTwelveHourTime(hour: number, minute: number, meridiem: string): TimeParts {
  const normalized = hour % 12;
  return {
    hour: meridiem === "pm" ? normalized + 12 : normalized,
    minute,
  };
}

function toIndonesianTime(
  hour: number,
  minute: number,
  marker?: string,
): TimeParts {
  if (marker === "pagi") {
    return { hour: hour === 12 ? 0 : hour, minute };
  }

  if (marker === "siang" || marker === "sore" || marker === "malam") {
    return { hour: hour < 12 ? hour + 12 : hour, minute };
  }

  return { hour, minute };
}

function nextTimeOccurrence(
  now: Date,
  timezone: IanaTimezone,
  time: TimeParts,
): IsoDateTimeString {
  const today = addDaysInTimezone(now, timezone, 0);
  const candidate = localDateTimeToUtcDate(
    { ...today, hour: time.hour, minute: time.minute, second: 0 },
    timezone,
  );

  if (candidate.getTime() > now.getTime()) {
    return candidate.toISOString();
  }

  const tomorrow = addDaysInTimezone(now, timezone, 1);
  return localDateTimeToUtcIso(
    { ...tomorrow, hour: time.hour, minute: time.minute, second: 0 },
    timezone,
  );
}

function addDaysInTimezone(
  date: Date,
  timezone: IanaTimezone,
  days: number,
): LocalDateParts {
  const parts = getLocalParts(date, timezone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

function localDateTimeToUtcIso(
  parts: LocalDateParts,
  timezone: IanaTimezone,
): IsoDateTimeString {
  return localDateTimeToUtcDate(parts, timezone).toISOString();
}

function localDateTimeToUtcDate(parts: LocalDateParts, timezone: IanaTimezone): Date {
  const utcGuess = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
  const firstOffset = getTimezoneOffsetMs(utcGuess, timezone);
  const firstPass = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = getTimezoneOffsetMs(firstPass, timezone);

  return new Date(utcGuess.getTime() - secondOffset);
}

function getTimezoneOffsetMs(date: Date, timezone: IanaTimezone): number {
  const parts = getLocalParts(date, timezone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return localAsUtc - date.getTime();
}

function getLocalParts(date: Date, timezone: IanaTimezone): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function coerceDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function getLocalTimezone(): IanaTimezone {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
