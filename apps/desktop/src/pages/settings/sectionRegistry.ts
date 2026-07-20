/**
 * Settings section registry.
 *
 * Collects the descriptor from each feature and exposes them sorted by
 * `order`. SettingsPage maps over this list.
 *
 * Adding a section: implement the feature, export its descriptor from the
 * feature's `index.ts`, then add a line below. SettingsPage itself does not
 * need to change.
 */

import { aiAssistSettingsSection } from "@/features/ai-assist";
import { appUpdateSettingsSection } from "@/features/app-update";
import { themeSettingsSection } from "@/features/theme";
import { languageSettingsSection } from "@/features/language";
import { prealertsSettingsSection } from "@/features/prealerts";
import { startupSettingsSection } from "@/features/startup";
import type { SettingsSectionDescriptor } from "@/shared/settings";

export const SETTINGS_SECTIONS: SettingsSectionDescriptor[] = [
  themeSettingsSection,
  prealertsSettingsSection,
  languageSettingsSection,
  startupSettingsSection,
  aiAssistSettingsSection,
  appUpdateSettingsSection,
].sort((a, b) => a.order - b.order);
