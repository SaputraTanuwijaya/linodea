import assert from "node:assert/strict";
import test from "node:test";
import { parseReminderWithNow } from "../dist/index.js";

const options = {
  now: "2026-05-22T01:00:00+07:00",
  timezone: "Asia/Jakarta",
};

test("parses English tomorrow clock time with checklist", () => {
  const result = parseReminderWithNow(
    "tomorrow 8am lab session bring laptop charger KTM",
    options,
  );

  assert.equal(result.rawInput, "tomorrow 8am lab session bring laptop charger KTM");
  assert.equal(result.draft.title, "lab session");
  assert.equal(result.draft.scheduledAt, "2026-05-23T01:00:00.000Z");
  assert.equal(result.draft.timezone, "Asia/Jakarta");
  assert.equal(result.draft.type, "main");
  assert.equal(result.draft.category, "university");
  assert.deepEqual(result.draft.checklist, ["laptop", "charger", "KTM"]);
  assert.deepEqual(result.issues, []);
});

test("parses English relative minutes", () => {
  const result = parseReminderWithNow("in 30m check render", options);

  assert.equal(result.draft.title, "check render");
  assert.equal(result.draft.scheduledAt, "2026-05-21T18:30:00.000Z");
  assert.equal(result.draft.type, "main");
  assert.deepEqual(result.issues, []);
});

test("parses Indonesian relative hours", () => {
  const result = parseReminderWithNow("2 jam lagi submit form", options);

  assert.equal(result.draft.title, "submit form");
  assert.equal(result.draft.scheduledAt, "2026-05-21T20:00:00.000Z");
  assert.equal(result.draft.category, "uncategorized");
});

test("parses Indonesian date and clock marker", () => {
  const result = parseReminderWithNow(
    "besok jam 7 pagi les privat Kevin, siapin soal aljabar",
    options,
  );

  assert.equal(result.draft.title, "les privat Kevin");
  assert.equal(result.draft.scheduledAt, "2026-05-23T00:00:00.000Z");
  assert.equal(result.draft.category, "tutoring");
  assert.deepEqual(result.draft.checklist, ["soal", "aljabar"]);
});

test("marks H-1 reminders as prep without inventing a time", () => {
  const result = parseReminderWithNow("H-1 presentation review slides", options);

  assert.equal(result.draft.title, "presentation review slides");
  assert.equal(result.draft.type, "prep");
  assert.equal(result.draft.category, "university");
  assert.equal(result.draft.scheduledAt, undefined);
  assert.equal(result.issues[0]?.code, "missing_time");
  assert.equal(result.issues[1]?.code, "low_confidence");
});

test("uses the next occurrence for time-only reminders", () => {
  const result = parseReminderWithNow("8am check dashboard", options);

  assert.equal(result.draft.title, "check dashboard");
  assert.equal(result.draft.scheduledAt, "2026-05-22T01:00:00.000Z");
  assert.equal(result.issues[0]?.code, "ambiguous_date");
});

// --- Parser v1: typo tolerance ---

test("autocorrects a typo in an Indonesian date word (besko -> besok)", () => {
  const result = parseReminderWithNow(
    "besko jam 7 pagi les privat Kevin",
    options,
  );

  assert.equal(result.draft.title, "les privat Kevin");
  // Same scheduledAt as the clean "besok jam 7 pagi" fixture above.
  assert.equal(result.draft.scheduledAt, "2026-05-23T00:00:00.000Z");
  assert.equal(result.draft.category, "tutoring");

  const autocorrect = result.issues.find((i) => i.code === "autocorrect");
  assert.ok(autocorrect, "expected an autocorrect issue");
  assert.equal(autocorrect.original.toLowerCase(), "besko");
  assert.equal(autocorrect.corrected, "besok");
  assert.equal(autocorrect.distance, 1);
});

test("autocorrects a transposition typo in an English date word (tomrorow -> tomorrow)", () => {
  const result = parseReminderWithNow(
    "tomrorow 8am check dashboard",
    options,
  );

  assert.equal(result.draft.title, "check dashboard");
  // Same scheduledAt as the clean "tomorrow 8am ..." path.
  assert.equal(result.draft.scheduledAt, "2026-05-23T01:00:00.000Z");

  const autocorrect = result.issues.find((i) => i.code === "autocorrect");
  assert.ok(autocorrect, "expected an autocorrect issue");
  assert.equal(autocorrect.original.toLowerCase(), "tomrorow");
  assert.equal(autocorrect.corrected, "tomorrow");
});

test("autocorrects a typo in a checklist cue (bwa -> bawa)", () => {
  const result = parseReminderWithNow(
    "besok jam 8 lab session bwa laptop dan charger",
    options,
  );

  assert.equal(result.draft.title, "lab session");
  assert.equal(result.draft.scheduledAt, "2026-05-23T01:00:00.000Z");
  assert.deepEqual(result.draft.checklist, ["laptop", "charger"]);

  const autocorrect = result.issues.find(
    (i) => i.code === "autocorrect" && i.corrected === "bawa",
  );
  assert.ok(autocorrect, "expected an autocorrect issue for bwa -> bawa");
  assert.equal(autocorrect.original.toLowerCase(), "bwa");
});

test("clean input gets zero autocorrect issues (regression guard)", () => {
  const result = parseReminderWithNow(
    "besok jam 7 pagi les privat Kevin, siapin soal aljabar",
    options,
  );

  const autocorrects = result.issues.filter((i) => i.code === "autocorrect");
  assert.equal(autocorrects.length, 0);
});

// --- Parser v1.1: fuzzy time markers + conjunctions ---

test("autocorrects an Indonesian evening time marker typo (sorre -> sore)", () => {
  const result = parseReminderWithNow("besok jam 7 sorre standup", options);

  assert.equal(result.draft.title, "standup");
  // sore pushes 7 -> 19:00 WIB == 12:00 UTC.
  assert.equal(result.draft.scheduledAt, "2026-05-23T12:00:00.000Z");

  const autocorrect = result.issues.find(
    (i) => i.code === "autocorrect" && i.corrected === "sore",
  );
  assert.ok(autocorrect, "expected an autocorrect issue for sorre -> sore");
  assert.equal(autocorrect.original.toLowerCase(), "sorre");
  assert.equal(autocorrect.distance, 1);
});

test("autocorrects an Indonesian morning time marker typo (pagy -> pagi)", () => {
  const result = parseReminderWithNow("besok jam 8 pagy lab session", options);

  assert.equal(result.draft.title, "lab session");
  // pagi keeps 8 -> 08:00 WIB == 01:00 UTC (same as clean "jam 8" morning).
  assert.equal(result.draft.scheduledAt, "2026-05-23T01:00:00.000Z");
  assert.equal(result.draft.category, "university");

  const autocorrect = result.issues.find(
    (i) => i.code === "autocorrect" && i.corrected === "pagi",
  );
  assert.ok(autocorrect, "expected an autocorrect issue for pagy -> pagi");
});

test("autocorrects a typo'd checklist conjunction (dna -> dan)", () => {
  const result = parseReminderWithNow(
    "besok jam 8 lab session bawa laptop dna charger",
    options,
  );

  assert.equal(result.draft.title, "lab session");
  assert.deepEqual(result.draft.checklist, ["laptop", "charger"]);

  const autocorrect = result.issues.find(
    (i) => i.code === "autocorrect" && i.corrected === "dan",
  );
  assert.ok(autocorrect, "expected an autocorrect issue for dna -> dan");
  assert.equal(autocorrect.original.toLowerCase(), "dna");
});

test("exact time marker stays clean — no autocorrect (regression guard)", () => {
  const result = parseReminderWithNow("besok jam 7 sore meeting", options);

  assert.equal(result.draft.title, "meeting");
  assert.equal(result.draft.scheduledAt, "2026-05-23T12:00:00.000Z");

  const autocorrects = result.issues.filter((i) => i.code === "autocorrect");
  assert.equal(autocorrects.length, 0);
});

test("a non-marker word after the time is not aliased onto a marker", () => {
  const result = parseReminderWithNow("besok jam 8 review slides", options);

  // "review" must not be read as a marker: time stays 08:00 (01:00 UTC),
  // and the word survives in the title.
  assert.equal(result.draft.title, "review slides");
  assert.equal(result.draft.scheduledAt, "2026-05-23T01:00:00.000Z");

  const autocorrects = result.issues.filter((i) => i.code === "autocorrect");
  assert.equal(autocorrects.length, 0);
});
