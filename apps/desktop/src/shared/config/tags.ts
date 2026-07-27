/**
 * Tag → color mapping for the chain view (section headers + node dots).
 *
 * This replaced a fixed `Record<ReminderCategory, string>`. Tags are open-ended,
 * so a color can't be assigned per name up front — it's derived by hashing the
 * tag into a fixed palette. Two consequences worth knowing:
 *
 *  - the same tag always gets the same color, on every machine and across
 *    restarts (the hash is pure, nothing is persisted);
 *  - two different tags can collide onto one color. That's accepted: color is a
 *    visual grouping aid, and the section header always spells the tag out.
 *
 * The values point at `--lin-tag-*` CSS variables defined per theme in
 * `app/App.css`, so colors stay theme-aware (dark vs light) in one place. Used
 * via inline `style` because Tailwind can't statically extract a templated
 * arbitrary-value class. The future paid "custom tag colors" cosmetic will
 * override the CSS variables per user, leaving this file untouched.
 */

/** Palette slots a tag can hash into. Order is stable — changing it recolors
 *  every existing tag, so append rather than reorder. */
export const TAG_PALETTE = [
  "var(--lin-tag-1)",
  "var(--lin-tag-2)",
  "var(--lin-tag-3)",
  "var(--lin-tag-4)",
  "var(--lin-tag-5)",
  "var(--lin-tag-6)",
] as const;

/** Color for the untagged section — deliberately outside the palette. */
export const UNTAGGED_COLOR = "var(--lin-tag-none)";

/**
 * FNV-1a, 32-bit. Chosen for being short, dependency-free and well-spread over
 * short lowercase ASCII strings — which is exactly what a normalized tag is.
 */
function hashTag(tag: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < tag.length; index += 1) {
    hash ^= tag.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable color for a tag; the untagged color when there is no tag. */
export function tagColor(tag: string | undefined): string {
  if (!tag) return UNTAGGED_COLOR;
  return TAG_PALETTE[hashTag(tag) % TAG_PALETTE.length];
}
