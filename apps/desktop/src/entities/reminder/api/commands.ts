/**
 * Typed wrappers around the Rust-side reminder commands.
 *
 * Every other layer calls these instead of `invoke("create_reminder_node", ...)`
 * directly. Keeping the typing here means a Rust signature change only ripples
 * to one TS file.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  ChainNode,
  Recurrence,
  ReminderCategory,
  ReminderNode,
  ReminderStatus,
  ReminderType,
} from "@linodea/types";

export interface ReminderStatusPatch {
  id: string;
  status: ReminderStatus;
  updatedAt: string;
  completedAt?: string;
  snoozedUntil?: string;
}

/** Full-content edit of a reminder's user-authored fields (re-derived from a
 * re-parse on the UI side). Separate from status/lifecycle changes. */
export interface ReminderEditPatch {
  id: string;
  title: string;
  rawInput: string;
  scheduledAt: string;
  timezone: string;
  type: ReminderType;
  category: ReminderCategory;
  checklist: string[];
  recurrence?: Recurrence;
  updatedAt: string;
}

/** Re-arm a recurring reminder onto its next occurrence (new time + rule). */
export interface AdvanceRecurrencePatch {
  id: string;
  scheduledAt: string;
  recurrence?: Recurrence;
  updatedAt: string;
}

/**
 * Re-position a node in the chain forest — link / unlink / reorder in one op.
 * `parentId` omitted = a top-level root; `afterId` omitted = the head of the
 * target sibling group. The Rust side enforces integrity (no self-parent, no
 * cycle, same-group `afterId`).
 */
export interface MovePatch {
  id: string;
  parentId?: string;
  afterId?: string;
  updatedAt: string;
}

export function createReminderNodeCommand(reminder: ReminderNode): Promise<ReminderNode> {
  return invoke<ReminderNode>("create_reminder_node", { reminder });
}

export function listReminderNodes(): Promise<ReminderNode[]> {
  return invoke<ReminderNode[]>("list_reminder_nodes");
}

export function updateReminderNodeStatus(
  patch: ReminderStatusPatch,
): Promise<ReminderNode> {
  return invoke<ReminderNode>("update_reminder_node_status", { patch });
}

export function updateReminderNode(patch: ReminderEditPatch): Promise<ReminderNode> {
  return invoke<ReminderNode>("update_reminder_node", { patch });
}

export function deleteReminderNode(id: string): Promise<void> {
  return invoke<void>("delete_reminder_node", { id });
}

export function advanceReminderRecurrence(
  patch: AdvanceRecurrencePatch,
): Promise<ReminderNode> {
  return invoke<ReminderNode>("advance_reminder_recurrence", { patch });
}

/** The assembled chain forest (nested roots → children, ordered by links). */
export function listReminderChains(): Promise<ChainNode[]> {
  return invoke<ChainNode[]>("list_reminder_chains");
}

/** Link / unlink / reorder a node within the chain forest. */
export function moveReminderNode(patch: MovePatch): Promise<ReminderNode> {
  return invoke<ReminderNode>("move_reminder_node", { patch });
}

/** Change only a reminder's category — the manual correction escape hatch. */
export interface ReminderCategoryPatch {
  id: string;
  category: ReminderCategory;
  updatedAt: string;
}

export function setReminderCategory(patch: ReminderCategoryPatch): Promise<ReminderNode> {
  return invoke<ReminderNode>("set_reminder_node_category", { patch });
}
