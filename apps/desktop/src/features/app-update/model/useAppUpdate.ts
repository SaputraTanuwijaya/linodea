/**
 * The app-update controller.
 *
 * Two entry points into the same state machine:
 *   - a silent auto-check shortly after mount; if the feed offers a newer
 *     version it asks through the themed confirm window (kind `"update"`),
 *     which `App` answers by calling `install()`.
 *   - `check()` from the Settings panel, which reports inline instead.
 *
 * Failure is always silent-and-inert on the auto path: no network, no feed
 * published yet, a GitHub hiccup — none of it may block capture.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isTauriRuntime } from "@/shared/lib";

import type { AppUpdateController, AppUpdateState } from "./types";
import {
  checkForUpdate,
  installUpdate,
  readCurrentVersion,
  type Update,
} from "./updater";

/**
 * Delay before the automatic check.
 *
 * Not a politeness knob — a collision guard. Rust keeps a *single* pending
 * confirm slot (`desktop::PENDING_CONFIRM`), so a second `show_confirm` while
 * one is open replaces the kind the window is rendering. The first-run
 * launch-on-boot prompt is fired from Rust `setup()` at t=0 and, if clobbered,
 * would never be answered — so its marker never gets written and it re-prompts
 * every launch. Waiting lets that prompt be answered first. Cheap insurance:
 * an update offered 20s after launch is no worse than one offered instantly.
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

      setState((current) => ({
        ...current,
        phase: "available",
        currentVersion: current.currentVersion ?? update.currentVersion,
        nextVersion: update.version,
      }));

      if (silent) {
        // Auto path: the popup is usually hidden, so ask through the confirm
        // window (it shows and focuses itself). `App` handles the result.
        await invoke("show_confirm", { payload: { kind: "update" } });
      }
    } catch {
      // A manual check earned an explanation; an auto-check just goes quiet.
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
    setState((current) => ({ ...current, phase: "downloading" }));
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
