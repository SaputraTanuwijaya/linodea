import type {
  IanaTimezone,
  IsoDateTimeString,
  ParserIssue,
  ParsedReminderDraft,
  ReminderCategory,
  ReminderParseResult,
  ReminderType,
} from "@linodea/types";
import {
  CHECKLIST_CONJUNCTIONS,
  CHECKLIST_CUES,
  DATE_WORDS,
  ID_TIME_MARKERS,
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
 * Opt-in exact-second timing keyword. By default relative reminders snap to the
 * minute (:00); `/countdown` keeps the exact instant (typed at :47 → fires at
 * :47). Detected case-insensitively as a standalone token and stripped from the
 * text so it never lands in the title or checklist.
 */
const COUNTDOWN_PATTERN = /(?:^|\s)\/countdown(?=\s|$)/i;

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
  const typeSegments = findTypeSegments(normalizedInput);
  const textWithoutMeta = removeSegments(normalizedInput, [
    ...dateTime.segments,
    ...typeSegments,
  ]);
  const checklistParse = extractChecklist(textWithoutMeta, options.preferredLanguage);
  const title = cleanTitle(checklistParse.titleSource);

  const issues: ParserIssue[] = [...dateTime.issues];
  if (typeFinding.issue) issues.push(typeFinding.issue);
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
  preferredLanguage: PreferredLanguage,
  countdown: boolean,
): DateTimeParse {
  const relative = findRelativeTime(input);
  if (relative) {
    // Default: snap to the nearest minute (:00) so firing is clean and
    // predictable. `/countdown` keeps the exact instant for precise timers.
    const target = now.getTime() + relative.minutes * 60_000;
    const scheduledMs = countdown ? target : roundToMinute(target);
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
  const time = findClockTime(input, dateMatch !== undefined);
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
  allowBareTime: boolean,
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
