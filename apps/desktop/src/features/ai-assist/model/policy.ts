import type { ReminderParseResult } from "@linodea/types";

const COMPOUND_TEMPORAL_PATTERNS = [
  /\b(?:the\s+)?(?:next\s+)?day\s+after\s+tomorrow\b/i,
  /\b(?:one|two|three|\d+)\s+days?\s+(?:after|before)\b/i,
  /\b(?:following|subsequent|previous)\s+day\b/i,
  /\b(?:besok\s+lusa|sehari\s+setelah\s+besok)\b/i,
  /\b(?:hari|minggu|bulan)\s+(?:setelah|sebelum)\b/i,
];

/**
 * AI normally runs only when the deterministic parser cannot schedule. It also
 * catches compound relative-date language that can leave a plausible but wrong
 * partial parse, such as interpreting "day after tomorrow" as "tomorrow".
 */
export function shouldAttemptAiFallback(
  input: string,
  parseResult: ReminderParseResult | undefined,
): boolean {
  if (!parseResult?.draft.scheduledAt) return true;
  return COMPOUND_TEMPORAL_PATTERNS.some((pattern) => pattern.test(input));
}
