/**
 * Reminder domain helpers.
 *
 * Pure transforms over reminder data — no React, no I/O.
 */

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
): ReminderNode {
  if (!parseResult.draft.scheduledAt) {
    throw new Error("Reminder scheduled time is required.");
  }

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: parseResult.draft.title,
    rawInput: parseResult.rawInput,
    scheduledAt: parseResult.draft.scheduledAt,
    timezone: parseResult.draft.timezone,
    type: parseResult.draft.type,
    status: "pending",
    category: parseResult.draft.category,
    checklist: parseResult.draft.checklist,
    confidence: parseResult.draft.confidence,
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
