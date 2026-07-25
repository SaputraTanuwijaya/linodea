/** Settings section descriptor for the support feature. */

import type { SettingsBundle, SettingsSectionDescriptor } from "@/shared/settings";

import { SupportSection } from "./ui/SupportSection";

function SupportSettingsContent({ bundle }: { bundle: SettingsBundle }) {
  return <SupportSection strings={bundle.strings} />;
}

export const supportSettingsSection: SettingsSectionDescriptor = {
  id: "support",
  order: 70,
  title: (strings) => strings.settings.support.title,
  hint: (strings) => strings.settings.support.hint,
  Component: SupportSettingsContent,
};
