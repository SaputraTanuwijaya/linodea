/**
 * Public surface for the phone-link feature.
 */

export {
  getStoredPhoneLinkEnabled,
  healthUrl,
  type PhoneLinkStatus,
} from "./model/phoneLink";
export { usePhoneLink, type PhoneLinkController } from "./model/usePhoneLink";
export { PhoneLinkSection } from "./ui/PhoneLinkSection";
export { phoneLinkSettingsSection } from "./settingsSection";
