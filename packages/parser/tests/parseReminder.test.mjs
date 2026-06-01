import assert from "node:assert/strict";
import test from "node:test";
import { addRecurrenceInterval, parseReminderWithNow } from "../dist/index.js";

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

// --- Fire-time alignment + /countdown ---

// `now` carries non-zero seconds so snapping is observable.
const secondsNow = {
  now: "2026-05-22T01:00:47+07:00", // == 2026-05-21T18:00:47Z
  timezone: "Asia/Jakarta",
};

test("relative reminders snap to the minute by default", () => {
  const result = parseReminderWithNow("in 2m standup", secondsNow);

  // 18:00:47Z + 2m = 18:02:47Z, rounded to nearest minute -> 18:03:00Z.
  assert.equal(result.draft.title, "standup");
  assert.equal(result.draft.scheduledAt, "2026-05-21T18:03:00.000Z");
  // No /countdown keyword -> the flag is not set.
  assert.ok(!result.countdown);
});

test("/countdown keeps the exact second and is stripped from the title", () => {
  const result = parseReminderWithNow("in 2m standup /countdown", secondsNow);

  // Exact instant preserved: 18:00:47Z + 2m = 18:02:47Z.
  assert.equal(result.draft.scheduledAt, "2026-05-21T18:02:47.000Z");
  // Keyword must not pollute the title or checklist.
  assert.equal(result.draft.title, "standup");
  assert.ok(!/countdown/i.test(result.draft.title));
  // Flag surfaced so the capture UI can show the countdown timer window.
  assert.equal(result.countdown, true);
});

test("/countdown works regardless of position in the input", () => {
  const result = parseReminderWithNow("/countdown in 2m boil egg", secondsNow);

  assert.equal(result.draft.scheduledAt, "2026-05-21T18:02:47.000Z");
  assert.equal(result.draft.title, "boil egg");
  assert.equal(result.countdown, true);
});

// --- Parser flexibility (S35): seconds, bare relative, days, bare 24h time ---

// Evening `now` (20:00 Jakarta) so a 19:00 reminder has already passed today.
const eveningNow = {
  now: "2026-05-22T20:00:00+07:00", // == 2026-05-22T13:00:00Z
  timezone: "Asia/Jakarta",
};

test("seconds parse and keep exact timing without /countdown", () => {
  const result = parseReminderWithNow("30 seconds boil water", secondsNow);

  // Sub-minute -> exact instant kept (no minute snapping): 18:00:47Z + 30s.
  assert.equal(result.draft.scheduledAt, "2026-05-21T18:01:17.000Z");
  assert.equal(result.draft.title, "boil water");
  assert.ok(!result.countdown);
});

test("/countdown with seconds keeps the exact instant", () => {
  const result = parseReminderWithNow("/countdown 30 seconds boil water", secondsNow);

  assert.equal(result.draft.scheduledAt, "2026-05-21T18:01:17.000Z");
  assert.equal(result.draft.title, "boil water");
  assert.equal(result.countdown, true);
});

test("bare relative minutes parse without 'in'", () => {
  const result = parseReminderWithNow("5m standup", options);

  // >= 1 min -> snapped to the minute (18:00:00Z + 5m).
  assert.equal(result.draft.scheduledAt, "2026-05-21T18:05:00.000Z");
  assert.equal(result.draft.title, "standup");
});

test("bare relative minutes (spelled out) parse without 'in'", () => {
  const result = parseReminderWithNow("2 minutes call mom", options);

  assert.equal(result.draft.scheduledAt, "2026-05-21T18:02:00.000Z");
  assert.equal(result.draft.title, "call mom");
});

test("mixed 'in' + Indonesian unit parses", () => {
  const result = parseReminderWithNow("in 90 menit makan", options);

  assert.equal(result.draft.scheduledAt, "2026-05-21T19:30:00.000Z");
  assert.equal(result.draft.title, "makan");
});

test("relative days parse", () => {
  const result = parseReminderWithNow("in 3 days submit report", options);

  assert.equal(result.draft.scheduledAt, "2026-05-24T18:00:00.000Z");
  assert.equal(result.draft.title, "submit report");
});

test("bare 24-hour time resolves to today when still ahead", () => {
  const result = parseReminderWithNow("19:00 do this", options);

  // now is 01:00 Jakarta (May 22) -> 19:00 today == 12:00:00Z May 22.
  assert.equal(result.draft.scheduledAt, "2026-05-22T12:00:00.000Z");
  assert.equal(result.draft.title, "do this");
});

test("bare 24-hour time rolls to tomorrow when already past", () => {
  const result = parseReminderWithNow("19:00 do this", eveningNow);

  // now is 20:00 Jakarta (May 22) -> next 19:00 is May 23 == 12:00:00Z.
  assert.equal(result.draft.scheduledAt, "2026-05-23T12:00:00.000Z");
});

test("date word + bare 24-hour time still works", () => {
  const result = parseReminderWithNow("besok 19:00 standup", options);

  assert.equal(result.draft.scheduledAt, "2026-05-23T12:00:00.000Z");
  assert.equal(result.draft.title, "standup");
});

// Negatives — prove no false positives from number+word or colon-looking text.
for (const phrase of [
  "buy 2 apples",
  "run 5 miles",
  "read 3 pages",
  "watched 16:9 clip",
  "call 2:5 person",
]) {
  test(`no spurious time from "${phrase}"`, () => {
    const result = parseReminderWithNow(phrase, options);
    assert.equal(result.draft.scheduledAt, undefined);
  });
}

// --- Recurring reminders (S36) ---
// `options` now = 2026-05-21T18:00:00Z == Fri 2026-05-22 01:00 Jakarta.

test("every <weekday> + time → weekly on that weekday", () => {
  const result = parseReminderWithNow("every monday 8am standup", options);

  // Next Monday after Fri May 22 is May 25; 08:00 Jakarta == 01:00Z.
  assert.equal(result.draft.scheduledAt, "2026-05-25T01:00:00.000Z");
  assert.equal(result.draft.title, "standup");
  assert.deepEqual(result.recurrence, { freq: "weekly", interval: 1, weekday: 1 });
  assert.deepEqual(result.draft.recurrence, { freq: "weekly", interval: 1, weekday: 1 });
});

test("Indonesian daily recurrence with marker time", () => {
  const result = parseReminderWithNow("tiap hari jam 7 pagi olahraga", options);

  // 07:00 today is still ahead (now 01:00 local) → today 07:00 Jakarta == 00:00Z.
  assert.equal(result.draft.scheduledAt, "2026-05-22T00:00:00.000Z");
  assert.equal(result.draft.title, "olahraga");
  assert.deepEqual(result.recurrence, { freq: "daily", interval: 1 });
});

test("interval days + count, keyword stripped from title", () => {
  const result = parseReminderWithNow("every 2 days 9am review ×5", options);

  assert.equal(result.draft.scheduledAt, "2026-05-22T02:00:00.000Z");
  assert.equal(result.draft.title, "review");
  assert.deepEqual(result.recurrence, { freq: "daily", interval: 2, count: 5 });
});

test("Indonesian weekly with 'sebanyak N kali' count", () => {
  const result = parseReminderWithNow("setiap minggu 19:00 sync sebanyak 3 kali", options);

  assert.equal(result.draft.scheduledAt, "2026-05-22T12:00:00.000Z");
  assert.equal(result.draft.title, "sync");
  assert.deepEqual(result.recurrence, { freq: "weekly", interval: 1, count: 3 });
});

test("monthly recurrence", () => {
  const result = parseReminderWithNow("every month 09:00 pay rent", options);

  assert.equal(result.draft.scheduledAt, "2026-05-22T02:00:00.000Z");
  assert.equal(result.draft.title, "pay rent");
  assert.deepEqual(result.recurrence, { freq: "monthly", interval: 1 });
});

test("recurrence without a clock time does not schedule", () => {
  const result = parseReminderWithNow("every day water plants", options);

  assert.equal(result.draft.scheduledAt, undefined);
  assert.deepEqual(result.recurrence, { freq: "daily", interval: 1 });
  assert.ok(result.issues.some((i) => i.code === "missing_time"));
});

test("one-off 'in 2 days' is not treated as recurring", () => {
  const result = parseReminderWithNow("in 2 days submit", options);

  assert.equal(result.recurrence, undefined);
  assert.ok(result.draft.scheduledAt); // still a valid one-off
});

test("'every now and then' is not a recurrence", () => {
  const result = parseReminderWithNow("every now and then call", options);

  assert.equal(result.recurrence, undefined);
  assert.equal(result.draft.scheduledAt, undefined);
});

// addRecurrenceInterval — the scheduler's re-arm helper.
const TZ = "Asia/Jakarta";

test("addRecurrenceInterval advances daily/weekly preserving local time", () => {
  // 2026-05-22T02:00:00Z == 09:00 Jakarta.
  assert.equal(
    addRecurrenceInterval("2026-05-22T02:00:00.000Z", { freq: "daily", interval: 1 }, TZ),
    "2026-05-23T02:00:00.000Z",
  );
  assert.equal(
    addRecurrenceInterval("2026-05-22T02:00:00.000Z", { freq: "daily", interval: 2 }, TZ),
    "2026-05-24T02:00:00.000Z",
  );
  assert.equal(
    addRecurrenceInterval("2026-05-22T02:00:00.000Z", { freq: "weekly", interval: 1 }, TZ),
    "2026-05-29T02:00:00.000Z",
  );
});

test("addRecurrenceInterval monthly clamps the day to month length", () => {
  // 2026-01-31T05:00:00Z == 12:00 Jakarta Jan 31; +1 month → Feb 28 (2026 not leap).
  assert.equal(
    addRecurrenceInterval("2026-01-31T05:00:00.000Z", { freq: "monthly", interval: 1 }, TZ),
    "2026-02-28T05:00:00.000Z",
  );
});

// --- Category detection v1.2 (expanded vocabularies + fuzzy fallback) ---

test("categorizes from an expanded Indonesian university keyword (tugas)", () => {
  const result = parseReminderWithNow("besok jam 9 kumpulin tugas statistika", options);

  assert.equal(result.draft.category, "university");
  // Exact keyword match emits no autocorrect noise.
  assert.equal(result.issues.filter((i) => i.code === "autocorrect").length, 0);
});

test("categorizes from an expanded Indonesian investing keyword (dividen)", () => {
  const result = parseReminderWithNow("jumat cek dividen reksadana", options);

  assert.equal(result.draft.category, "investing");
});

test("fuzzy-categorizes a typo'd keyword and surfaces an autocorrect (sahm -> saham)", () => {
  const result = parseReminderWithNow("besok jam 8 review sahm BBCA", options);

  assert.equal(result.draft.category, "investing");
  const autocorrect = result.issues.find(
    (i) => i.code === "autocorrect" && i.corrected === "saham",
  );
  assert.ok(autocorrect, "expected an autocorrect issue for sahm -> saham");
  assert.equal(autocorrect.original.toLowerCase(), "sahm");
  assert.equal(autocorrect.distance, 1);
});

test("a near-miss everyday word is not mis-categorized (form !-> a category)", () => {
  // "form" sits one edit from several plausible keywords; the distance-1 fuzzy
  // fallback must not pull it into a category. (Guards the dropped "dorm" case.)
  const result = parseReminderWithNow("2 jam lagi submit form", options);

  assert.equal(result.draft.category, "uncategorized");
  assert.equal(result.issues.filter((i) => i.code === "autocorrect").length, 0);
});
