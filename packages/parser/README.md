# @linodea/parser

Deterministic natural-language reminder parser for Linodea. English + Indonesian, rule-based, no AI dependency.

## API

```ts
import { parseReminder, parseReminderWithNow, normalizeReminderInput } from "@linodea/parser";

// Runtime entry — uses current system time and local timezone.
parseReminder(rawInput, options?);

// Deterministic entry for tests, preview, fixtures, and replay.
parseReminderWithNow(rawInput, { now, timezone });

// Trim and collapse whitespace.
normalizeReminderInput(input);

// Resolve a `/link`-ed reminder's time RELATIVE TO an anchor (not now).
// `30m before` / `1 jam after` / absolute `jam 9`; role derived from direction
// (before → prep, after → followup). See the /link section below.
parseAnchorLink(text, { anchor, timezone?, defaultDirection? });
```

Return type: `ReminderParseResult` from `@linodea/types`.

## Supported rules (v0)

### Relative time

- Units: **seconds** (`s`, `sec`, `detik`, `dtk`), **minutes** (`m`, `min`, `menit`), **hours** (`h`, `hr`, `jam`), **days** (`d`, `day`, `hari`).
- The `in` prefix (EN) and `lagi` suffix (ID) are **optional**: `in 30m`, `5m`, `2 minutes`, `30 detik`, `2 jam lagi`, `in 3 days` all parse. A trailing word boundary after the unit guards against false matches (`run 5 miles`, `buy 2 apples` don't match).
- Relative **day** offsets can include a clock time: `in 2 days at 9am`, `2 hari lagi jam 9`. The day is applied in the reminder timezone, then the requested local clock is used.
- **Spelled-out numbers** work anywhere a digit does (relative duration, recurrence interval, repeat count): `in three days`, `tiga hari lagi`, `every two weeks`, `sebanyak tiga kali`. Plus the Indonesian fused `se-` idiom — `sejam lagi` / `sehari lagi` = "in one hour/day" (units `detik/menit/jam/hari` only) — and English `in a/an <unit>` (`in a minute`, `in an hour`). The unit/cadence keyword that always follows is the precision guard, so ordinary titles (`buy three apples`, `call one person`) don't match. `a`/`an` additionally require the explicit `in` prefix (bare `take a day off` is not a duration). The number lexicon lives in `vocabularies.ts` (`NUMBER_WORDS`). **Scope:** single-token words + tens (EN `one`–`nineteen`, `twenty`–`ninety`; ID `satu`–`dua belas`). Compounds (`twenty-five`, `dua puluh lima`) and fractions (`half an hour`) are out of scope.
- Relative reminders **snap to the nearest minute (`:00`)** by default, so firing is clean and predictable. Add the keyword **`/countdown`** anywhere in the input to keep the exact second instead (typed at `:47` → fires at `:47`); the keyword is stripped from the title. **Sub-minute durations always keep exact seconds** (snapping a 30s reminder to `:00` would be nonsense). The bare command name is exported as `COUNTDOWN_COMMAND_NAME` (single source of truth shared with the desktop slash-command registry), and `parseReminder` surfaces a `countdown: boolean` on its result so the UI can show the on-screen countdown timer.

### Date words

- `today`, `hari ini`
- `tomorrow`, `besok`
- `lusa`

### Absolute calendar dates

- Month + day: `June 5 9am`, `5 Juni jam 8`, `tanggal 17 jam 8`.
- English and Indonesian month names/short forms are recognized exactly.
- Month+day without a year resolves to this year, or next year if that local date/time has already passed.
- `tanggal N` / `tgl N` without a month resolves to this month, or next month if that local day/time has already passed.
- A calendar date without a clock time emits `missing_time` and does not schedule.

### Clock time

- `8am`, `8:30pm`
- `jam 7 pagi`, `jam 19`
- Bare 24-hour `19:00` — recognized with or without a date word. Time-only resolves to **today** if the time is still ahead, otherwise **tomorrow** (you can't schedule into the past). The pattern is strict (`16:9`, `2:5`, `16:90` don't match); separator is `:` only.

### Recurrence

- Requires an explicit cadence keyword, so one-off phrases (`in 2 days`) are never caught. Checked **before** relative time.
- Frequencies (EN + ID): daily (`every day`/`daily`/`tiap hari`), weekly (`every week`/`weekly`/`tiap minggu`), weekly-on-a-day (`every monday`/`tiap hari senin`), monthly (`every month`/`monthly`/`tiap bulan`). Intervals: `every 2 days`, `tiap 3 minggu`, `every other week`.
- Optional repeat count (`×5`, `5x`, `5 times`, `5 kali`, `sebanyak 5 kali`); omitted ⇒ unbounded.
- A recurring reminder **requires a clock time** to anchor; without one it emits `missing_time` and doesn't schedule. First occurrence: daily → next time today/tomorrow; weekday → next matching weekday; weekly-no-day / monthly → today at the time, else +interval.
- The rule is surfaced as `Recurrence` on the draft + result. `parseReminder` does **not** advance occurrences — the app scheduler calls `addRecurrenceInterval(currentIso, rule, timezone)` (exported) to compute the next fire after each occurrence (monthly clamps the day to the target month's length).

### Checklist cues

Trigger words: `bring`, `bawa`, `prepare`, `siapin`, `open`, `buka`.
Splitters: comma, plus, `and`, `dan`. Short bring/prepare phrases split by word.

### Type heuristics

| Match | Type |
|---|---|
| `H-<n>`, `before`, `sebelum` | `prep` |
| `follow-up`, `follow up`, `t+<n>` | `followup` |
| `deadline`, `due`, `batas akhir` | `deadline` |
| `cooldown`, `cool off` | `cooldown` |
| default | `main` |

### Category heuristics

Driven by the `CATEGORY_*` vocabularies in `vocabularies.ts` (the single source — there is no parallel regex), matched **exact-then-fuzzy** in the priority order below. First hit wins, so the order resolves cross-category overlaps (e.g. `university` precedes `urgent`). Representative keywords — see the vocabularies for the full bilingual lists.

| Category (priority) | Keywords (representative) |
|---|---|
| tutoring | `les`, `privat`, `bimbel`, `ngajar`, `murid`, `tutor`, `tutoring` |
| university | `lab`, `class`, `kelas`, `kuliah`, `kampus`, `tugas`, `ujian`, `kuis`, `skripsi`, `slides`, `presentasi` |
| investing | `cpi`, `fomc`, `saham`, `stock`, `invest`, `dividen`, `reksadana`, `ihsg`, `portofolio` |
| urgent | `urgent`, `asap`, `penting`, `darurat`, `segera`, `mendesak` |
| waiting | `waiting`, `pending`, `follow up`, `menunggu`, `nunggu`, `konfirmasi` |
| personal | `personal`, `rumah`, `keluarga`, `dokter`, `obat`, `belanja`, `olahraga`, `ultah` |
| default | uncategorized |

## `/link` anchor-relative time (`parseAnchorLink`)

For reminders chained to another (`/link` in the capture UI). Resolves the time **against the anchor's `scheduledAt`**, not now:

- `30m before` / `1 jam after` → anchor ∓ offset. Sign comes from the `before`/`after` (`sebelum`/`setelah`) word, else `defaultDirection` (default `before`). Spelled numbers work (`tiga jam before`).
- An absolute clock time (`jam 9`, `8pm`, `19:00`) → that time on the anchor's local date; direction is then **derived** by comparison.
- Returns `{ title, scheduledAt, direction, role, kind, offsetMs?, issues }`. `role` (`prep`/`followup`) is derived from `direction` — position is the source of truth, so it can't contradict the time. No time at all → sits at the anchor instant + a `missing_time` issue (links rather than refuses).

The parser stays anchor-agnostic everywhere else; this is the one entry the capture layer calls once an anchor is picked. Reuses the relative/clock matchers above.

## Typo tolerance (v1)

The parser falls back to fuzzy matching when an exact regex misses. Uses Damerau-Levenshtein distance (Levenshtein + adjacent transpositions, which catches `tomrorow → tomorrow` and `besko → besok` — the most common keyboard typos).

**Threshold rule**: edit distance ≤1 for words ≤4 chars, ≤2 for longer. Keeps short keywords like `jam` from absorbing unrelated 3-letter words.

**What gets fuzzy-matched in v1**:
- Date words (`today`, `hari ini`, `tomorrow`, `besok`, `lusa`)
- Checklist cues (`bring`, `bawa`, `prepare`, `siapin`, `open`, `buka`)
- Type cues (`before`, `sebelum`, `follow-up`, `tindak lanjut`, `deadline`, `due`, `batas akhir`, `cooldown`)

**Added in v1.1** (distance capped at 1 + a positional guard, because these are short, false-match-prone vocabularies):
- Indonesian time markers (`pagi/siang/sore/malam`) — fuzzy-matched only on the token *directly after* `jam N`, mirroring the exact regex's adjacency. The adjacency guard stops title words like `store` from aliasing onto `sore` mid-sentence. `besok jam 7 sorre` → `sore` → 19:00.
- Checklist conjunctions (`and`/`dan`) — fuzzy-matched only on *interior* checklist tokens (a real conjunction always sits between two items), so edge items like `pan`/`tan` don't alias onto `dan`. `bawa laptop dna charger` → splits to `["laptop", "charger"]`.

Both still emit an `autocorrect` issue, so the popup surfaces the correction for the user to verify — the residual false-positive risk (e.g. `jam 7 store`, or a genuine interior item within distance 1 of `dan`) is visible, not silent.

**Added in v1.2** (categories): category vocabularies are now fuzzy-matched as a fallback, capped at distance 1 (same short-vocab guard as v1.1, because the lists are large and false-match-prone). Reached only when every exact pass misses, and each hit emits an `autocorrect` issue, so the residual false-positive risk is visible, not silent. Category is a low-stakes hint and correctable in the chain view, so the looser exposure is acceptable. `besok review sahm BBCA` → investing (`sahm → saham`).

**What stays exact** (intentional):
- `jam`, `am`, `pm`, time units (`m/min/h/hr`) — short and rarely typo'd

**Emitted issues**:

| Code | When | Extra fields |
|---|---|---|
| `autocorrect` | Fuzzy match succeeded uniquely. Parser uses the corrected word. | `original`, `corrected`, `distance` |
| `ambiguous_token` | Two or more vocabulary words tied at the best distance. Parser refuses to autocorrect; segment stays in title. | `original`, `candidates` |

Autocorrects cost confidence at half the rate of hard issues (0.05 per correction vs. 0.1 per missing_time/ambiguous_date). Typos shouldn't tank confidence.

**Vocabularies** live in `src/vocabularies.ts` — extracted from inline regex so the fuzzy layer (`src/fuzzy.ts`) can iterate them.

## Known limits

- No natural-language grammar beyond the listed rules.
- Absolute calendar dates are exact-match only; typo/fuzzy month names are not supported.
- Relative duration units are seconds/minutes/hours/days only — `in 3 weeks` / `in three months` don't parse as one-offs (weeks/months exist only as recurrence cadences). Affects digits and spelled numbers equally.
- Spelled numbers cap at single tokens + tens — no compounds (`twenty-five`) or fractions (`half`).
- `H-1` marks type as `prep` but does not infer scheduled time without an anchor event.
- Time-only reminders schedule the next occurrence and emit `ambiguous_date`.
- `scheduledAt` is UTC ISO; `timezone` records the intended local timezone.
- Special characters and non-English/non-Indonesian language coverage are not robust yet.
- Mixed-language *richness* (interleaved EN+ID in same sentence) is partially supported via independent regex per concern, but not formally tested. P2 work.

## Tests

- `tests/parseReminder.test.mjs` — end-to-end parser fixtures. Add a fixture before changing rules.
- `tests/fuzzy.test.mjs` — unit tests for the Damerau-Levenshtein + ambiguity-rejection layer.

```bash
npm run test -w @linodea/parser
npm run typecheck -w @linodea/parser
```
