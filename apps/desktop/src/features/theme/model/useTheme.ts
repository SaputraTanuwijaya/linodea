/**
 * Theme state hook.
 *
 * Initial value comes from localStorage so the first render already has the
 * user's choice. Setter applies the data attribute and persists.
 *
 * Note: `main.tsx` also calls `applyTheme(getStoredTheme())` before React
 * mounts to avoid FOUC. This hook handles the runtime side.
 */

import { useCallback, useState } from "react";

import {
  applyTheme,
  getStoredTheme,
  persistTheme,
  type ThemeId,
} from "./themes";

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => getStoredTheme());

  const setTheme = useCallback((next: ThemeId) => {
    applyTheme(next);
    persistTheme(next);
    setThemeState(next);
  }, []);

  return [theme, setTheme] as const;
}
