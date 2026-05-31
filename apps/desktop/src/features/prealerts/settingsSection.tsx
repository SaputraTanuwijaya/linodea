/**
 * Settings section descriptor for the prealerts feature.
 *
 * The hint interpolates MAX_PREALERTS, which is owned by this feature.
 */

import type { SettingsBundle, SettingsSectionDescriptor } from "@/shared/settings";

import { MAX_PREALERTS } from "./model/prealerts";
import { PrealertsSection } from "./ui/PrealertsSection";

function PrealertsSettingsContent({ bundle }: { bundle: SettingsBundle }) {
  return (
    <PrealertsSection
      config={bundle.prealerts.value}
      onChange={bundle.prealerts.set}
      strings={bundle.strings}
    />
  );
}

export const prealertsSettingsSection: SettingsSectionDescriptor = {
  id: "prealerts",
  order: 20,
  title: (s) => s.settings.notifications.title,
  hint: (s) => s.settings.notifications.hint(MAX_PREALERTS),
  Component: PrealertsSettingsContent,
};
