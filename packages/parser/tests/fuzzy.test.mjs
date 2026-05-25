import assert from "node:assert/strict";
import test from "node:test";
import {
  damerauLevenshtein,
  fuzzyMatch,
  findFuzzyTokenMatch,
} from "../dist/fuzzy.js";

test("damerauLevenshtein: identical strings -> 0", () => {
  assert.equal(damerauLevenshtein("besok", "besok"), 0);
});

test("damerauLevenshtein: single transposition -> 1", () => {
  assert.equal(damerauLevenshtein("besko", "besok"), 1);
  assert.equal(damerauLevenshtein("tomrorow", "tomorrow"), 1);
});

test("damerauLevenshtein: single insertion / deletion / substitution -> 1", () => {
  assert.equal(damerauLevenshtein("besok", "besoks"), 1); // insertion
  assert.equal(damerauLevenshtein("besoks", "besok"), 1); // deletion
  assert.equal(damerauLevenshtein("besok", "besik"), 1); // substitution
});

test("fuzzyMatch: returns unique match within threshold", () => {
  const result = fuzzyMatch("besko", ["besok", "lusa", "tomorrow"]);
  assert.ok(result);
  assert.equal(result.matched, "besok");
  assert.equal(result.distance, 1);
});

test("fuzzyMatch: returns null when no match within threshold", () => {
  const result = fuzzyMatch("xyz", ["besok", "lusa", "tomorrow"]);
  assert.equal(result, null);
});

test("fuzzyMatch: refuses to autocorrect ambiguous matches", () => {
  // Both "besok" and "besor" (made up) would be distance 1 from "beson".
  // Use a real-world style tie: "lasa" is distance 1 from both "lusa" and "lasa-like" words.
  // Construct explicitly: "best" is distance 1 from "best" (0), but tie at distance 2 with "rest"/"nest".
  const result = fuzzyMatch("rast", ["rest", "rust", "rant", "rats"]);
  // rast -> rest (1 sub), rust (1 sub), rant (1 sub), rats (1 transposition)
  // All distance 1 -> ambiguous
  assert.ok(result);
  assert.equal(result.matched, null);
  assert.ok(Array.isArray(result.candidates));
  assert.ok(result.candidates.length >= 2);
});

test("fuzzyMatch: short words use stricter threshold", () => {
  // 'jam' is 3 chars -> threshold 1. 'mam' is distance 1, should match.
  const close = fuzzyMatch("mam", ["jam"]);
  assert.ok(close);
  assert.equal(close.matched, "jam");
  // 'pam' would also be distance 1 from 'jam'. Verify it doesn't false-match an
  // unrelated short word like 'in'.
  const wrong = fuzzyMatch("an", ["in", "on", "at"]);
  // 'an' -> 'in' (1 sub), 'on' (1 sub), 'at' (1 sub). All tie. Should be ambiguous.
  assert.ok(wrong);
  assert.equal(wrong.matched, null);
});

test("findFuzzyTokenMatch: locates the typo segment in the input", () => {
  const found = findFuzzyTokenMatch("besko jam 7 pagi", ["besok", "tomorrow"]);
  assert.ok(found && "result" in found);
  assert.equal(found.result.matched, "besok");
  assert.equal(found.original.toLowerCase(), "besko");
  assert.equal(found.start, 0);
  assert.equal(found.end, 5);
});

test("findFuzzyTokenMatch: skips exact matches (caller's job)", () => {
  // Input contains the exact word — fuzzy should not return it as a "correction".
  const found = findFuzzyTokenMatch("besok jam 7", ["besok"]);
  assert.equal(found, null);
});

test("findFuzzyTokenMatch: handles multi-word vocabulary entries", () => {
  const found = findFuzzyTokenMatch("hari ni meeting", ["hari ini", "tomorrow"]);
  // "hari ni" should match "hari ini" at distance 1 (insertion).
  assert.ok(found && "result" in found);
  assert.equal(found.result.matched, "hari ini");
});
