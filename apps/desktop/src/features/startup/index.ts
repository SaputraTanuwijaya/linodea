/**
 * Public surface for the startup feature.
 *
 * Other layers import from here, never from internal files.
 */

export { useAutostart } from "./model/useAutostart";
export { StartupSection } from "./ui/StartupSection";
export type { AutostartState } from "./model/startup";
