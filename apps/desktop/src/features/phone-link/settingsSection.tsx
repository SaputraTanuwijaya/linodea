/**
 * Settings section descriptor for the phone link.
 */

import type { SettingsBundle, SettingsSectionDescriptor } from "@/shared/settings";

import { PhoneLinkSection } from "./ui/PhoneLinkSection";

function PhoneLinkSettingsContent({ bundle }: { bundle: SettingsBundle }) {
  const link = bundle.phoneLink;
  return (
    <PhoneLinkSection
      busy={link.busy}
      enabled={link.enabled}
      error={link.error}
      onBeginPairing={() => void link.beginPairing()}
      onCancelPairing={() => void link.cancelPairing()}
      onEnabledChange={(next) => void link.setEnabled(next)}
      onForgetDevice={(id) => void link.forgetDevice(id)}
      pairing={link.pairing}
      status={link.status}
      strings={bundle.strings}
    />
  );
}

export const phoneLinkSettingsSection: SettingsSectionDescriptor = {
  id: "phone-link",
  // After Alerts (25): those decide how a reminder reaches you on this machine,
  // this decides whether it can reach your phone as well.
  order: 30,
  title: (s) => s.settings.phoneLink.title,
  hint: (s) => s.settings.phoneLink.hint,
  Component: PhoneLinkSettingsContent,
};
