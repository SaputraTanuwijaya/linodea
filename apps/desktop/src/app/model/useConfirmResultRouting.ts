/**
 * Routes the themed confirm window's answer back into app actions.
 *
 * The confirm window (`pages/confirm`) only renders a question and emits the
 * choice — it owns no state. The main window owns the state, so the action for
 * each `kind` lands here:
 *   - "quit"         — quitting stops all reminders, so it was gated behind the
 *                      dialog; confirmed means actually quit.
 *   - "autostart"    — the first-run launch-on-boot prompt.
 *   - "autostartOff" — confirming means "yes, turn it off".
 *
 * Lives in `app/` because it spans layers no single feature may reach across:
 * app lifecycle (quit), a feature (startup), and navigation (enter_*_mode).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import { CONFIRM_RESULT_EVENT } from "@/shared/config";
import { isTauriRuntime } from "@/shared/lib";

export function useConfirmResultRouting(
  setAutostart: (next: boolean) => Promise<void> | void,
) {
  // The listener is mounted once and must stay mounted: re-subscribing on every
  // render would drop in-flight answers. Reading the setter through a ref keeps
  // the effect mount-once without capturing a stale closure.
  const setAutostartRef = useRef(setAutostart);
  useEffect(() => {
    setAutostartRef.current = setAutostart;
  });

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let mounted = true;
    let unlisten: UnlistenFn | undefined;

    void listen<{ kind: string; confirmed: boolean }>(
      CONFIRM_RESULT_EVENT,
      (event) => {
        const { kind, confirmed } = event.payload;
        if (kind === "quit") {
          if (confirmed) void invoke("quit_app").catch(() => undefined);
        } else if (kind === "autostart") {
          // Persist "answered" in Rust so the prompt isn't shown again, apply the
          // choice, then surface the capture bar so first-run lands in the app
          // (the main window was hidden while the prompt was up).
          void invoke("mark_boot_prompt_answered").catch(() => undefined);
          void setAutostartRef.current(confirmed);
          void invoke("enter_capture_mode").catch(() => undefined);
        } else if (kind === "autostartOff") {
          // Confirming means "yes, turn it off". The confirm window stole focus
          // and hid Settings, so reopen Settings to show the toggle's new state.
          if (confirmed) void setAutostartRef.current(false);
          void invoke("enter_settings_mode").catch(() => undefined);
        }
      },
    ).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);
}
