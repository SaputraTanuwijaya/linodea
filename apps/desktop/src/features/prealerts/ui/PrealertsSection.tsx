/**
 * Prealerts settings section.
 *
 * Lets the user pick 0-N prealert offsets. Each row is a PrealertRow.
 * "Add prealert" appears until MAX_PREALERTS is reached.
 */

import { useMemo } from "react";

import type { Strings } from "@/shared/i18n";

import {
  hasDuplicate,
  MAX_PREALERTS,
  nextAvailableOffset,
  sortDescending,
  type PrealertConfig,
} from "../model/prealerts";
import { PrealertRow } from "./PrealertRow";

export function PrealertsSection({
  config,
  onChange,
  strings,
}: {
  config: PrealertConfig;
  onChange: (next: PrealertConfig) => void;
  strings: Strings;
}) {
  const sorted = useMemo(() => sortDescending(config.offsets), [config.offsets]);

  function updateOffset(index: number, minutes: number) {
    if (minutes <= 0) return;
    if (hasDuplicate(sorted, minutes, index)) return;
    const nextOffsets = sorted.map((offset, i) =>
      i === index ? { minutes } : offset,
    );
    onChange({ offsets: nextOffsets });
  }

  function deleteOffset(index: number) {
    onChange({ offsets: sorted.filter((_, i) => i !== index) });
  }

  function addOffset() {
    if (sorted.length >= MAX_PREALERTS) return;
    onChange({ offsets: [...sorted, nextAvailableOffset(sorted)] });
  }

  return (
    <div className="grid gap-2">
      {sorted.length === 0 ? (
        <p className="text-xs text-[var(--lin-text-mute)]">
          {strings.prealerts.emptyState}
        </p>
      ) : (
        sorted.map((offset, index) => (
          <PrealertRow
            index={index}
            key={`${index}-${offset.minutes}`}
            offset={offset}
            onDelete={() => deleteOffset(index)}
            onUpdate={(minutes) => updateOffset(index, minutes)}
            siblings={sorted}
            strings={strings}
          />
        ))
      )}
      {sorted.length < MAX_PREALERTS ? (
        <button
          className="w-fit rounded-md border border-dashed border-[var(--lin-border)] px-3 py-1.5 text-xs font-medium text-[var(--lin-text-dim)] transition hover:border-[var(--lin-text-dim)] hover:text-[var(--lin-text)]"
          onClick={addOffset}
          type="button"
        >
          {strings.prealerts.addButton}
        </button>
      ) : null}
    </div>
  );
}
