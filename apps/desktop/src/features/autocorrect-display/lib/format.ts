/**
 * Helpers for surfacing parser autocorrect issues in the popup preview.
 *
 * `ambiguous_token` issues are deliberately NOT surfaced — they're not
 * actionable from the popup (the user can't disambiguate inline).
 */

import type { ParserIssue } from "@linodea/types";

export function isDisplayableAutocorrect(issue: ParserIssue): boolean {
  return (
    issue.code === "autocorrect" &&
    typeof issue.original === "string" &&
    typeof issue.corrected === "string"
  );
}

export function formatAutocorrects(issues: ParserIssue[]): string {
  const first = issues[0];
  const head = `${first.original} → ${first.corrected}`;
  if (issues.length === 1) {
    return head;
  }
  return `${head} (+${issues.length - 1})`;
}
