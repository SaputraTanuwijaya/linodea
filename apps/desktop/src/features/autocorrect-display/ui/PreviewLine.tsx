/**
 * Preview line shown beneath the capture input.
 *
 * Renders the parsed time plus a tail showing any parser autocorrects
 * (`besko → besok`). The autocorrect tail is the actual feature value here;
 * the time portion happens to live in the same line for layout.
 */

import type { ReminderParseResult } from "@linodea/types";

import type { Strings } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib";

import { formatAutocorrects, isDisplayableAutocorrect } from "../lib/format";

export function PreviewLine({
  isSaving,
  parseResult,
  strings,
}: {
  isSaving: boolean;
  parseResult: ReminderParseResult | undefined;
  strings: Strings;
}) {
  if (isSaving) {
    return <>{strings.preview.saving}</>;
  }
  if (!parseResult) {
    return <>{" "}</>;
  }

  const base = parseResult.draft.scheduledAt
    ? formatDateTime(parseResult.draft.scheduledAt)
    : strings.preview.needsTime;

  const autocorrects = parseResult.issues.filter(isDisplayableAutocorrect);

  if (autocorrects.length === 0) {
    return <>{base}</>;
  }

  return (
    <>
      <span>{base}</span>
      <span className="text-[var(--lin-text-mute)]">
        {" · "}
        {formatAutocorrects(autocorrects)}
      </span>
    </>
  );
}
