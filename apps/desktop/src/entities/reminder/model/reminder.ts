/**
 * Reminder domain helpers.
 *
 * Pure transforms over reminder data — no React, no I/O.
 */

import type { AnchorLinkResult } from "@linodea/parser";
import type { ReminderNode, ReminderParseResult } from "@linodea/types";

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
    category: parseResult.draft.category,
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
 * come from `parseAnchorLink`; the node **inherits the anchor's category and
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
    category: anchor.category, // inherit so it sits in the anchor's chain/section
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
