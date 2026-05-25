/**
 * Fuzzy keyword matching for typo tolerance.
 *
 * Uses Damerau-Levenshtein distance (Levenshtein + adjacent transpositions),
 * because transposition errors (`tomrorow → tomorrow`, `besko → besok`) are
 * by far the most common typo class for keyboard typists.
 *
 * Scope: matches an input token against a fixed vocabulary of canonical
 * spellings. Never used for arbitrary free-text (would be too intrusive and slow).
 * The parser calls this only after its exact regex match fails.
 *
 * Tie policy: if two vocabulary words tie at the best distance, return null
 * with the candidates listed. The parser surfaces this as an `ambiguous_token`
 * issue rather than guessing.
 */

export interface FuzzyMatchOptions {
  /**
   * Length-tiered threshold. Default: <=4 chars allow distance 1, longer
   * allow distance 2. Tuned to catch realistic typos without false positives
   * on short keywords like "jam" or "in".
   */
  maxDistance?: (word: string) => number;
}

export interface FuzzyMatchResult {
  /** Canonical vocabulary word that matched. */
  matched: string;
  /** Edit distance between original token and matched word. */
  distance: number;
}

export interface FuzzyAmbiguousResult {
  matched: null;
  /** All vocabulary words tied at the best distance. */
  candidates: string[];
  /** The tied edit distance. */
  distance: number;
}

const defaultThreshold = (word: string): number => (word.length <= 4 ? 1 : 2);

/**
 * Compute Damerau-Levenshtein distance between two strings.
 *
 * O(n*m) time and space. Inputs are small (vocabulary words and user tokens
 * are typically < 20 chars), so the naive matrix is fine.
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // dp[i][j] = distance between a[0..i] and b[0..j]
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );

      // Transposition: aXY vs. bYX where X and Y are adjacent.
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + cost);
      }
    }
  }

  return dp[a.length][b.length];
}

/**
 * Find the best fuzzy match for `token` in `vocabulary`.
 *
 * Returns:
 *  - a unique best match within threshold → `{ matched, distance }`
 *  - a tie between two or more vocabulary words → `{ matched: null, candidates, distance }`
 *  - no match within threshold → `null`
 *
 * Case-insensitive. Both sides are lowercased before comparison.
 */
export function fuzzyMatch(
  token: string,
  vocabulary: readonly string[],
  options: FuzzyMatchOptions = {},
): FuzzyMatchResult | FuzzyAmbiguousResult | null {
  const threshold = options.maxDistance ?? defaultThreshold;
  const lowerToken = token.toLowerCase();

  let bestDistance = Infinity;
  let bestMatches: string[] = [];

  for (const word of vocabulary) {
    const lowerWord = word.toLowerCase();
    if (lowerWord === lowerToken) {
      // Exact match — return immediately. (Callers usually try regex first,
      // but this keeps fuzzyMatch safe to call standalone.)
      return { matched: word, distance: 0 };
    }

    const maxAllowed = threshold(lowerWord);
    // Cheap length-difference prune.
    if (Math.abs(lowerWord.length - lowerToken.length) > maxAllowed) {
      continue;
    }

    const distance = damerauLevenshtein(lowerToken, lowerWord);
    if (distance > maxAllowed) continue;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatches = [word];
    } else if (distance === bestDistance) {
      bestMatches.push(word);
    }
  }

  if (bestMatches.length === 0) {
    return null;
  }

  if (bestMatches.length === 1) {
    return { matched: bestMatches[0], distance: bestDistance };
  }

  return {
    matched: null,
    candidates: bestMatches,
    distance: bestDistance,
  };
}

/** A token found in the input, with its position. Used by the parser to remove matched segments. */
export interface InputToken {
  word: string;
  start: number;
  end: number;
}

/**
 * Tokenize an input string into word tokens with their positions.
 *
 * Splits on whitespace and most punctuation, but keeps hyphens and apostrophes
 * inside tokens (so `follow-up` stays one token, and `H-1` stays one token).
 * Positions are byte/char offsets into the original string, suitable for
 * passing to `removeSegments` upstream.
 */
export function tokenize(input: string): InputToken[] {
  const tokens: InputToken[] = [];
  const wordPattern = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;

  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(input)) !== null) {
    tokens.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

/**
 * Scan input tokens for a fuzzy match against a vocabulary.
 *
 * Returns the first token that fuzzy-matches a vocabulary word, with its
 * segment position. Skips tokens that exact-match the vocabulary (the caller
 * should have used a regex for those first; an exact match here would be
 * silently returned with distance 0, which is fine but redundant).
 *
 * Multi-word vocabulary entries (e.g. "hari ini", "follow up") are matched
 * by joining adjacent tokens with a single space and testing each window.
 */
export function findFuzzyTokenMatch(
  input: string,
  vocabulary: readonly string[],
  options: FuzzyMatchOptions = {},
):
  | { result: FuzzyMatchResult; original: string; start: number; end: number }
  | { ambiguous: FuzzyAmbiguousResult; original: string; start: number; end: number }
  | null {
  const tokens = tokenize(input);
  if (tokens.length === 0) return null;

  // Pre-compute window sizes from vocabulary (most are 1 word, some are 2).
  const maxWindow = Math.max(
    1,
    ...vocabulary.map((w) => w.split(/\s+/).length),
  );

  for (let i = 0; i < tokens.length; i++) {
    for (let span = 1; span <= maxWindow && i + span <= tokens.length; span++) {
      const window = tokens.slice(i, i + span);
      const joined = window.map((t) => t.word).join(" ");

      const result = fuzzyMatch(joined, vocabulary, options);
      if (!result) continue;

      const start = window[0].start;
      const end = window[window.length - 1].end;

      if (result.matched === null) {
        return { ambiguous: result, original: joined, start, end };
      }

      // Skip exact matches — caller should have handled those.
      if (result.distance === 0) continue;

      return { result, original: joined, start, end };
    }
  }

  return null;
}
