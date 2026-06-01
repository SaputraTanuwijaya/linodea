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
```

Return type: `ReminderParseResult` from `@linodea/types`.

## Supported rules (v0)

### Relative time

- Units: **seconds** (`s`, `sec`, `detik`, `dtk`), **minutes** (`m`, `min`, `menit`), **hours** (`h`, `hr`, `jam`), **days** (`d`, `day`, `hari`).
- The `in` prefix (EN) and `lagi` suffix (ID) are **optional**: `in 30m`, `5m`, `2 minutes`, `30 detik`, `2 jam lagi`, `in 3 days` all parse. A trailing word boundary after the unit guards against false matches (`run 5 miles`, `buy 2 apples` don't match).
- Relative reminders **snap to the nearest minute (`:00`)** by default, so firing is clean and predictable. Add the keyword **`/countdown`** anywhere in the input to keep the exact second instead (typed at `:47` → fires at `:47`); the keyword is stripped from the title. **Sub-minute durations always keep exact seconds** (snapping a 30s reminder to `:00` would be nonsense). The bare command name is exported as `COUNTDOWN_COMMAND_NAME` (single source of truth shared with the desktop slash-command registry), and `parseReminder` surfaces a `countdown: boolean` on its result so the UI can show the on-screen countdown timer.

### Date words

- `today`, `hari ini`
- `tomorrow`, `besok`
- `lusa`

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

| Keywords | Category |
|---|---|
| `les`, `tutor`, `privat` | tutoring |
| `lab`, `class`, `kelas`, `kuliah`, `campus`, `ktm`, `grading`, `rubric`, `slides` | university |
| `cpi`, `fomc`, `earnings`, `crypto`, `saham`, `stock`, `invest`, `thesis` | investing |
| obvious urgent/waiting/personal keywords | urgent / waiting / personal |
| default | uncategorized |

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

**What stays exact** (intentional):
- `jam`, `am`, `pm`, time units (`m/min/h/hr`) — short and rarely typo'd
- Category vocabularies — too many words, higher false-match risk; still deferred

**Emitted issues**:

| Code | When | Extra fields |
|---|---|---|
| `autocorrect` | Fuzzy match succeeded uniquely. Parser uses the corrected word. | `original`, `corrected`, `distance` |
| `ambiguous_token` | Two or more vocabulary words tied at the best distance. Parser refuses to autocorrect; segment stays in title. | `original`, `candidates` |

Autocorrects cost confidence at half the rate of hard issues (0.05 per correction vs. 0.1 per missing_time/ambiguous_date). Typos shouldn't tank confidence.

**Vocabularies** live in `src/vocabularies.ts` — extracted from inline regex so the fuzzy layer (`src/fuzzy.ts`) can iterate them.

## Known limits

- No natural-language grammar beyond the listed rules.
- No recurring reminders.
- No absolute calendar dates like `June 5`.
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
