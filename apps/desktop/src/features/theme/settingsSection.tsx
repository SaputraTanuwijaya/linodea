/**
 * Settings section descriptor for the theme feature.
 *
 * Collected by `pages/settings/sectionRegistry.ts`. The component receives
 * the full SettingsBundle and pulls the theme slot.
 */

import type { SettingsBundle, SettingsSectionDescriptor } from "@/shared/settings";

import { ThemeSection } from "./ui/ThemeSection";

function ThemeSettingsContent({ bundle }: { bundle: SettingsBundle }) {
  return (
    <ThemeSection
      activeTheme={bundle.theme.value}
      onThemeChange={bundle.theme.set}
      strings={bundle.strings}
    />
  );
}

export const themeSettingsSection: SettingsSectionDescriptor = {
  id: "theme",
  order: 10,
  title: (s) => s.settings.appearance.title,
  hint: (s) => s.settings.appearance.hint,
  Component: ThemeSettingsContent,
};
