/**
 * Which popup surface is showing, driven by Rust.
 *
 * Rust is the only source of mode changes — the global shortcut, the tray menu,
 * the ••• menu and the `/list` `/chain` `/settings` slash commands all route
 * through an `enter_*_mode` command, which resizes the window and then emits
 * MODE_EVENT. Nothing in the frontend sets the mode directly, which is why this
 * hook exposes no setter.
 *
 * Adding a mode: extend `Mode` and `parseMode` here, add the Rust command and
 * sizing constant, then render the page in App.tsx.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import { MODE_EVENT } from "@/shared/config";
import { isTauriRuntime } from "@/shared/lib";

export type Mode = "capture" | "list" | "chain" | "settings";

export function useMode() {
  const [mode, setMode] = useState<Mode>("capture");
  const [settingsFocus, setSettingsFocus] = useState<string | null>(null);
  // Bumped on every mode event, not just on a *change* of mode. Consumers that
  // must react to "the user navigated" — dismissing the popup menu — key on
  // this, because the tray can re-issue the mode you are already in and that
  // still counts as navigating.
  const [modeEpoch, setModeEpoch] = useState(0);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let mounted = true;
    let unlisten: UnlistenFn | undefined;

    void listen<string>(MODE_EVENT, (event) => {
      if (!mounted) return;
      const parsed = parseMode(event.payload);
      setMode(parsed.mode);
      setSettingsFocus(parsed.settingsSection);
      setModeEpoch((epoch) => epoch + 1);
    }).then((fn) => {
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

  return { mode, settingsFocus, modeEpoch };
}

function parseMode(payload: string): {
  mode: Mode;
  settingsSection: string | null;
} {
  if (payload === "list") return { mode: "list", settingsSection: null };
  if (payload === "chain") return { mode: "chain", settingsSection: null };
  if (payload.startsWith("settings")) {
    const section = payload.split(":", 2)[1] ?? null;
    return { mode: "settings", settingsSection: section };
  }
  return { mode: "capture", settingsSection: null };
}
