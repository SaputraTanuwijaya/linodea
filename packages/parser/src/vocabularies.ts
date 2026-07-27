/**
 * Parser vocabularies — hoisted out of inline regex so the fuzzy-match layer
 * can iterate them. Each list is the canonical spelling; typos and variants
 * are recognized at runtime via `fuzzyMatch`, not by enumerating misspellings here.
 *
 * Language tags exist to support future Parser v2 work (mixed-language
 * richness, per-language threshold tuning). Today they're informational.
 */

export type LangTag = "en" | "id";

export interface VocabularyEntry {
  word: string;
  lang: LangTag;
}

const en = (...words: string[]): VocabularyEntry[] =>
  words.map((word) => ({ word, lang: "en" }));

const id = (...words: string[]): VocabularyEntry[] =>
  words.map((word) => ({ word, lang: "id" }));

// --- Date words (day offset from today) ---

export interface DateWordEntry extends VocabularyEntry {
  dayOffset: number;
}

export const DATE_WORDS: DateWordEntry[] = [
  { word: "today", lang: "en", dayOffset: 0 },
  { word: "hari ini", lang: "id", dayOffset: 0 },
  { word: "tomorrow", lang: "en", dayOffset: 1 },
  { word: "besok", lang: "id", dayOffset: 1 },
  { word: "lusa", lang: "id", dayOffset: 2 },
];

// --- Indonesian clock-marker words (pagi/siang/sore/malam after `jam N`) ---

export const ID_TIME_MARKERS: VocabularyEntry[] = id(
  "pagi",
  "siang",
  "sore",
  "malam",
);

// --- Checklist cue words (start of a checklist tail) ---

export const CHECKLIST_CUES: VocabularyEntry[] = [
  ...en("bring", "prepare", "open"),
  ...id("bawa", "siapin", "buka"),
];

// --- Checklist conjunctions (split items inside a checklist) ---

export const CHECKLIST_CONJUNCTIONS: VocabularyEntry[] = [
  ...en("and"),
  ...id("dan"),
];

// --- Reminder-type cue words ---

export const TYPE_PREP_WORDS: VocabularyEntry[] = [
  ...en("before"),
  ...id("sebelum"),
];

export const TYPE_FOLLOWUP_WORDS: VocabularyEntry[] = [
  ...en("followup", "follow-up", "follow up"),
  ...id("tindak lanjut"),
];

export const TYPE_DEADLINE_WORDS: VocabularyEntry[] = [
  ...en("deadline", "due"),
  ...id("batas akhir"),
];

export const TYPE_COOLDOWN_WORDS: VocabularyEntry[] = [
  ...en("cooldown", "cool down", "cool-off", "cool off"),
];

// --- Categories: removed ---
//
// Six `CATEGORY_*` vocabularies (~90 keywords) used to live here, driving an
// exact-then-fuzzy categorizer. They are gone, replaced by user-authored `#tag`
// tokens the parser only has to *extract* — no guessing. The lists were one
// person's life (university / investing / tutoring), so 19 of 20 ordinary
// captures came back uncategorized, and when a keyword did hit it could be
// confidently wrong: `thesis` sat in the investing list (an *investment*
// thesis), sending "Thesis Discussion with Sir John" to investing. A single
// keyword anywhere in the raw input decided the answer, in a fixed priority
// order, with a distance-1 fuzzy fallback over all ~90 words — no mechanism at
// that shape can tell the two senses of "thesis" apart.

// --- Number words (spelled-out integers, EN + ID) ---
//
// The parser's number slots (relative duration, recurrence interval, repeat
// count) were digit-only, so `in three days` / `tiga hari lagi` silently
// missed. These map a spelled number to its value; `index.ts` accepts them
// anywhere a `\d{1,3}` was previously required. The unit/cadence keyword that
// always follows is the precision guard — `call three people` has no unit, so
// nothing matches. Scope is single-token words + tens (no compounds like
// `twenty-five`); `a`/`an` are handled separately in `index.ts` because they
// need the explicit `in` prefix to be safe (they're far too common in titles).

export interface NumberWordEntry extends VocabularyEntry {
  value: number;
}

export const NUMBER_WORDS: NumberWordEntry[] = [
  // English: 1–19 + tens.
  { word: "one", lang: "en", value: 1 },
  { word: "two", lang: "en", value: 2 },
  { word: "three", lang: "en", value: 3 },
  { word: "four", lang: "en", value: 4 },
  { word: "five", lang: "en", value: 5 },
  { word: "six", lang: "en", value: 6 },
  { word: "seven", lang: "en", value: 7 },
  { word: "eight", lang: "en", value: 8 },
  { word: "nine", lang: "en", value: 9 },
  { word: "ten", lang: "en", value: 10 },
  { word: "eleven", lang: "en", value: 11 },
  { word: "twelve", lang: "en", value: 12 },
  { word: "thirteen", lang: "en", value: 13 },
  { word: "fourteen", lang: "en", value: 14 },
  { word: "fifteen", lang: "en", value: 15 },
  { word: "sixteen", lang: "en", value: 16 },
  { word: "seventeen", lang: "en", value: 17 },
  { word: "eighteen", lang: "en", value: 18 },
  { word: "nineteen", lang: "en", value: 19 },
  { word: "twenty", lang: "en", value: 20 },
  { word: "thirty", lang: "en", value: 30 },
  { word: "forty", lang: "en", value: 40 },
  { word: "fifty", lang: "en", value: 50 },
  { word: "sixty", lang: "en", value: 60 },
  { word: "seventy", lang: "en", value: 70 },
  { word: "eighty", lang: "en", value: 80 },
  { word: "ninety", lang: "en", value: 90 },
  // Indonesian: 1–12. "dua belas" is the only multi-word entry; alternation in
  // `index.ts` sorts longest-first so it wins over a bare "dua".
  { word: "satu", lang: "id", value: 1 },
  { word: "dua belas", lang: "id", value: 12 },
  { word: "dua", lang: "id", value: 2 },
  { word: "tiga", lang: "id", value: 3 },
  { word: "empat", lang: "id", value: 4 },
  { word: "lima", lang: "id", value: 5 },
  { word: "enam", lang: "id", value: 6 },
  { word: "tujuh", lang: "id", value: 7 },
  { word: "delapan", lang: "id", value: 8 },
  { word: "sembilan", lang: "id", value: 9 },
  { word: "sepuluh", lang: "id", value: 10 },
  { word: "sebelas", lang: "id", value: 11 },
];

const NUMBER_WORD_MAP = new Map(
  NUMBER_WORDS.map((entry) => [entry.word, entry.value]),
);

/** Resolve a spelled-out number word to its integer value (case-insensitive). */
export function numberWordValue(word: string): number | undefined {
  return NUMBER_WORD_MAP.get(word.toLowerCase());
}

// --- Helpers ---

/** Extract just the words from a vocabulary list. */
export function wordsOf(vocab: VocabularyEntry[]): string[] {
  return vocab.map((entry) => entry.word);
}
