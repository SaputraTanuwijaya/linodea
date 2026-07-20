/** Settings section descriptor for the app-update feature. */

import type { SettingsBundle, SettingsSectionDescriptor } from "@/shared/settings";

import { AppUpdateSection } from "./ui/AppUpdateSection";

function AppUpdateSettingsContent({ bundle }: { bundle: SettingsBundle }) {
  return (
    <AppUpdateSection controller={bundle.appUpdate} strings={bundle.strings} />
  );
}

export const appUpdateSettingsSection: SettingsSectionDescriptor = {
  id: "updates",
  order: 60,
  title: (strings) => strings.settings.updates.title,
  hint: (strings) => strings.settings.updates.hint,
  Component: AppUpdateSettingsContent,
};
