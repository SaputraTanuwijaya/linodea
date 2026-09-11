/**
 * Settings section descriptor for the alerts feature.
 */

import type { SettingsBundle, SettingsSectionDescriptor } from "@/shared/settings";

import { AlertsSection } from "./ui/AlertsSection";

function AlertsSettingsContent({ bundle }: { bundle: SettingsBundle }) {
  return (
    <AlertsSection
      onPresenceChange={bundle.alertPresence.set}
      presence={bundle.alertPresence.value}
      strings={bundle.strings}
    />
  );
}

export const alertsSettingsSection: SettingsSectionDescriptor = {
  id: "alerts",
  // Sits right after Notifications (20): prealerts decide *when* a reminder
  // speaks up, this decides *how loudly*.
  order: 25,
  title: (s) => s.settings.alerts.title,
  hint: (s) => s.settings.alerts.hint,
  Component: AlertsSettingsContent,
};
