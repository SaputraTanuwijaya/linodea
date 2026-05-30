/**
 * Launch-on-boot toggle wrapper.
 *
 * Thin layer over `@tauri-apps/plugin-autostart` that:
 *   - tolerates the browser-fallback runtime (plugin calls throw), and
 *   - normalizes "available + current state" into a single read.
 *
 * Source of truth is the OS (registry on Windows, launchd on macOS, autostart
 * dirs on Linux). We don't shadow it in localStorage.
 */

import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

export interface AutostartState {
  available: boolean;
  enabled: boolean;
}

export async function readAutostart(): Promise<AutostartState> {
  try {
    const enabled = await isEnabled();
    return { available: true, enabled };
  } catch {
    return { available: false, enabled: false };
  }
}

export async function writeAutostart(next: boolean): Promise<AutostartState> {
  try {
    if (next) {
      await enable();
    } else {
      await disable();
    }
    const enabled = await isEnabled();
    return { available: true, enabled };
  } catch {
    return { available: false, enabled: false };
  }
}
