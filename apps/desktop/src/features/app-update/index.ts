/**
 * Public surface for the app-update feature.
 *
 * Other layers import from here, never from internal files.
 */

export { useAppUpdate } from "./model/useAppUpdate";
export { appUpdateSettingsSection } from "./settingsSection";
export type { AppUpdateController } from "./model/types";
