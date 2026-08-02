import assert from "node:assert/strict";
import test from "node:test";
import { parseReminderWithNow, resolveByLanguage } from "../dist/index.js";

// resolveByLanguage is the bias helper. We exercise it directly with a small
// synthetic vocabulary because the production vocabularies rarely produce
// fuzzy ties on real inputs today — the bias is mostly future-proofing as
// vocabularies grow.

const SYNTH_VOCAB = [
  { word: "ad", lang: "en" },
  { word: "ad", lang: "id" }, // (will never collide; ids force uniqueness)
];

const SYNTH_OVERLAP_VOCAB = [
  { word: "alpha", lang: "en" },
  { word: "alpa", lang: "id" },
];

test("resolveByLanguage: no preference returns null", () => {
  const picked = resolveByLanguage(["alpha", "alpa"], SYNTH_OVERLAP_VOCAB);
  assert.equal(picked, null);
});

test("resolveByLanguage: preference 'auto' returns null", () => {
  const picked = resolveByLanguage(["alpha", "alpa"], SYNTH_OVERLAP_VOCAB, "auto");
  assert.equal(picked, null);
});

test("resolveByLanguage: preferred 'en' picks the en candidate", () => {
  const picked = resolveByLanguage(["alpha", "alpa"], SYNTH_OVERLAP_VOCAB, "en");
  assert.ok(picked);
  assert.equal(picked.word, "alpha");
  assert.equal(picked.lang, "en");
});

test("resolveByLanguage: preferred 'id' picks the id candidate", () => {
  const picked = resolveByLanguage(["alpha", "alpa"], SYNTH_OVERLAP_VOCAB, "id");
  assert.ok(picked);
  assert.equal(picked.word, "alpa");
  assert.equal(picked.lang, "id");
});

test("resolveByLanguage: no matching-lang candidate returns null", () => {
  const enOnlyVocab = [
    { word: "alpha", lang: "en" },
    { word: "beta", lang: "en" },
  ];
  const picked = resolveByLanguage(["alpha", "beta"], enOnlyVocab, "id");
  assert.equal(picked, null);
});

test("resolveByLanguage: multiple same-lang candidates returns null (still ambiguous)", () => {
  const vocab = [
    { word: "alpha", lang: "en" },
    { word: "beta", lang: "en" },
    { word: "alpa", lang: "id" },
  ];
  // Two EN candidates → preference doesn't resolve.
  const picked = resolveByLanguage(["alpha", "beta", "alpa"], vocab, "en");
  assert.equal(picked, null);
});

// Integration: confirm default behavior is unchanged when preferredLanguage
// is omitted or "auto". Picks the same fixture style as parseReminder tests.

const baseOptions = {
  now: "2026-05-22T01:00:00+07:00",
  timezone: "Asia/Jakarta",
};

test("parseReminderWithNow: preferredLanguage='auto' preserves existing behavior", () => {
  const result = parseReminderWithNow(
    "besko jam 8 lab session brnig laptop dan charger",
    { ...baseOptions, preferredLanguage: "auto" },
  );
  // Same expectations as the original typo-tolerance integration test.
  assert.equal(result.draft.title, "lab session");
  assert.ok(result.draft.scheduledAt);
  assert.deepEqual(result.draft.checklist, ["laptop", "charger"]);
});

test("parseReminderWithNow: preferredLanguage='en' on clean input is a no-op", () => {
  const result = parseReminderWithNow(
    "tomorrow 8am lab session bring laptop",
    { ...baseOptions, preferredLanguage: "en" },
  );
  assert.equal(result.draft.title, "lab session");
  assert.equal(result.draft.scheduledAt, "2026-05-23T01:00:00.000Z");
  assert.deepEqual(result.draft.checklist, ["laptop"]);
  // Clean input emits no issues even with a preference set.
  assert.deepEqual(
    result.issues.filter((i) => i.code === "ambiguous_token"),
    [],
  );
});

test("parseReminderWithNow: preferredLanguage='id' on clean input is a no-op", () => {
  const result = parseReminderWithNow(
    "besok jam 7 pagi les privat Kevin",
    { ...baseOptions, preferredLanguage: "id" },
  );
  assert.equal(result.draft.title, "les privat Kevin");
  assert.ok(result.draft.scheduledAt);
  assert.deepEqual(
    result.issues.filter((i) => i.code === "ambiguous_token"),
    [],
  );
});
