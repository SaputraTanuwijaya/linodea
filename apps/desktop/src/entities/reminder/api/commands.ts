/**
 * Typed wrappers around the Rust-side reminder commands.
 *
 * Every other layer calls these instead of `invoke("create_reminder_node", ...)`
 * directly. Keeping the typing here means a Rust signature change only ripples
 * to one TS file.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ReminderNode, ReminderStatus } from "@linodea/types";

export interface ReminderStatusPatch {
  id: string;
  status: ReminderStatus;
  updatedAt: string;
  completedAt?: string;
  snoozedUntil?: string;
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
