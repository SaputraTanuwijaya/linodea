/**
 * Date-time formatting helpers.
 *
 * Locale-aware via Intl. Used by anything that displays a reminder time.
 */

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
