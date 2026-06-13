import type {
  IanaTimezone,
  IsoDateTimeString,
  ParserIssue,
  ParsedReminderDraft,
  Recurrence,
  ReminderCategory,
  ReminderParseResult,
  ReminderType,
} from "@linodea/types";
import {
  CATEGORY_INVESTING,
  CATEGORY_PERSONAL,
  CATEGORY_TUTORING,
  CATEGORY_UNIVERSITY,
  CATEGORY_URGENT,
  CATEGORY_WAITING,
  CHECKLIST_CONJUNCTIONS,
  CHECKLIST_CUES,
  DATE_WORDS,
  ID_TIME_MARKERS,
  NUMBER_WORDS,
  numberWordValue,
  TYPE_COOLDOWN_WORDS,
  TYPE_DEADLINE_WORDS,
  TYPE_FOLLOWUP_WORDS,
  TYPE_PREP_WORDS,
  wordsOf,
  type LangTag,
  type VocabularyEntry,
} from "./vocabularies.js";
import { findFuzzyTokenMatch, fuzzyMatch, tokenize } from "./fuzzy.js";

/**
 * Short-vocabulary fuzzy guard: cap edit distance at 1 regardless of word
 * length. The default threshold allows distance 2 on words >4 chars, which is
 * too permissive for short, false-match-prone vocabularies (time markers,
 * conjunctions) where real words sit within distance 2 of a keyword. Distance
 * 1 catches the common single-error typos (`pagy→pagi`, `dna→dan`) while
 * keeping precision high.
 */
const distanceOneOnly = () => 1;

export type { LangTag, VocabularyEntry } from "./vocabularies.js";

/**
 * Optional language hint for the parser. When set to "en" or "id", an
 * otherwise-ambiguous fuzzy match (e.g., a typo that fits both an English
 * and an Indonesian vocabulary entry at the same edit distance) resolves
 * toward the preferred language if exactly one candidate matches. "auto"
 * (the default) preserves the historical behavior: ties stay ambiguous.
 *
 * Important: this is a TIE-BREAKER, not a mode switch. Linodea remains
 * bilingual-first — preferred-language inputs still parse fully regardless
 * of the user's preference (e.g., `tomorrow jam 8` works in either mode).
 */
export type PreferredLanguage = LangTag | "auto";

export interface ParseReminderOptions {
  now?: Date | string;
  timezone?: IanaTimezone;
  preferredLanguage?: PreferredLanguage;
}

/**
 * Resolve a fuzzy-ambiguous result toward a preferred language. Returns the
 * single matching vocabulary entry if exactly one candidate has the
 * preferred language tag, otherwise null (leave the ambiguity surfaced).
 */
export function resolveByLanguage<T extends VocabularyEntry>(
  candidates: readonly string[],
  vocabulary: readonly T[],
  preferredLanguage: PreferredLanguage | undefined,
): T | null {
  if (!preferredLanguage || preferredLanguage === "auto") return null;
  const matching = candidates
    .map((word) => vocabulary.find((entry) => entry.word === word))
    .filter(
      (entry): entry is T =>
        entry !== undefined && entry.lang === preferredLanguage,
    );
  return matching.length === 1 ? matching[0] : null;
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
  recurrence?: Recurrence;
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

/**
 * Bare name of the exact-second timing command, without the leading slash.
 * Single source of truth shared with the desktop app's slash-command registry
 * (`features/slash-commands`) so the parser and UI can't drift on the name.
 */
export const COUNTDOWN_COMMAND_NAME = "countdown";

/**
 * Opt-in exact-second timing keyword. By default relative reminders snap to the
 * minute (:00); `/countdown` keeps the exact instant (typed at :47 → fires at
 * :47). Detected case-insensitively as a standalone token and stripped from the
 * text so it never lands in the title or checklist.
 */
const COUNTDOWN_PATTERN = new RegExp(
  `(?:^|\\s)\\/${COUNTDOWN_COMMAND_NAME}(?=\\s|$)`,
  "i",
);

function roundToMinute(ms: number): number {
  return Math.round(ms / 60_000) * 60_000;
}

export function parseReminder(
  rawInput: string,
  options: ParseReminderOptions = {},
): ReminderParseResult {
  return parseReminderWithNow(rawInput, {
    now: options.now ?? new Date(),
    timezone: options.timezone ?? getLocalTimezone(),
    preferredLanguage: options.preferredLanguage ?? "auto",
  });
}

export function parseReminderWithNow(
  rawInput: string,
  options: Required<ParseReminderOptions>,
): ReminderParseResult {
  const rawNormalized = normalizeReminderInput(rawInput);
  // Pull the `/countdown` keyword out before any other parsing so it can't
  // pollute the title; remember it to skip minute-snapping below.
  const countdown = COUNTDOWN_PATTERN.test(rawNormalized);
  const normalizedInput = countdown
    ? normalizeReminderInput(rawNormalized.replace(COUNTDOWN_PATTERN, " "))
    : rawNormalized;
  const now = coerceDate(options.now);
  const parsedAt = now.toISOString();
  const dateTime = parseDateTime(
    normalizedInput,
    now,
    options.timezone,
    options.preferredLanguage,
    countdown,
  );
  const typeFinding = detectReminderType(normalizedInput, options.preferredLanguage);
  const categoryFinding = detectReminderCategory(
    normalizedInput,
    options.preferredLanguage,
  );
  const typeSegments = findTypeSegments(normalizedInput);
  const textWithoutMeta = removeSegments(normalizedInput, [
    ...dateTime.segments,
    ...typeSegments,
  ]);
  const checklistParse = extractChecklist(textWithoutMeta, options.preferredLanguage);
  const title = cleanTitle(checklistParse.titleSource);

  const issues: ParserIssue[] = [...dateTime.issues];
  if (typeFinding.issue) issues.push(typeFinding.issue);
  if (categoryFinding.issue) issues.push(categoryFinding.issue);
  issues.push(...checklistParse.issues);

  // Autocorrects shouldn't tank confidence as hard as real parse failures.
  // Count them separately at 0.5x weight in the confidence score.
  const autocorrectCount = issues.filter((i) => i.code === "autocorrect").length;
  const hardIssueCount = issues.length - autocorrectCount;

  const confidence = scoreConfidence({
    hasTitle: title.length > 0,
    hasScheduledAt: dateTime.hasScheduledAt,
    hasChecklist: checklistParse.checklist.length > 0,
    issueCount: hardIssueCount + autocorrectCount * 0.5,
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
    type: typeFinding.type,
    category: categoryFinding.category,
    checklist: checklistParse.checklist,
    confidence,
    recurrence: dateTime.recurrence,
  };

  return {
    rawInput,
    normalizedInput,
    parsedAt,
    draft,
    issues,
    countdown,
    recurrence: dateTime.recurrence,
  };
}

/** Direction a linked reminder sits relative to its anchor in time. */
export type LinkDirection = "before" | "after";

export interface ParseAnchorLinkOptions {
  /** ISO instant of the anchor reminder this one links to. */
  anchor: IsoDateTimeString;
  timezone?: IanaTimezone;
  /** Direction to assume when the text says neither before nor after. */
  defaultDirection?: LinkDirection;
}

export interface AnchorLinkResult {
  title: string;
  scheduledAt: IsoDateTimeString;
  /** Resolved direction (explicit word, else comparison, else the default). */
  direction: LinkDirection;
  /** Derived role: before → prep, after → followup. Position is the source of
   *  truth; the chain view shows it by placement, not a stored tag. */
  role: "prep" | "followup";
  /** How the time was expressed: a relative offset vs an absolute clock time. */
  kind: "offset" | "absolute";
  /** Present for `kind: "offset"`. Signed is implied by `direction`. */
  offsetMs?: number;
  issues: ParserIssue[];
}

const LINK_BEFORE_WORDS = /\b(before|sebelum)\b/i;
const LINK_AFTER_WORDS = /\b(after|setelah|sesudah)\b/i;

/**
 * Parse the message of a `/link`-ed reminder, resolving its time **relative to
 * the anchor** rather than to now.
 *
 * - `30m before` / `1 jam after` → anchor ∓ offset (sign from the direction
 *   word, else `defaultDirection`).
 * - an absolute clock time (`jam 9`, `8am`, `19:00`) → that time on the
 *   anchor's local date; the direction is then derived by comparison.
 *
 * The parser stays anchor-agnostic everywhere else; this is the single entry the
 * capture layer calls once an anchor has been picked. Role is derived from the
 * final direction so it can never contradict the scheduled time.
 */
export function parseAnchorLink(
  rawInput: string,
  options: ParseAnchorLinkOptions,
): AnchorLinkResult {
  const timezone = options.timezone ?? getLocalTimezone();
  const normalized = normalizeReminderInput(rawInput);
  const anchorDate = coerceDate(options.anchor);
  const anchorParts = getLocalParts(anchorDate, timezone);

  let direction: LinkDirection = options.defaultDirection ?? "before";
  if (LINK_AFTER_WORDS.test(normalized)) direction = "after";
  else if (LINK_BEFORE_WORDS.test(normalized)) direction = "before";

  const issues: ParserIssue[] = [];
  const segments: TextSegment[] = [];

  let scheduledAt: IsoDateTimeString;
  let kind: "offset" | "absolute";
  let offsetMs: number | undefined;

  const time = findClockTime(normalized);
  if (time) {
    kind = "absolute";
    scheduledAt = localDateTimeToUtcIso(
      {
        year: anchorParts.year,
        month: anchorParts.month,
        day: anchorParts.day,
        hour: time.parts.hour,
        minute: time.parts.minute,
        second: 0,
      },
      timezone,
    );
    segments.push(time.segment);
    if (time.issue) issues.push(time.issue);
    // An explicit clock time wins over a direction word — derive direction from
    // where it actually lands.
    direction =
      coerceDate(scheduledAt).getTime() < anchorDate.getTime() ? "before" : "after";
  } else {
    const relative = findRelativeTime(normalized);
    if (relative) {
      kind = "offset";
      offsetMs = relative.ms;
      const sign = direction === "before" ? -1 : 1;
      scheduledAt = new Date(anchorDate.getTime() + sign * relative.ms).toISOString();
      segments.push(relative.segment);
    } else {
      // No time at all — sit it at the anchor's instant and flag it, rather than
      // refusing to link.
      kind = "offset";
      offsetMs = 0;
      scheduledAt = anchorDate.toISOString();
      issues.push({
        code: "missing_time",
        message: "No offset or time found; linked at the anchor's time.",
      });
    }
  }

  const titleSource = removeSegments(normalized, segments)
    .replace(LINK_BEFORE_WORDS, " ")
    .replace(LINK_AFTER_WORDS, " ");
  const title = cleanTitle(titleSource) || "Reminder";

  return {
    title,
    scheduledAt,
    direction,
    role: direction === "before" ? "prep" : "followup",
    kind,
    offsetMs,
    issues,
  };
}

function parseDateTime(
  input: string,
  now: Date,
  timezone: IanaTimezone,
  preferredLanguage: PreferredLanguage,
  countdown: boolean,
): DateTimeParse {
  // Recurrence is checked before relative time: `every 2 days` would otherwise
  // be claimed by the bare-relative matcher (`2 days`) as a one-off. Recurrence
  // always needs an explicit cadence keyword, so one-off `in 2 days` is safe.
  const recurrenceFinding = findRecurrence(input);
  if (recurrenceFinding) {
    const time = findClockTime(input);
    const timeIssues: ParserIssue[] = time?.issue ? [time.issue] : [];
    const segments = [
      ...recurrenceFinding.segments,
      ...(time ? [time.segment] : []),
    ];

    // A recurring reminder needs a clock-time anchor; without one we can't
    // schedule it (same rule as a date with no time).
    if (!time) {
      return {
        segments,
        issues: [
          ...timeIssues,
          {
            code: "missing_time",
            message: "A repeat was found, but no clock time was found.",
          },
        ],
        hasScheduledAt: false,
        hasDate: false,
        hasTime: false,
        recurrence: recurrenceFinding.recurrence,
      };
    }

    return {
      scheduledAt: firstRecurrenceOccurrence(
        now,
        timezone,
        recurrenceFinding.recurrence,
        time.parts,
      ),
      segments,
      issues: timeIssues,
      hasScheduledAt: true,
      hasDate: true,
      hasTime: true,
      recurrence: recurrenceFinding.recurrence,
    };
  }

  const relative = findRelativeTime(input);
  if (relative) {
    const clock = relative.days !== undefined ? findClockTime(input) : undefined;
    if (clock && relative.days !== undefined) {
      const baseDate = addDaysInTimezone(now, timezone, relative.days);
      const connector = findRelativeClockConnector(
        input,
        relative.segment.end,
        clock.segment.start,
      );
      return {
        scheduledAt: localDateTimeToUtcIso(
          {
            year: baseDate.year,
            month: baseDate.month,
            day: baseDate.day,
            hour: clock.parts.hour,
            minute: clock.parts.minute,
            second: 0,
          },
          timezone,
        ),
        segments: [
          relative.segment,
          ...(connector ? [connector] : []),
          clock.segment,
        ],
        issues: clock.issue ? [clock.issue] : [],
        hasScheduledAt: true,
        hasDate: true,
        hasTime: true,
      };
    }

    // Default: snap to the nearest minute (:00) so firing is clean and
    // predictable. `/countdown` keeps the exact instant for precise timers, and
    // sub-minute durations always keep it too (snapping 30s to :00 is nonsense).
    const target = now.getTime() + relative.ms;
    const keepExact = countdown || relative.ms < 60_000;
    const scheduledMs = keepExact ? target : roundToMinute(target);
    return {
      scheduledAt: new Date(scheduledMs).toISOString(),
      segments: [relative.segment],
      issues: [],
      hasScheduledAt: true,
      hasDate: true,
      hasTime: true,
    };
  }

  const dateFinding = findDateOffset(input, preferredLanguage);
  const dateMatch = dateFinding?.match;
  const dateIssues: ParserIssue[] = dateFinding?.issue ? [dateFinding.issue] : [];
  const time = findClockTime(input);
  const timeIssues: ParserIssue[] = time?.issue ? [time.issue] : [];
  const segments = [
    ...(dateMatch ? [dateMatch.segment] : []),
    ...(time ? [time.segment] : []),
  ];

  if (dateMatch && time) {
    const baseDate = addDaysInTimezone(now, timezone, dateMatch.dayOffset);
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
      issues: [...dateIssues, ...timeIssues],
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
        ...dateIssues,
        ...timeIssues,
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

  if (dateMatch) {
    return {
      segments,
      issues: [
        ...dateIssues,
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
      ...dateIssues,
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

/**
 * Relative-duration units (EN + ID), longest spelling first so the alternation
 * prefers `minutes` over a bare `m`, etc. The trailing `\b` in the pattern is
 * the false-positive guard: `run 5 miles` / `buy 2 apples` don't match because
 * the unit token isn't followed by a word boundary.
 */
const RELATIVE_UNITS =
  "seconds|second|secs|sec|detik|dtk|s|minutes|minute|mins|min|menit|m|hours|hour|hrs|hr|jam|h|days|day|hari|d";

/**
 * Regex alternation of every spelled-out number word, longest spelling first so
 * `dua belas` (12) wins over a bare `dua` (2) and `seventeen` over `seven`.
 * Used in the amount slots alongside `\d{1,3}` (see `AMOUNT`). The words are
 * plain letters/spaces — no regex metacharacters to escape.
 */
const NUMBER_WORD_ALTERNATION = NUMBER_WORDS.map((entry) => entry.word)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** A number slot: bare digits or a spelled-out number word. */
const AMOUNT = `\\d{1,3}|${NUMBER_WORD_ALTERNATION}`;

/**
 * Resolve a captured amount token (digits or a spelled number word) to an
 * integer. Returns NaN for anything unrecognized so callers can guard.
 */
function amountToNumber(token: string): number {
  if (/^\d+$/.test(token)) return Number(token);
  return numberWordValue(token) ?? Number.NaN;
}

/**
 * The Indonesian `se-` prefix fused onto a unit means "one of" it: `sejam` = 1
 * hour, `sehari` = 1 day, `semenit`/`sedetik` = 1 minute/second. Only the units
 * the relative matcher supports are listed (weeks/months aren't relative units).
 * Distinct words that merely start with `se` — `sepuluh` (10), `sebelas` (11),
 * `sembilan` (9) — don't match because the unit list is enumerated explicitly.
 */
const SE_PREFIX_UNITS = "detik|menit|jam|hari";

/**
 * Match a relative duration. The `in` prefix (EN) and `lagi` suffix (ID) are
 * both optional, so `in 2 minutes`, `2 minutes lagi`, `5m`, `30 detik`, and
 * `in 3 days` all parse. Spelled numbers work too (`in three days`,
 * `tiga hari lagi`), plus the ID `se-` idiom (`sejam lagi`) and English
 * `in a/an <unit>` (`in a minute`, `in an hour`). Returns the duration in
 * milliseconds so sub-minute values (seconds) survive. When several forms could
 * match, the earliest in the text wins (deterministic, matches reading order).
 */
function findRelativeTime(input: string):
  | { ms: number; days?: number; segment: TextSegment }
  | undefined {
  const candidates: Array<{ ms: number; days?: number; segment: TextSegment }> = [];

  // Primary: digits or a spelled number word, then a unit.
  const main = new RegExp(
    `\\b(?:in\\s+)?(${AMOUNT})\\s*(${RELATIVE_UNITS})\\b(?:\\s+lagi)?`,
    "i",
  ).exec(input);
  if (main?.index !== undefined) {
    const amount = amountToNumber(main[1]);
    if (!Number.isNaN(amount)) {
      candidates.push({
        ms: relativeUnitToMs(amount, main[2]),
        days: isDayUnit(main[2]) ? amount : undefined,
        segment: { start: main.index, end: main.index + main[0].length },
      });
    }
  }

  // ID `se-` fused prefix: `sejam lagi`, `in sehari` → amount 1.
  const se = new RegExp(
    `\\b(?:in\\s+)?se(${SE_PREFIX_UNITS})\\b(?:\\s+lagi)?`,
    "i",
  ).exec(input);
  if (se?.index !== undefined) {
    candidates.push({
      ms: relativeUnitToMs(1, se[1]),
      days: isDayUnit(se[1]) ? 1 : undefined,
      segment: { start: se.index, end: se.index + se[0].length },
    });
  }

  // English `a`/`an` → 1, but only behind an explicit `in` (bare `a day` is far
  // too common in titles to treat as a duration).
  const article = new RegExp(`\\bin\\s+an?\\s+(${RELATIVE_UNITS})\\b`, "i").exec(
    input,
  );
  if (article?.index !== undefined) {
    candidates.push({
      ms: relativeUnitToMs(1, article[1]),
      days: isDayUnit(article[1]) ? 1 : undefined,
      segment: { start: article.index, end: article.index + article[0].length },
    });
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => a.segment.start - b.segment.start);
  return candidates[0];
}

function isDayUnit(unit: string): boolean {
  return ["d", "day", "days", "hari"].includes(unit.toLowerCase());
}

function findRelativeClockConnector(
  input: string,
  start: number,
  end: number,
): TextSegment | undefined {
  if (end <= start) return undefined;
  return /^\s*(?:at|pukul)\s*$/i.test(input.slice(start, end))
    ? { start, end }
    : undefined;
}

/** Weekday name → index (0 = Sunday). EN full + 3-letter; ID full. */
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0, minggu: 0,
  monday: 1, mon: 1, senin: 1,
  tuesday: 2, tue: 2, tues: 2, selasa: 2,
  wednesday: 3, wed: 3, rabu: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, kamis: 4,
  friday: 5, fri: 5, jumat: 5, "jum'at": 5,
  saturday: 6, sat: 6, sabtu: 6,
};

const UNIT_TO_FREQ: Record<string, Recurrence["freq"]> = {
  day: "daily", days: "daily", hari: "daily",
  week: "weekly", weeks: "weekly", minggu: "weekly",
  month: "monthly", months: "monthly", bulan: "monthly",
};

/**
 * Detect a recurrence rule (cadence + optional repeat count). Requires an
 * explicit cadence keyword (`every`/`each`/`daily`/`weekly`/`monthly` or
 * `tiap`/`setiap`), so one-off relative phrases (`in 2 days`) are never caught.
 * Returns the rule plus the text segments to strip from the title.
 */
function findRecurrence(
  input: string,
): { recurrence: Recurrence; segments: TextSegment[] } | undefined {
  const base = matchCadence(input);
  if (!base) return undefined;

  const segments = [base.segment];
  const count = findCount(input);
  if (count) {
    segments.push(count.segment);
  }

  return {
    recurrence: { ...base.recurrence, ...(count ? { count: count.value } : {}) },
    segments,
  };
}

/** Match just the cadence (frequency + interval + optional weekday). */
function matchCadence(
  input: string,
): { recurrence: Recurrence; segment: TextSegment } | undefined {
  const make = (
    match: RegExpExecArray,
    recurrence: Recurrence,
  ): { recurrence: Recurrence; segment: TextSegment } => ({
    recurrence,
    segment: { start: match.index, end: match.index + match[0].length },
  });

  // Interval forms first (they carry a number): "every 2 weeks", "tiap 3 hari",
  // "every two weeks", "tiap dua minggu".
  const interval = new RegExp(
    `\\b(?:every|each|tiap|setiap)\\s+(${AMOUNT})\\s+(days?|weeks?|months?|hari|minggu|bulan)\\b`,
    "i",
  ).exec(input);
  if (interval?.index !== undefined) {
    const value = amountToNumber(interval[1]);
    if (!Number.isNaN(value)) {
      return make(interval, {
        freq: UNIT_TO_FREQ[interval[2].toLowerCase()],
        interval: Math.max(1, value),
      });
    }
  }

  // "every other week/day/month" → interval 2.
  const other = /\b(?:every|each)\s+other\s+(day|week|month)\b/i.exec(input);
  if (other?.index !== undefined) {
    return make(other, { freq: UNIT_TO_FREQ[other[1].toLowerCase()], interval: 2 });
  }

  // Weekday-specific: "every monday", "tiap hari senin", "setiap minggu" stays
  // weekly (handled below) — only `hari <day>` or a non-"minggu" day name here.
  const weekday =
    /\b(?:every|each)\s+([a-z]+)\b/i.exec(input) ??
    /\b(?:tiap|setiap)\s+hari\s+([a-z']+)\b/i.exec(input) ??
    /\b(?:tiap|setiap)\s+(senin|selasa|rabu|kamis|jumat|sabtu)\b/i.exec(input);
  if (weekday?.index !== undefined) {
    const day = WEEKDAY_INDEX[weekday[1].toLowerCase()];
    if (day !== undefined) {
      return make(weekday, { freq: "weekly", interval: 1, weekday: day });
    }
  }

  // Plain frequency words.
  const daily = /\b(?:every\s+day|each\s+day|daily|(?:tiap|setiap)\s+hari)\b/i.exec(input);
  if (daily?.index !== undefined) {
    return make(daily, { freq: "daily", interval: 1 });
  }

  const weekly = /\b(?:every\s+week|weekly|(?:tiap|setiap)\s+minggu)\b/i.exec(input);
  if (weekly?.index !== undefined) {
    return make(weekly, { freq: "weekly", interval: 1 });
  }

  const monthly = /\b(?:every\s+month|monthly|(?:tiap|setiap)\s+bulan)\b/i.exec(input);
  if (monthly?.index !== undefined) {
    return make(monthly, { freq: "monthly", interval: 1 });
  }

  return undefined;
}

/**
 * Match a repeat count: `×5`, `x5`, `5 times`, `5 kali`, `sebanyak 5 kali`, and
 * the spelled forms `three times` / `sebanyak tiga kali`. The `×`/`x` glyph
 * forms stay digit-only (nobody writes `×three`).
 */
function findCount(input: string): { value: number; segment: TextSegment } | undefined {
  const patterns = [
    new RegExp(`\\bsebanyak\\s+(${AMOUNT})\\s+kali\\b`, "i"),
    new RegExp(`\\b(${AMOUNT})\\s*(?:times|kali)\\b`, "i"),
    /(?:^|\s)[×x]\s*(\d{1,3})\b/i,
    /\b(\d{1,3})\s*[×x]\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (match?.index !== undefined) {
      const value = amountToNumber(match[1]);
      if (value >= 1) {
        return {
          value,
          segment: { start: match.index, end: match.index + match[0].length },
        };
      }
    }
  }
  return undefined;
}

/**
 * Result shape for the fuzzy-aware finders: optional `match` for the schedulable
 * data, optional `issue` for autocorrect/ambiguous notes. `undefined` overall
 * means nothing was found at all (clean miss, no signal).
 */
interface DateOffsetFinding {
  match?: { dayOffset: number; segment: TextSegment };
  issue?: ParserIssue;
}

function findDateOffset(
  input: string,
  preferredLanguage: PreferredLanguage,
): DateOffsetFinding | undefined {
  // Exact match first — keeps behavior identical for clean input.
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
      match: {
        dayOffset,
        segment: { start: match.index, end: match.index + match[0].length },
      },
    };
  }

  // Fuzzy fallback — catches typos like `besko`, `tomrorow`, `hri ini`.
  const fuzzy = findFuzzyTokenMatch(input, wordsOf(DATE_WORDS));
  if (!fuzzy) return undefined;

  if ("ambiguous" in fuzzy) {
    // Try language bias before surfacing ambiguity.
    const biased = resolveByLanguage(
      fuzzy.ambiguous.candidates,
      DATE_WORDS,
      preferredLanguage,
    );
    if (biased) {
      return {
        match: {
          dayOffset: biased.dayOffset,
          segment: { start: fuzzy.start, end: fuzzy.end },
        },
        issue: makeAutocorrectIssue(
          fuzzy.original,
          biased.word,
          fuzzy.ambiguous.distance,
          "date word",
        ),
      };
    }
    // Surface the ambiguity but don't pick a winner. The token stays in the
    // input (no segment removal) and no scheduling happens off it.
    return {
      issue: makeAmbiguousIssue(fuzzy.original, fuzzy.ambiguous.candidates, "date word"),
    };
  }

  const entry = DATE_WORDS.find((e) => e.word === fuzzy.result.matched);
  if (!entry) return undefined;

  return {
    match: {
      dayOffset: entry.dayOffset,
      segment: { start: fuzzy.start, end: fuzzy.end },
    },
    issue: makeAutocorrectIssue(
      fuzzy.original,
      fuzzy.result.matched,
      fuzzy.result.distance,
      "date word",
    ),
  };
}

function makeAutocorrectIssue(
  original: string,
  corrected: string,
  distance: number,
  kind: string,
): ParserIssue {
  return {
    code: "autocorrect",
    message: `Interpreted "${original}" as "${corrected}" (${kind} typo, distance ${distance}).`,
    original,
    corrected,
    distance,
  };
}

function makeAmbiguousIssue(
  original: string,
  candidates: string[],
  kind: string,
): ParserIssue {
  const list = candidates.map((c) => `"${c}"`).join(" or ");
  return {
    code: "ambiguous_token",
    message: `"${original}" could be ${list} (${kind}); not autocorrected.`,
    original,
    candidates,
  };
}

function findClockTime(
  input: string,
): { parts: TimeParts; segment: TextSegment; issue?: ParserIssue } | undefined {
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
    let marker = indonesian[3]?.toLowerCase();
    let end = indonesian.index + indonesian[0].length;
    let issue: ParserIssue | undefined;

    // Exact marker absent — try a fuzzy match on the token directly after the
    // time (adjacency mirrors the exact regex; we never scan deeper into the
    // sentence, which would let title words like "store" alias onto "sore").
    if (!marker) {
      const trailing = findTrailingMarker(input, end);
      if (trailing) {
        marker = trailing.marker;
        end = trailing.end;
        issue = trailing.issue;
      }
    }

    return {
      parts: toIndonesianTime(
        Number(indonesian[1]),
        Number(indonesian[2] ?? 0),
        marker,
      ),
      segment: { start: indonesian.index, end },
      issue,
    };
  }

  // Bare 24-hour time (`19:00`) — recognized with or without a date word. The
  // pattern is strict (`16:9`, `2:5`, `16:90` don't match), so the false-match
  // risk is low. Time-only resolves to today, or tomorrow if already past.
  const bare = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(input);
  if (!bare || bare.index === undefined) {
    return undefined;
  }

  return {
    parts: { hour: Number(bare[1]), minute: Number(bare[2]) },
    segment: { start: bare.index, end: bare.index + bare[0].length },
  };
}

/**
 * Fuzzy-match the single token immediately following a `jam N` time against the
 * Indonesian time markers (`pagi/siang/sore/malam`). Returns the canonical
 * marker plus the segment end (so the typo'd marker is stripped from the title)
 * and an autocorrect issue. Distance is capped at 1 for precision — see
 * `distanceOneOnly`.
 */
function findTrailingMarker(
  input: string,
  fromIndex: number,
): { marker: string; end: number; issue: ParserIssue } | undefined {
  const tail = input.slice(fromIndex);
  const token = /^\s*(\p{L}+)/u.exec(tail);
  if (!token) return undefined;

  const word = token[1];
  const match = fuzzyMatch(word, wordsOf(ID_TIME_MARKERS), {
    maxDistance: distanceOneOnly,
  });
  // Unique, non-exact match only. Exact markers are handled by the regex;
  // ambiguous ties (matched === null) leave the time unmarked.
  if (!match || match.matched === null || match.distance === 0) return undefined;

  const start = fromIndex + (token[0].length - word.length);
  return {
    marker: match.matched,
    end: start + word.length,
    issue: makeAutocorrectIssue(word, match.matched, match.distance, "time marker"),
  };
}

interface TypeFinding {
  type: ReminderType;
  issue?: ParserIssue;
}

function detectReminderType(
  input: string,
  preferredLanguage: PreferredLanguage,
): TypeFinding {
  const lower = input.toLowerCase();

  // H-N is a syntactic marker, not a word — no fuzzy needed.
  if (/\bh-\d+\b/.test(lower)) {
    return { type: "prep" };
  }

  // Exact-match against each type vocabulary first; fuzzy fallback if all miss.
  const exactPrep = /\b(before|sebelum)\b/.test(lower);
  if (exactPrep) return { type: "prep" };

  const exactFollowup = /\b(t\+\d+|follow[- ]?up|follow up|tindak lanjut)\b/.test(lower);
  if (exactFollowup) return { type: "followup" };

  const exactDeadline = /\b(deadline|due|batas akhir)\b/.test(lower);
  if (exactDeadline) return { type: "deadline" };

  const exactCooldown = /\b(cooldown|cool down|cool-off|cool off)\b/.test(lower);
  if (exactCooldown) return { type: "cooldown" };

  // Fuzzy fallback. Try each vocabulary in priority order (prep first, since
  // it's the most user-visible signal — "before/sebelum" with typos).
  const groups: Array<{ vocab: typeof TYPE_PREP_WORDS; type: ReminderType; kind: string }> = [
    { vocab: TYPE_PREP_WORDS, type: "prep", kind: "prep cue" },
    { vocab: TYPE_FOLLOWUP_WORDS, type: "followup", kind: "follow-up cue" },
    { vocab: TYPE_DEADLINE_WORDS, type: "deadline", kind: "deadline cue" },
    { vocab: TYPE_COOLDOWN_WORDS, type: "cooldown", kind: "cooldown cue" },
  ];

  for (const { vocab, type, kind } of groups) {
    const fuzzy = findFuzzyTokenMatch(input, wordsOf(vocab));
    if (!fuzzy) continue;
    if ("ambiguous" in fuzzy) {
      const biased = resolveByLanguage(
        fuzzy.ambiguous.candidates,
        vocab,
        preferredLanguage,
      );
      if (biased) {
        return {
          type,
          issue: makeAutocorrectIssue(
            fuzzy.original,
            biased.word,
            fuzzy.ambiguous.distance,
            kind,
          ),
        };
      }
      // Ambiguity across one vocabulary is rare; surface but don't classify off it.
      return {
        type: "main",
        issue: makeAmbiguousIssue(fuzzy.original, fuzzy.ambiguous.candidates, kind),
      };
    }
    return {
      type,
      issue: makeAutocorrectIssue(
        fuzzy.original,
        fuzzy.result.matched,
        fuzzy.result.distance,
        kind,
      ),
    };
  }

  return { type: "main" };
}

function findTypeSegments(input: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const prefix = /\bh-\d+\b/i.exec(input);

  if (prefix?.index !== undefined) {
    segments.push({ start: prefix.index, end: prefix.index + prefix[0].length });
  }

  return segments;
}

interface ChecklistResult extends ChecklistParse {
  issues: ParserIssue[];
}

function extractChecklist(
  input: string,
  preferredLanguage: PreferredLanguage,
): ChecklistResult {
  // Exact-match first.
  const match =
    /\b(bring|bawa|prepare|siapin|open|buka)\b\s+(.+)$/i.exec(input);

  if (match && match.index !== undefined) {
    const cue = match[1].toLowerCase();
    const rawItems = stripTimingTail(match[2]);
    const split = splitChecklistItems(rawItems, cue);
    return {
      titleSource: input.slice(0, match.index),
      checklist: split.items,
      issues: split.issues,
    };
  }

  // Fuzzy fallback — catches typos like `brnig laptop`, `bwa laptop`, `prperae slides`.
  const fuzzy = findFuzzyTokenMatch(input, wordsOf(CHECKLIST_CUES));
  if (!fuzzy) return { titleSource: input, checklist: [], issues: [] };

  if ("ambiguous" in fuzzy) {
    const biased = resolveByLanguage(
      fuzzy.ambiguous.candidates,
      CHECKLIST_CUES,
      preferredLanguage,
    );
    if (biased) {
      const cueWord = biased.word.toLowerCase();
      const tail = input.slice(fuzzy.end);
      const rawItems = stripTimingTail(tail.trim());
      const split = splitChecklistItems(rawItems, cueWord);
      return {
        titleSource: input.slice(0, fuzzy.start),
        checklist: split.items,
        issues: [
          makeAutocorrectIssue(
            fuzzy.original,
            biased.word,
            fuzzy.ambiguous.distance,
            "checklist cue",
          ),
          ...split.issues,
        ],
      };
    }
    // Don't split into a checklist if we can't tell which cue word was meant.
    // The whole text falls into title; surface the ambiguity.
    return {
      titleSource: input,
      checklist: [],
      issues: [
        makeAmbiguousIssue(fuzzy.original, fuzzy.ambiguous.candidates, "checklist cue"),
      ],
    };
  }

  const cueWord = fuzzy.result.matched.toLowerCase();
  const tail = input.slice(fuzzy.end);
  const rawItems = stripTimingTail(tail.trim());
  const split = splitChecklistItems(rawItems, cueWord);

  return {
    titleSource: input.slice(0, fuzzy.start),
    checklist: split.items,
    issues: [
      makeAutocorrectIssue(
        fuzzy.original,
        fuzzy.result.matched,
        fuzzy.result.distance,
        "checklist cue",
      ),
      ...split.issues,
    ],
  };
}

interface ChecklistSplit {
  items: string[];
  issues: ParserIssue[];
}

function splitChecklistItems(rawItems: string, cue: string): ChecklistSplit {
  const normalized = rawItems
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return { items: [], issues: [] };
  }

  // Normalize typo'd conjunctions (`dna`/`ane`) to a canonical `and` so the
  // splitter below catches them. Emits an autocorrect issue per fix.
  const conj = normalizeFuzzyConjunctions(normalized);
  const cleaned = conj.text;
  const issues = conj.issues;

  if (/[,+]/.test(cleaned) || /\b(and|dan)\b/i.test(cleaned)) {
    const items = cleaned
      .split(/\s*(?:,|\+|\band\b|\bdan\b)\s*/i)
      .map(cleanChecklistItem)
      .filter(Boolean);
    return { items, issues };
  }

  if (["bring", "bawa", "prepare", "siapin"].includes(cue)) {
    const words = cleaned.split(" ").map(cleanChecklistItem).filter(Boolean);
    return { items: words.length <= 5 ? words : [cleaned], issues };
  }

  return { items: [cleaned], issues };
}

/**
 * Replace typo'd conjunction tokens (`dna`→`dan`, `ane`→`and`) with a canonical
 * `and` so the item splitter treats them as separators. Two precision guards:
 *  - interior tokens only — a real conjunction always sits between two items,
 *    so first/last tokens are never split points (and `pan`/`tan`-style items
 *    at the edges don't alias onto `dan`);
 *  - distance capped at 1 — these are 3-char words with many near neighbors.
 * Exact conjunctions are left untouched (the splitter already handles them).
 */
function normalizeFuzzyConjunctions(text: string): {
  text: string;
  issues: ParserIssue[];
} {
  const tokens = tokenize(text);
  if (tokens.length < 3) return { text, issues: [] };

  const issues: ParserIssue[] = [];
  const hits: Array<{ start: number; end: number }> = [];

  for (let k = 1; k < tokens.length - 1; k++) {
    const token = tokens[k];
    const match = fuzzyMatch(token.word, wordsOf(CHECKLIST_CONJUNCTIONS), {
      maxDistance: distanceOneOnly,
    });
    if (!match || match.matched === null || match.distance === 0) continue;
    hits.push({ start: token.start, end: token.end });
    issues.push(
      makeAutocorrectIssue(token.word, match.matched, match.distance, "conjunction"),
    );
  }

  let out = text;
  for (const hit of hits.sort((a, b) => b.start - a.start)) {
    out = `${out.slice(0, hit.start)}and${out.slice(hit.end)}`;
  }

  return { text: out, issues };
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

interface CategoryFinding {
  category: ReminderCategory;
  issue?: ParserIssue;
}

/**
 * Category vocabularies in priority order. First exact (then fuzzy) hit wins,
 * so the order resolves cross-category overlaps (e.g. "urgent lab session"
 * stays university because university precedes urgent — matching the prior
 * hand-written regex order).
 */
const CATEGORY_GROUPS: ReadonlyArray<{
  vocab: VocabularyEntry[];
  category: ReminderCategory;
  kind: string;
  exact: RegExp;
}> = (
  [
    { vocab: CATEGORY_TUTORING, category: "tutoring", kind: "tutoring cue" },
    { vocab: CATEGORY_UNIVERSITY, category: "university", kind: "university cue" },
    { vocab: CATEGORY_INVESTING, category: "investing", kind: "investing cue" },
    { vocab: CATEGORY_URGENT, category: "urgent", kind: "urgent cue" },
    { vocab: CATEGORY_WAITING, category: "waiting", kind: "waiting cue" },
    { vocab: CATEGORY_PERSONAL, category: "personal", kind: "personal cue" },
  ] satisfies ReadonlyArray<{
    vocab: VocabularyEntry[];
    category: ReminderCategory;
    kind: string;
  }>
).map((g) => ({ ...g, exact: vocabularyRegex(g.vocab) }));

/** Case-insensitive word-boundary regex matching any word in a vocabulary. */
function vocabularyRegex(vocab: VocabularyEntry[]): RegExp {
  const alternation = vocab
    .map((entry) => entry.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`\\b(?:${alternation})\\b`, "i");
}

/**
 * Categorize from keyword vocabularies, exact-then-fuzzy, mirroring
 * `detectReminderType`. Category is a low-stakes organizational hint, so the
 * fuzzy fallback is capped at edit distance 1 (the v1.1 short-vocab guard):
 * the vocabularies are large and false-match-prone, and a wrong guess here
 * costs little and is correctable in the chain view. Each fuzzy hit emits an
 * `autocorrect` issue so the correction is visible, not silent.
 */
function detectReminderCategory(
  input: string,
  preferredLanguage: PreferredLanguage,
): CategoryFinding {
  const lower = input.toLowerCase();

  // Exact pass — behavior-preserving, zero added false-match risk.
  for (const { exact, category } of CATEGORY_GROUPS) {
    if (exact.test(lower)) return { category };
  }

  // Fuzzy fallback (distance 1 only). Reached only when every exact pass missed.
  for (const { vocab, category, kind } of CATEGORY_GROUPS) {
    const fuzzy = findFuzzyTokenMatch(input, wordsOf(vocab), {
      maxDistance: distanceOneOnly,
    });
    if (!fuzzy) continue;

    // Both tied candidates live in the same vocabulary, so the category is
    // unambiguous even when the exact word isn't — cite the language-biased
    // word if we can, otherwise the first candidate.
    if ("ambiguous" in fuzzy) {
      const biased = resolveByLanguage(
        fuzzy.ambiguous.candidates,
        vocab,
        preferredLanguage,
      );
      return {
        category,
        issue: makeAutocorrectIssue(
          fuzzy.original,
          biased?.word ?? fuzzy.ambiguous.candidates[0],
          fuzzy.ambiguous.distance,
          kind,
        ),
      };
    }

    return {
      category,
      issue: makeAutocorrectIssue(
        fuzzy.original,
        fuzzy.result.matched,
        fuzzy.result.distance,
        kind,
      ),
    };
  }

  return { category: "uncategorized" };
}

function scoreConfidence(input: {
  hasTitle: boolean;
  hasScheduledAt: boolean;
  hasChecklist: boolean;
  /**
   * Weighted issue count. Hard issues (missing_time, ambiguous_date, etc.)
   * count as 1.0; soft issues (autocorrect) count as 0.5. The caller does
   * the weighting and passes the sum.
   */
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

function relativeUnitToMs(amount: number, unit: string): number {
  const u = unit.toLowerCase();
  if (/^(seconds|second|secs|sec|detik|dtk|s)$/.test(u)) return amount * 1_000;
  if (/^(hours|hour|hrs|hr|jam|h)$/.test(u)) return amount * 3_600_000;
  if (/^(days|day|hari|d)$/.test(u)) return amount * 86_400_000;
  // minutes (minutes|minute|mins|min|menit|m) and any fallthrough.
  return amount * 60_000;
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

/**
 * First fire of a recurring reminder. Weekday rules anchor on the next matching
 * weekday; daily / weekly-without-a-day / monthly anchor on today and roll
 * forward by one interval if today's time has already passed.
 */
function firstRecurrenceOccurrence(
  now: Date,
  timezone: IanaTimezone,
  recurrence: Recurrence,
  time: TimeParts,
): IsoDateTimeString {
  if (recurrence.freq === "weekly" && recurrence.weekday !== undefined) {
    return nextWeekdayOccurrence(now, timezone, recurrence.weekday, time);
  }

  const today = addDaysInTimezone(now, timezone, 0);
  const candidate = localDateTimeToUtcDate(
    { ...today, hour: time.hour, minute: time.minute, second: 0 },
    timezone,
  );
  if (candidate.getTime() > now.getTime()) {
    return candidate.toISOString();
  }
  return addRecurrenceInterval(candidate.toISOString(), recurrence, timezone);
}

/** Next date (within 7 days) whose local weekday matches, at the given time. */
function nextWeekdayOccurrence(
  now: Date,
  timezone: IanaTimezone,
  weekday: number,
  time: TimeParts,
): IsoDateTimeString {
  for (let add = 0; add <= 7; add += 1) {
    const day = addDaysInTimezone(now, timezone, add);
    const dow = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (dow !== weekday) continue;
    const candidate = localDateTimeToUtcDate(
      { ...day, hour: time.hour, minute: time.minute, second: 0 },
      timezone,
    );
    if (candidate.getTime() > now.getTime()) {
      return candidate.toISOString();
    }
  }
  // Unreachable in practice (add=0 and add=7 share the weekday), but stay safe.
  const fallback = addDaysInTimezone(now, timezone, 7);
  return localDateTimeToUtcIso(
    { ...fallback, hour: time.hour, minute: time.minute, second: 0 },
    timezone,
  );
}

/**
 * Advance an ISO instant by one recurrence interval, preserving the local time
 * of day. Used by the scheduler to re-arm the next occurrence after a fire.
 * Monthly clamps the day to the target month's length (Jan 31 → Feb 28/29).
 */
export function addRecurrenceInterval(
  currentIso: IsoDateTimeString,
  recurrence: Pick<Recurrence, "freq" | "interval">,
  timezone: IanaTimezone,
): IsoDateTimeString {
  const parts = getLocalParts(new Date(currentIso), timezone);
  const interval = Math.max(1, recurrence.interval);

  if (recurrence.freq === "monthly") {
    const totalMonths = parts.month - 1 + interval;
    const year = parts.year + Math.floor(totalMonths / 12);
    const month = ((totalMonths % 12) + 12) % 12; // 0-based
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return localDateTimeToUtcIso(
      {
        year,
        month: month + 1,
        day: Math.min(parts.day, daysInMonth),
        hour: parts.hour,
        minute: parts.minute,
        second: 0,
      },
      timezone,
    );
  }

  const days = recurrence.freq === "weekly" ? 7 * interval : interval;
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return localDateTimeToUtcIso(
    {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: parts.hour,
      minute: parts.minute,
      second: 0,
    },
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
