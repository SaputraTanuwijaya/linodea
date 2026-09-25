/**
 * Settings section registry.
 *
 * Collects the descriptor from each feature, in the order the sidebar shows
 * them. SettingsPage maps over this list.
 *
 * Adding a section: implement the feature, export its descriptor from the
 * feature's `index.ts`, then add it below where it should appear. SettingsPage
 * itself does not need to change.
 */

import { aiAssistSettingsSection } from "@/features/ai-assist";
import { alertsSettingsSection } from "@/features/alerts";
import { appUpdateSettingsSection } from "@/features/app-update";
import { themeSettingsSection } from "@/features/theme";
import { languageSettingsSection } from "@/features/language";
import { prealertsSettingsSection } from "@/features/prealerts";
import { startupSettingsSection } from "@/features/startup";
import { supportSettingsSection } from "@/features/support";
import type { SettingsSectionDescriptor } from "@/shared/settings";

export const SETTINGS_SECTIONS: SettingsSectionDescriptor[] = [
  themeSettingsSection,
  prealertsSettingsSection,
  // Prealerts decide *when* a reminder speaks up; alerts decide how loudly.
  alertsSettingsSection,
  languageSettingsSection,
  startupSettingsSection,
  aiAssistSettingsSection,
  appUpdateSettingsSection,
  supportSettingsSection,
];
