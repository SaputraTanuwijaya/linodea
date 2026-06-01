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
//
// These were sparse exact-match lists that the categorizer didn't even use
// (it had a parallel hardcoded regex). They are now the single source the
// categorizer drives off, exact-then-fuzzy, so expanding them here directly
// widens real-input coverage. Words are deliberately distinctive: avoid short
// or generic tokens that collide (under fuzzy distance 1) with everyday title
// words — e.g. "dorm" was dropped because "form" sits one edit away.

export const CATEGORY_TUTORING: VocabularyEntry[] = [
  ...id("les", "privat", "bimbel", "ngajar", "mengajar", "murid", "siswa"),
  ...en("tutor", "tutoring", "tutee"),
];

export const CATEGORY_UNIVERSITY: VocabularyEntry[] = [
  ...en(
    "lab",
    "class",
    "campus",
    "grading",
    "rubric",
    "slides",
    "lecture",
    "lecturer",
    "assignment",
    "exam",
    "quiz",
    "seminar",
    "semester",
    "syllabus",
    "presentation",
  ),
  ...id(
    "kelas",
    "kuliah",
    "kampus",
    "ktm",
    "dosen",
    "tugas",
    "ujian",
    "uts",
    "uas",
    "kuis",
    "skripsi",
    "praktikum",
    "mahasiswa",
    "sks",
    "krs",
    "presentasi",
  ),
];

export const CATEGORY_INVESTING: VocabularyEntry[] = [
  ...en(
    "cpi",
    "fomc",
    "earnings",
    "crypto",
    "stock",
    "invest",
    "thesis",
    "dividend",
    "portfolio",
    "trading",
    "etf",
  ),
  ...id(
    "saham",
    "investasi",
    "dividen",
    "portofolio",
    "reksadana",
    "obligasi",
    "ihsg",
    "emiten",
  ),
];

export const CATEGORY_URGENT: VocabularyEntry[] = [
  ...en("urgent", "asap"),
  ...id("penting", "darurat", "segera", "mendesak"),
];

export const CATEGORY_WAITING: VocabularyEntry[] = [
  ...en("waiting", "follow up", "follow-up", "pending"),
  ...id("menunggu", "nunggu", "konfirmasi"),
];

export const CATEGORY_PERSONAL: VocabularyEntry[] = [
  ...en("personal", "home", "family", "doctor", "groceries", "birthday"),
  ...id(
    "rumah",
    "keluarga",
    "pribadi",
    "dokter",
    "obat",
    "olahraga",
    "belanja",
    "ultah",
  ),
];

// --- Helpers ---

/** Extract just the words from a vocabulary list. */
export function wordsOf(vocab: VocabularyEntry[]): string[] {
  return vocab.map((entry) => entry.word);
}
