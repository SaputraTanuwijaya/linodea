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

// --- Category vocabularies ---

export const CATEGORY_TUTORING: VocabularyEntry[] = [
  ...id("les", "privat"),
  ...en("tutor", "tutoring"),
];

export const CATEGORY_UNIVERSITY: VocabularyEntry[] = [
  ...en("lab", "class", "campus", "grading", "rubric", "slides"),
  ...id("kelas", "kuliah", "kampus", "ktm"),
];

export const CATEGORY_INVESTING: VocabularyEntry[] = [
  ...en("cpi", "fomc", "earnings", "crypto", "stock", "invest", "thesis"),
  ...id("saham"),
];

export const CATEGORY_URGENT: VocabularyEntry[] = [
  ...en("urgent", "asap"),
  ...id("penting", "darurat"),
];

export const CATEGORY_WAITING: VocabularyEntry[] = [
  ...en("waiting", "follow up", "follow-up"),
  ...id("menunggu"),
];

export const CATEGORY_PERSONAL: VocabularyEntry[] = [
  ...en("personal", "home", "family"),
  ...id("rumah", "keluarga"),
];

// --- Helpers ---

/** Extract just the words from a vocabulary list. */
export function wordsOf(vocab: VocabularyEntry[]): string[] {
  return vocab.map((entry) => entry.word);
}
