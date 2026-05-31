/**
 * One prealert row: value input + unit select + describe tail + remove.
 *
 * Internal to the prealerts feature — not exported from the feature index.
 */

import type { Strings } from "@/shared/i18n";

import {
  bestUnit,
  hasDuplicate,
  toMinutes,
  unitValue,
  type OffsetUnit,
  type PrealertOffset,
} from "../model/prealerts";

export function PrealertRow({
  index,
  offset,
  onDelete,
  onUpdate,
  siblings,
  strings,
}: {
  index: number;
  offset: PrealertOffset;
  onDelete: () => void;
  onUpdate: (minutes: number) => void;
  siblings: PrealertOffset[];
  strings: Strings;
}) {
  const unit = bestUnit(offset.minutes);
  const value = unitValue(offset.minutes, unit);
  const candidateForCurrent = toMinutes(value, unit);
  const isDuplicate =
    candidateForCurrent !== offset.minutes &&
    hasDuplicate(siblings, candidateForCurrent, index);

  function handleValueChange(nextValueRaw: string) {
    const parsed = Number.parseInt(nextValueRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onUpdate(toMinutes(parsed, unit));
  }

  function handleUnitChange(nextUnit: OffsetUnit) {
    onUpdate(toMinutes(value, nextUnit));
  }

  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={strings.prealerts.valueLabel}
        className={`h-8 w-16 rounded-md border bg-[var(--lin-bg-hover)] px-2 text-sm text-[var(--lin-text)] outline-none transition focus:border-[var(--lin-text-dim)] ${
          isDuplicate ? "border-[var(--lin-danger)]" : "border-[var(--lin-border)]"
        }`}
        inputMode="numeric"
        min={1}
        onChange={(event) => handleValueChange(event.target.value)}
        type="number"
        value={value}
      />
      <select
        aria-label={strings.prealerts.unitLabel}
        className="h-8 rounded-md border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-2 text-sm text-[var(--lin-text)] outline-none transition focus:border-[var(--lin-text-dim)]"
        onChange={(event) => handleUnitChange(event.target.value as OffsetUnit)}
        value={unit}
      >
        <option value="D">{strings.prealerts.units.D}</option>
        <option value="H">{strings.prealerts.units.H}</option>
        <option value="M">{strings.prealerts.units.M}</option>
      </select>
      <span className="text-xs text-[var(--lin-text-dim)]">
        {strings.prealerts.suffix}
      </span>
      <span className="ml-auto text-xs text-[var(--lin-text-mute)]">
        {strings.prealerts.describe(offset.minutes)}
      </span>
      <button
        aria-label={strings.prealerts.removeLabel}
        className="ml-1 rounded-md px-2 py-1 text-xs leading-none text-[var(--lin-text-dim)] transition hover:bg-[var(--lin-danger-bg)] hover:text-[var(--lin-danger)]"
        onClick={onDelete}
        type="button"
      >
        ✕
      </button>
    </div>
  );
}
