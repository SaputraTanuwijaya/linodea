/**
 * Device identity helper.
 *
 * Generates a stable per-device UUID on first call and persists it in
 * localStorage. Used as `createdOnDeviceId` for new reminders so future sync
 * (Phase 2+) can attribute writes to a device.
 */

const STORAGE_KEY = "linodea.deviceId";

export function getDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const fresh = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, fresh);
  return fresh;
}
