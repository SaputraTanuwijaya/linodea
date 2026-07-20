/**
 * Public surface for the app-update feature.
 *
 * Other layers import from here, never from internal files.
 */

export { useAppUpdate } from "./model/useAppUpdate";
export { AppUpdateSection } from "./ui/AppUpdateSection";
export { appUpdateSettingsSection } from "./settingsSection";
export type {
  AppUpdateController,
  AppUpdatePhase,
  AppUpdateState,
} from "./model/types";
