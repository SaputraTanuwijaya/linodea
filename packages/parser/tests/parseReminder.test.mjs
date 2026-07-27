import assert from "node:assert/strict";
import test from "node:test";
import {
  addRecurrenceInterval,
  parseAnchorLink,
  parseReminderWithNow,
} from "../dist/index.js";

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
  assert.deepEqual(result.draft.tags, []);
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
  assert.deepEqual(result.draft.tags, []);
});

test("parses Indonesian date and clock marker", () => {
  const result = parseReminderWithNow(
    "besok jam 7 pagi les privat Kevin, siapin soal aljabar",
    options,
  );

  assert.equal(result.draft.title, "les privat Kevin");
  assert.equal(result.draft.scheduledAt, "2026-05-23T00:00:00.000Z");
  assert.deepEqual(result.draft.tags, []);
  assert.deepEqual(result.draft.checklist, ["soal", "aljabar"]);
});

test("marks H-1 reminders as prep without inventing a time", () => {
  const result = parseReminderWithNow("H-1 presentation review slides", options);

  assert.equal(result.draft.title, "presentation review slides");
  assert.equal(result.draft.type, "prep");
  assert.deepEqual(result.draft.tags, []);
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
  assert.deepEqual(result.draft.tags, []);

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
  assert.deepEqual(result.draft.tags, []);

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

test("relative day plus clock time uses the target day's clock", () => {
  const result = parseReminderWithNow("in 2 days at 9am submit report", options);

  assert.equal(result.draft.scheduledAt, "2026-05-24T02:00:00.000Z");
  assert.equal(result.draft.title, "submit report");
});

test("Indonesian relative day plus clock time uses the target day's clock", () => {
  const result = parseReminderWithNow("2 hari lagi jam 9 kirim laporan", options);

  assert.equal(result.draft.scheduledAt, "2026-05-24T02:00:00.000Z");
  assert.equal(result.draft.title, "kirim laporan");
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
test("English absolute month day uses this year when ahead", () => {
  const result = parseReminderWithNow("June 5 9am submit report", options);

  assert.equal(result.draft.scheduledAt, "2026-06-05T02:00:00.000Z");
  assert.equal(result.draft.title, "submit report");
  assert.deepEqual(result.issues, []);
});

test("Indonesian day month absolute date parses", () => {
  const result = parseReminderWithNow("5 Juni jam 8 bayar listrik", options);

  assert.equal(result.draft.scheduledAt, "2026-06-05T01:00:00.000Z");
  assert.equal(result.draft.title, "bayar listrik");
});

test("Indonesian tanggal without month rolls to next month when day passed", () => {
  const result = parseReminderWithNow("tanggal 17 jam 8 bayar tagihan", options);

  assert.equal(result.draft.scheduledAt, "2026-06-17T01:00:00.000Z");
  assert.equal(result.draft.title, "bayar tagihan");
});

test("absolute calendar date without time needs a clock time", () => {
  const result = parseReminderWithNow("June 5 submit report", options);

  assert.equal(result.draft.scheduledAt, undefined);
  assert.equal(result.draft.title, "submit report");
  assert.equal(result.issues[0].code, "missing_time");
});

// A 24-hour clock next to a day-month date used to be misread as the day:
// `30 August 13:00` scheduled August *13* because month+day was tried first and
// the hour satisfied its day slot. A wrong-but-scheduled date is the worst
// failure mode, so each shape is pinned.
for (const { input, scheduledAt, title } of [
  {
    input: "30 August 13:00 thesis discussion with Sir John",
    scheduledAt: "2026-08-30T06:00:00.000Z",
    title: "thesis discussion with Sir John",
  },
  {
    input: "28 July 10:30 sync",
    scheduledAt: "2026-07-28T03:30:00.000Z",
    title: "sync",
  },
  {
    input: "28 Juli 09:00 rapat tim",
    scheduledAt: "2026-07-28T02:00:00.000Z",
    title: "rapat tim",
  },
  {
    input: "tanggal 28 Juli 13:00 rapat tim",
    scheduledAt: "2026-07-28T06:00:00.000Z",
    title: "rapat tim",
  },
  {
    input: "5 Juni 19:00 makan malam",
    scheduledAt: "2026-06-05T12:00:00.000Z",
    title: "makan malam",
  },
  // Month-first with a 24-hour clock must keep working — the clock sits outside
  // the date, so nothing is dropped.
  {
    input: "August 30 13:00 sync",
    scheduledAt: "2026-08-30T06:00:00.000Z",
    title: "sync",
  },
  // `10AM` never hit this bug (the day slot's word boundary already refused it),
  // but pin it so the guard can't regress the am/pm path.
  {
    input: "28 July 10AM messages",
    scheduledAt: "2026-07-28T03:00:00.000Z",
    title: "messages",
  },
  {
    input: "28 July 2026 13:00 sync",
    scheduledAt: "2026-07-28T06:00:00.000Z",
    title: "sync",
  },
]) {
  test(`day-month date keeps its day next to a clock time: ${input}`, () => {
    const result = parseReminderWithNow(input, options);

    assert.equal(result.draft.scheduledAt, scheduledAt);
    assert.equal(result.draft.title, title);
  });
}

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

// --- Number words (spelled-out integers, EN + ID) ---

test("English spelled relative days parse (in three days)", () => {
  const result = parseReminderWithNow("in three days submit report", options);

  // Same instant as the digit fixture "in 3 days submit report".
  assert.equal(result.draft.scheduledAt, "2026-05-24T18:00:00.000Z");
  assert.equal(result.draft.title, "submit report");
});

test("Indonesian spelled relative days parse (tiga hari lagi)", () => {
  const result = parseReminderWithNow("tiga hari lagi makan", options);

  assert.equal(result.draft.scheduledAt, "2026-05-24T18:00:00.000Z");
  assert.equal(result.draft.title, "makan");
});

test("Indonesian se- fused prefix parses (sejam lagi)", () => {
  const result = parseReminderWithNow("sejam lagi standup", options);

  // +1 hour from 18:00:00Z.
  assert.equal(result.draft.scheduledAt, "2026-05-21T19:00:00.000Z");
  assert.equal(result.draft.title, "standup");
});

test("English article a/an behind 'in' means one (in a minute)", () => {
  const result = parseReminderWithNow("in a minute call mom", options);

  assert.equal(result.draft.scheduledAt, "2026-05-21T18:01:00.000Z");
  assert.equal(result.draft.title, "call mom");
});

test("English 'in an hour' parses", () => {
  const result = parseReminderWithNow("in an hour take a break", options);

  assert.equal(result.draft.scheduledAt, "2026-05-21T19:00:00.000Z");
  assert.equal(result.draft.title, "take a break");
});

test("two-word Indonesian number resolves (dua belas jam lagi)", () => {
  const result = parseReminderWithNow("dua belas jam lagi cek hasil", options);

  // +12 hours from 18:00:00Z.
  assert.equal(result.draft.scheduledAt, "2026-05-22T06:00:00.000Z");
  assert.equal(result.draft.title, "cek hasil");
});

test("spelled interval recurrence parses (every two weeks)", () => {
  const result = parseReminderWithNow("every two weeks 8am sync", options);

  assert.equal(result.draft.scheduledAt, "2026-05-22T01:00:00.000Z");
  assert.equal(result.draft.title, "sync");
  assert.deepEqual(result.recurrence, { freq: "weekly", interval: 2 });
});

test("spelled repeat count parses (sebanyak tiga kali)", () => {
  const result = parseReminderWithNow(
    "setiap minggu 19:00 sync sebanyak tiga kali",
    options,
  );

  assert.equal(result.draft.scheduledAt, "2026-05-22T12:00:00.000Z");
  assert.equal(result.draft.title, "sync");
  assert.deepEqual(result.recurrence, { freq: "weekly", interval: 1, count: 3 });
});

// Negatives — the unit/cadence guard + the `in` guard on a/an keep number words
// from inventing schedules out of ordinary titles.
test("bare 'a <unit>' without 'in' is not a duration (take a day off)", () => {
  const result = parseReminderWithNow("take a day off to relax", options);

  assert.equal(result.draft.scheduledAt, undefined);
});

test("spelled number with no unit is not a duration (buy three apples)", () => {
  const result = parseReminderWithNow("buy three apples", options);

  assert.equal(result.draft.scheduledAt, undefined);
});

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

// --- Tags (`#tag`), which replaced keyword categorization ---
//
// The old categorizer guessed one of six fixed categories from ~90 keywords.
// These pin the replacement: pure extraction of what the user typed, no fuzzy,
// stripped from the title.

test("extracts a tag and strips it from the title", () => {
  const result = parseReminderWithNow(
    "30 August 13:00 thesis discussion with Sir John #skripsi",
    options,
  );

  assert.deepEqual(result.draft.tags, ["skripsi"]);
  assert.equal(result.draft.title, "thesis discussion with Sir John");
});

test("extracts several tags, lowercased and deduped, in typed order", () => {
  const result = parseReminderWithNow(
    "besok jam 8 rapat tim #Kerja #urgent #kerja",
    options,
  );

  assert.deepEqual(result.draft.tags, ["kerja", "urgent"]);
  assert.equal(result.draft.title, "rapat tim");
});

test("a leading tag still leaves a clean title", () => {
  const result = parseReminderWithNow("#kuliah besok jam 7 kelas pagi", options);

  assert.deepEqual(result.draft.tags, ["kuliah"]);
  assert.equal(result.draft.title, "kelas pagi");
});

test("tags survive alongside a checklist without swallowing an item", () => {
  const result = parseReminderWithNow(
    "besok jam 8 lab session bring laptop dan charger #kampus",
    options,
  );

  assert.deepEqual(result.draft.tags, ["kampus"]);
  assert.deepEqual(result.draft.checklist, ["laptop", "charger"]);
  assert.equal(result.draft.title, "lab session");
});

test("hyphens and digits survive inside a tag", () => {
  const result = parseReminderWithNow("tomorrow 8am review #saham-bbca", options);

  assert.deepEqual(result.draft.tags, ["saham-bbca"]);
});

test("a #digit is not a tag — it stays in the title", () => {
  // `#2` in "buy #2 pencil" must not become a tag named "2".
  const result = parseReminderWithNow("tomorrow 9am buy #2 pencil", options);

  assert.deepEqual(result.draft.tags, []);
  assert.equal(result.draft.title, "buy #2 pencil");
});

test("tags are capped, and the overflow stays visible in the title", () => {
  const result = parseReminderWithNow(
    "tomorrow 10am sync #a #b #c #d #e #f",
    options,
  );

  assert.deepEqual(result.draft.tags, ["a", "b", "c", "d", "e"]);
  // The cap is not silent — an untagged leftover is a signal, not a swallow.
  assert.equal(result.draft.title, "sync #f");
});

test("ordinary keywords no longer produce a tag (no guessing)", () => {
  // Each of these used to be auto-categorized: tugas -> university,
  // dividen -> investing, and `sahm` even fuzzy-matched to saham.
  for (const input of [
    "besok jam 9 kumpulin tugas statistika",
    "besok jam 8 cek dividen reksadana",
    "besok jam 8 review sahm BBCA",
  ]) {
    const result = parseReminderWithNow(input, options);
    assert.deepEqual(result.draft.tags, [], input);
    assert.equal(
      result.issues.filter((i) => i.code === "autocorrect").length,
      0,
      `${input} should emit no category autocorrect`,
    );
  }
});

// --- /link anchor-relative time (parseAnchorLink) ---
// Anchor sits at 14:00 Jakarta == 07:00:00Z. Offsets resolve from THERE, not now.
const anchorOpts = { anchor: "2026-05-22T07:00:00.000Z", timezone: "Asia/Jakarta" };

test("relative offset before the anchor → prep, time counts back from the anchor", () => {
  const r = parseAnchorLink("review draft 30m before", anchorOpts);

  assert.equal(r.scheduledAt, "2026-05-22T06:30:00.000Z"); // 14:00 - 30m
  assert.equal(r.direction, "before");
  assert.equal(r.role, "prep");
  assert.equal(r.kind, "offset");
  assert.equal(r.title, "review draft");
});

test("relative offset after the anchor → follow-up", () => {
  const r = parseAnchorLink("celebrate 1 jam after", anchorOpts);

  assert.equal(r.scheduledAt, "2026-05-22T08:00:00.000Z"); // 14:00 + 1h
  assert.equal(r.direction, "after");
  assert.equal(r.role, "followup");
  assert.equal(r.title, "celebrate");
});

test("no direction word defaults to before (prep)", () => {
  const r = parseAnchorLink("call boss 2 jam", anchorOpts);

  assert.equal(r.scheduledAt, "2026-05-22T05:00:00.000Z"); // 14:00 - 2h
  assert.equal(r.direction, "before");
  assert.equal(r.role, "prep");
});

test("defaultDirection option flips the no-keyword default to after", () => {
  const r = parseAnchorLink("wrap up 30m", { ...anchorOpts, defaultDirection: "after" });

  assert.equal(r.scheduledAt, "2026-05-22T07:30:00.000Z"); // 14:00 + 30m
  assert.equal(r.direction, "after");
  assert.equal(r.role, "followup");
});

test("spelled-out offset works (tiga jam before)", () => {
  const r = parseAnchorLink("tiga jam before submit", anchorOpts);

  assert.equal(r.scheduledAt, "2026-05-22T04:00:00.000Z"); // 14:00 - 3h
  assert.equal(r.title, "submit");
  assert.equal(r.role, "prep");
});

test("absolute clock time lands on the anchor's date, direction derived by comparison", () => {
  const r = parseAnchorLink("print slides jam 9", anchorOpts);

  assert.equal(r.scheduledAt, "2026-05-22T02:00:00.000Z"); // 09:00 Jakarta on anchor's day
  assert.equal(r.kind, "absolute");
  assert.equal(r.direction, "before"); // 09:00 < 14:00
  assert.equal(r.role, "prep");
  assert.equal(r.title, "print slides");
});

test("absolute time after the anchor derives follow-up", () => {
  const r = parseAnchorLink("dinner 8pm", anchorOpts);

  assert.equal(r.scheduledAt, "2026-05-22T13:00:00.000Z"); // 20:00 Jakarta
  assert.equal(r.direction, "after"); // 20:00 > 14:00
  assert.equal(r.role, "followup");
});

test("no offset/time links at the anchor instant and flags it", () => {
  const r = parseAnchorLink("remember to smile", anchorOpts);

  assert.equal(r.scheduledAt, "2026-05-22T07:00:00.000Z"); // the anchor itself
  assert.ok(r.issues.some((i) => i.code === "missing_time"));
});
