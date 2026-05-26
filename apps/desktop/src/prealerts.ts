/**
 * Prealert configuration registry.
 *
 * The user picks 0-3 offsets in Settings. Each offset is the number
 * of minutes before T-due that a prealert toast fires. T-due itself
 * is fixed and always fires (auto-marking the reminder `done`).
 *
 * Internally everything is stored in total-minutes. The UI lets the
 * user enter the value in days / hours / minutes, but the wire format
 * (and dedupe key segment) is always integer minutes.
 *
 * Persistence: localStorage key `linodea.prealerts.v1`.
 */

export const MAX_PREALERTS = 3;

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_HOUR = 60;

const STORAGE_KEY = "linodea.prealerts.v1";

export type OffsetUnit = "D" | "H" | "M";

export interface PrealertOffset {
  minutes: number;
}

export interface PrealertConfig {
  offsets: PrealertOffset[];
}

export const DEFAULT_CONFIG: PrealertConfig = {
  offsets: [
    { minutes: MINUTES_PER_DAY }, // D-1
    { minutes: MINUTES_PER_HOUR }, // H-1
  ],
};

/** Value used for a newly-added row in the Settings UI. */
const NEW_ROW_DEFAULT_MINUTES = 30;

export function getStoredPrealerts(): PrealertConfig {
  if (typeof window === "undefined") {
    return cloneConfig(DEFAULT_CONFIG);
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return cloneConfig(DEFAULT_CONFIG);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPrealertConfig(parsed)) {
      return cloneConfig(DEFAULT_CONFIG);
    }
    return parsed;
  } catch {
    return cloneConfig(DEFAULT_CONFIG);
  }
}

export function persistPrealerts(config: PrealertConfig): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function bestUnit(minutes: number): OffsetUnit {
  if (minutes > 0 && minutes % MINUTES_PER_DAY === 0) return "D";
  if (minutes > 0 && minutes % MINUTES_PER_HOUR === 0) return "H";
  return "M";
}

export function unitValue(minutes: number, unit: OffsetUnit): number {
  if (unit === "D") return Math.max(1, Math.round(minutes / MINUTES_PER_DAY));
  if (unit === "H") return Math.max(1, Math.round(minutes / MINUTES_PER_HOUR));
  return Math.max(1, Math.round(minutes));
}

export function toMinutes(value: number, unit: OffsetUnit): number {
  const safe = Math.max(1, Math.round(value));
  if (unit === "D") return safe * MINUTES_PER_DAY;
  if (unit === "H") return safe * MINUTES_PER_HOUR;
  return safe;
}

export function describeOffset(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes % MINUTES_PER_DAY === 0) {
    const days = minutes / MINUTES_PER_DAY;
    return days === 1 ? "1 day before" : `${days} days before`;
  }
  if (minutes % MINUTES_PER_HOUR === 0) {
    const hours = minutes / MINUTES_PER_HOUR;
    return hours === 1 ? "1 hour before" : `${hours} hours before`;
  }
  return minutes === 1 ? "1 min before" : `${minutes} min before`;
}

export function sortDescending(offsets: PrealertOffset[]): PrealertOffset[] {
  return [...offsets].sort((a, b) => b.minutes - a.minutes);
}

export function hasDuplicate(
  offsets: PrealertOffset[],
  candidateMinutes: number,
  excludeIndex?: number,
): boolean {
  return offsets.some(
    (offset, index) =>
      index !== excludeIndex && offset.minutes === candidateMinutes,
  );
}

/** Pick a default offset for a newly-added prealert row that doesn't collide. */
export function nextAvailableOffset(existing: PrealertOffset[]): PrealertOffset {
  const candidates = [
    NEW_ROW_DEFAULT_MINUTES,
    15,
    45,
    MINUTES_PER_HOUR,
    2 * MINUTES_PER_HOUR,
    MINUTES_PER_DAY,
  ];
  for (const minutes of candidates) {
    if (!hasDuplicate(existing, minutes)) {
      return { minutes };
    }
  }
  // All standard candidates taken. Fall back to a small increment from the
  // smallest existing offset.
  const smallest = existing.reduce(
    (min, offset) => Math.min(min, offset.minutes),
    Number.MAX_SAFE_INTEGER,
  );
  return { minutes: Math.max(1, smallest - 1) };
}

function cloneConfig(config: PrealertConfig): PrealertConfig {
  return { offsets: config.offsets.map((offset) => ({ ...offset })) };
}

function isPrealertConfig(value: unknown): value is PrealertConfig {
  if (!value || typeof value !== "object") return false;
  const offsets = (value as { offsets?: unknown }).offsets;
  if (!Array.isArray(offsets)) return false;
  return offsets.every(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as { minutes?: unknown }).minutes === "number" &&
      Number.isFinite((entry as { minutes: number }).minutes) &&
      (entry as { minutes: number }).minutes > 0,
  );
}
