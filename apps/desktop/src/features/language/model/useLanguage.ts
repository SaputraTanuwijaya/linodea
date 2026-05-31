/**
 * Language state hook.
 *
 * Initial value comes from localStorage so the first render already has the
 * user's choice. Setter applies the `<html lang>` attribute and persists.
 *
 * Note: `main.tsx` also calls `applyLanguage(getStoredLanguage())` before
 * React mounts to avoid a flash. This hook handles the runtime side.
 */

import { useCallback, useState } from "react";

import {
  applyLanguage,
  getStoredLanguage,
  persistLanguage,
  type LanguageId,
} from "./language";

export function useLanguage() {
  const [language, setLanguageState] = useState<LanguageId>(() =>
    getStoredLanguage(),
  );

  const setLanguage = useCallback((next: LanguageId) => {
    applyLanguage(next);
    persistLanguage(next);
    setLanguageState(next);
  }, []);

  return [language, setLanguage] as const;
}
