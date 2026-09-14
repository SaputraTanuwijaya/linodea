/**
 * Public surface for the phone-link feature.
 */

export {
  getStoredPhoneLinkEnabled,
  healthUrl,
  pairUrl,
  preferredAddress,
  type AddressProbe,
  type PairedDevice,
  type PairingState,
  type PhoneLinkStatus,
  type QrImage,
} from "./model/phoneLink";
export { usePhoneLink, type PhoneLinkController } from "./model/usePhoneLink";
export { PhoneLinkSection } from "./ui/PhoneLinkSection";
export { phoneLinkSettingsSection } from "./settingsSection";
