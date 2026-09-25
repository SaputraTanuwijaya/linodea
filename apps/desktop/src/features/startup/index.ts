/**
 * Public surface for the startup feature.
 *
 * Other layers import from here, never from internal files.
 */

export { useAutostart } from "./model/useAutostart";
export { startupSettingsSection } from "./settingsSection";
export type { AutostartState } from "./model/startup";
