/**
 * The app-update controller.
 *
 * Check and download run silently in the background; only the restart asks.
 *
 * v0.1.2 tried announcing a found update through the themed confirm window on a
 * timer after mount. That failed on the installed build for two reasons worth
 * recording, because both are structural rather than fixable bugs:
 *   1. Windows refuses foreground to a background process, and the confirm
 *      window sets `skipTaskbar`, so it had nothing to flash — it showed but
 *      never came forward. (The alert window works precisely because it never
 *      calls `set_focus`.)
 *   2. More importantly, the only moment the app reliably *has* foreground is
 *      when the user summons the capture bar — and hijacking that with an
 *      update dialog breaks the one promise the app exists to keep.
 * So there is no prompt. An update that is downloaded and ready surfaces as a
 * quiet badge (see `phase === "ready"`); the Settings panel carries the detail.
 *
 * Failure is always silent-and-inert on the auto path: no network, no feed
 * published yet, a GitHub hiccup — none of it may block capture.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isTauriRuntime } from "@/shared/lib";

import type { AppUpdateController, AppUpdateState } from "./types";
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  readCurrentVersion,
  type Update,
} from "./updater";

/**
 * Delay before the automatic check, so a cold start spends its first seconds on
 * the things the user is waiting for (window, DB, scheduler) rather than a
 * network round-trip. Nothing announces itself now, so the exact value is not
 * load-bearing the way it was in v0.1.2.
 */
const AUTO_CHECK_DELAY_MS = 20_000;

export function useAppUpdate(): AppUpdateController {
  const [state, setState] = useState<AppUpdateState>(() => ({
    phase: "idle",
    supported: isTauriRuntime(),
    currentVersion: null,
    nextVersion: null,
  }));

  // The plugin hands back a Resource handle (it owns an `rid` on the Rust
  // side); `install()` needs the same object the check produced.
  const pendingRef = useRef<Update | null>(null);

  const runCheck = useCallback(async (silent: boolean) => {
    if (!isTauriRuntime()) return;
    setState((current) => ({ ...current, phase: "checking" }));
    try {
      const update = await checkForUpdate();
      pendingRef.current = update;

      if (!update) {
        setState((current) => ({
          ...current,
          phase: "upToDate",
          nextVersion: null,
        }));
        return;
      }

      // Found one: pull it down straight away. Downloading costs the user
      // nothing (no window, no restart), and it means the eventual click
      // applies instantly instead of stalling on a network transfer.
      setState((current) => ({
        ...current,
        phase: "downloading",
        currentVersion: current.currentVersion ?? update.currentVersion,
        nextVersion: update.version,
      }));
      await downloadUpdate(update);
      setState((current) => ({ ...current, phase: "ready" }));
    } catch {
      // A manual check earned an explanation; an auto-check just goes quiet.
      // Drop the handle either way so a later install() can't act on a payload
      // that was never fully fetched.
      pendingRef.current = null;
      setState((current) => ({ ...current, phase: silent ? "idle" : "error" }));
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;
    void readCurrentVersion().then((version) => {
      if (!cancelled) {
        setState((current) => ({ ...current, currentVersion: version }));
      }
    });

    const timer = window.setTimeout(() => {
      void runCheck(true);
    }, AUTO_CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [runCheck]);

  const check = useCallback(() => runCheck(false), [runCheck]);

  const install = useCallback(async () => {
    const update = pendingRef.current;
    if (!update) return;
    setState((current) => ({ ...current, phase: "installing" }));
    try {
      await installUpdate(update);
    } catch {
      setState((current) => ({ ...current, phase: "error" }));
    }
  }, []);

  return useMemo(
    () => ({ state, check, install }),
    [state, check, install],
  );
}
