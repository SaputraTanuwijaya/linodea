/**
 * Settings section descriptor for the startup feature.
 *
 * The autostart slot's setter takes a boolean (the desired enabled state)
 * even though its `value` is the full AutostartState object — that's why the
 * slot is `SettingsSlot<AutostartState, boolean>`.
 */

import type { SettingsBundle, SettingsSectionDescriptor } from "@/shared/settings";

import { StartupSection } from "./ui/StartupSection";

function StartupSettingsContent({ bundle }: { bundle: SettingsBundle }) {
  return (
    <StartupSection
      autostart={bundle.autostart.value}
      onChange={bundle.autostart.set}
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
