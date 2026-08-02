/**
 * Open the feedback form in the user's browser, version pre-filled.
 *
 * Lives in `shared/` because two unrelated surfaces need it — Settings →
 * Support and the `/feedback` slash command — and it has no UI or state of its
 * own. Resolving the version is best-effort: `getVersion` failing must never
 * stop the form from opening, so it degrades to the plain link.
 */

import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

import { feedbackFormUrl } from "../config/links";

export async function openFeedbackForm(): Promise<void> {
  let version: string | undefined;
  try {
    version = await getVersion();
  } catch {
    // Fall through — the plain form link still works.
  }

  const url = feedbackFormUrl(version);
  if (!url) return;

  try {
    await openUrl(url);
  } catch {
    // Nothing useful to do if the browser refuses to open.
  }
}
