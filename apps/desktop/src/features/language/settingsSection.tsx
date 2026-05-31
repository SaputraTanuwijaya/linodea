/**
 * Settings section descriptor for the language feature.
 */

import type { SettingsBundle, SettingsSectionDescriptor } from "@/shared/settings";

import { LanguageSection } from "./ui/LanguageSection";

function LanguageSettingsContent({ bundle }: { bundle: SettingsBundle }) {
  return (
    <LanguageSection
      activeLanguage={bundle.language.value}
      onLanguageChange={bundle.language.set}
    />
  );
}

export const languageSettingsSection: SettingsSectionDescriptor = {
  id: "language",
  order: 30,
  title: (s) => s.settings.language.title,
  hint: (s) => s.settings.language.hint,
  Component: LanguageSettingsContent,
};
