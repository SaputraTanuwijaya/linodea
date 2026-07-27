/**
 * Reminder domain helpers.
 *
 * Pure transforms over reminder data — no React, no I/O.
 */

import type { AnchorLinkResult } from "@linodea/parser";
import type { ChainNode, ReminderNode, ReminderParseResult } from "@linodea/types";

/** Section key for reminders with no tags. Not a valid tag — `normalizeTag`
 *  requires a leading letter — so it can never collide with a real one. */
export const UNTAGGED = "";

/** The node's primary tag: the section it groups under in the chain view. */
export function primaryTag(node: ReminderNode): string {
  return node.tags[0] ?? UNTAGGED;
}

export interface TagSection {
  tag: string;
  roots: ChainNode[];
}

/**
 * Bucket chain roots into chain-view sections, keyed on the **primary** tag.
 *
 * Grouping on `tags[0]` rather than every tag is deliberate: a tree section needs
 * each node to appear exactly once. A two-tag reminder shown under two headers
 * would duplicate its children and break the connector geometry, which is drawn
 * from row indices within a section. The first tag the user typed is the primary
 * one; the row renders the rest as chips.
 *
 * Ordering: tags alphabetically, untagged last — a user who tags everything
 * never sees an "Untagged" header.
 */
export function groupChainsByTag(roots: ChainNode[]): TagSection[] {
  const buckets = new Map<string, ChainNode[]>();

  for (const chain of roots) {
    const key = primaryTag(chain.node);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(chain);
    else buckets.set(key, [chain]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === UNTAGGED) return 1;
      if (b === UNTAGGED) return -1;
      return a.localeCompare(b);
    })
    .map(([tag, sectionRoots]) => ({ tag, roots: sectionRoots }));
}

/** Every tag in use across a forest, sorted — the retag popover's quick picks. */
export function collectTagsInUse(roots: ChainNode[]): string[] {
  const all = new Set<string>();
  const walk = (chain: ChainNode) => {
    chain.node.tags.forEach((tag) => all.add(tag));
    chain.children.forEach(walk);
  };
  roots.forEach(walk);
  return [...all].sort();
}

/**
 * Build a fresh `ReminderNode` from a successful parser result.
 *
 * Throws when the parser did not produce a scheduled time. Callers should
 * guard with `parseResult.draft.scheduledAt` first.
 */
export function createReminderNode(
  parseResult: ReminderParseResult,
  deviceId: string,
  rawInputOverride?: string,
): ReminderNode {
  if (!parseResult.draft.scheduledAt) {
    throw new Error("Reminder scheduled time is required.");
  }

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: parseResult.draft.title,
    rawInput: rawInputOverride ?? parseResult.rawInput,
    scheduledAt: parseResult.draft.scheduledAt,
    timezone: parseResult.draft.timezone,
    type: parseResult.draft.type,
    status: "pending",
    tags: parseResult.draft.tags,
    checklist: parseResult.draft.checklist,
    confidence: parseResult.draft.confidence,
    recurrence: parseResult.draft.recurrence,
    createdAt: now,
    updatedAt: now,
    createdOnDeviceId: deviceId,
    syncVersion: 0,
  };
}

/**
 * Build a reminder that is linked to an anchor (a `/link` capture). Time + role
 * come from `parseAnchorLink`; the node **inherits the anchor's tags and
 * timezone** so it groups under the same chain. The caller links it into the
 * forest with `moveReminderNode({ parentId: anchor.id })` after creating it.
 */
export function createLinkedReminderNode(
  link: AnchorLinkResult,
  anchor: ReminderNode,
  rawInput: string,
  deviceId: string,
): ReminderNode {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: link.title,
    rawInput,
    scheduledAt: link.scheduledAt,
    timezone: anchor.timezone,
    type: link.role, // "prep" | "followup" — derived from direction
    status: "pending",
    tags: [...anchor.tags], // inherit so it sits in the anchor's chain/section
    checklist: [],
    confidence: 0.9, // deterministic anchor math, not a fuzzy guess
    recurrence: undefined,
    createdAt: now,
    updatedAt: now,
    createdOnDeviceId: deviceId,
    syncVersion: 0,
  };
}

/** A reminder still in play — not done, not cancelled. */
export function isActionable(reminder: ReminderNode): boolean {
  return (
    reminder.status === "pending" ||
    reminder.status === "missed" ||
    reminder.status === "snoozed"
  );
}

/** Sort comparator: earliest `scheduledAt` first. */
export function byScheduledAt(a: ReminderNode, b: ReminderNode): number {
  return a.scheduledAt.localeCompare(b.scheduledAt);
}
