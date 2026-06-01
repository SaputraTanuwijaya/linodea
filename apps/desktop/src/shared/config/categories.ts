/**
 * Category → color mapping for the chain view (section headers + node dots).
 *
 * The values point at the `--lin-cat-*` CSS variables defined per theme in
 * `app/App.css`, so colors stay theme-aware (dark vs light) in one place. Used
 * via inline `style` because Tailwind can't statically extract a templated
 * arbitrary-value class. The future paid "custom category colors" cosmetic
 * will override the CSS variables per user, leaving this map untouched.
 */

import type { ReminderCategory } from "@linodea/types";

export const CATEGORY_COLOR: Record<ReminderCategory, string> = {
  university: "var(--lin-cat-university)",
  investing: "var(--lin-cat-investing)",
  personal: "var(--lin-cat-personal)",
  tutoring: "var(--lin-cat-tutoring)",
  urgent: "var(--lin-cat-urgent)",
  waiting: "var(--lin-cat-waiting)",
  uncategorized: "var(--lin-cat-uncategorized)",
};

export function categoryColor(category: ReminderCategory): string {
  return CATEGORY_COLOR[category] ?? CATEGORY_COLOR.uncategorized;
}
