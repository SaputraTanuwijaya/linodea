/**
 * I/O seam over the Tauri updater/process plugins.
 *
 * Same reason `entities/reminder/api/commands.ts` exists: the hook stays a
 * state machine and every native call sits behind one mockable boundary.
 */

import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

export type { Update };

/** Resolves to `null` when the running version is already the latest. */
export function checkForUpdate(): Promise<Update | null> {
  return check();
}

/**
 * Download, install, relaunch. `relaunch()` replaces the process, so nothing
 * after this call runs on the success path.
 */
export async function installUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}

/** Best-effort: the version line is cosmetic, so a failure reads as "unknown". */
export async function readCurrentVersion(): Promise<string | null> {
  try {
    return await getVersion();
  } catch {
    return null;
  }
}
