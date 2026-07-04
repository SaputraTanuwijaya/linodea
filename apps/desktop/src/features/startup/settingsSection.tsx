/**
 * Settings section descriptor for the startup feature.
 *
 * The autostart slot's setter takes a boolean (the desired enabled state)
 * even though its `value` is the full AutostartState object — that's why the
 * slot is `SettingsSlot<AutostartState, boolean>`.
 */

import { invoke } from "@tauri-apps/api/core";

import type { SettingsBundle, SettingsSectionDescriptor } from "@/shared/settings";

import { StartupSection } from "./ui/StartupSection";

function StartupSettingsContent({ bundle }: { bundle: SettingsBundle }) {
  return (
    <StartupSection
      autostart={bundle.autostart.value}
      onChange={(next) => {
        // Enabling is the safe/recommended direction — apply immediately.
        // Turning OFF reduces reliability (reminders only fire while running),
        // so route through the themed confirm window like Quit; App applies the
        // disable when confirmed (`autostartOff` in the confirm-result handler).
        if (next) {
          void bundle.autostart.set(true);
        } else {
          void invoke("show_confirm", {
            payload: { kind: "autostartOff" },
          }).catch(() => undefined);
        }
      }}
      strings={bundle.strings}
    />
  );
}

export const startupSettingsSection: SettingsSectionDescriptor = {
  id: "startup",
  order: 40,
  title: (s) => s.settings.startup.title,
  hint: (s) => s.settings.startup.hint,
  Component: StartupSettingsContent,
};
