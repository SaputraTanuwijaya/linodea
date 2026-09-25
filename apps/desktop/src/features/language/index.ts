/**
 * Public surface for the language feature.
 *
 * `getStoredLanguage` is exposed for the alert, timer and confirm windows,
 * which read the language directly from storage. `applyLanguage` is exposed
 * for the pre-mount bootstrap in main.tsx.
 */

export {
  applyLanguage,
  getStoredLanguage,
  LANGUAGES,
  type LanguageDefinition,
  type LanguageId,
} from "./model/language";
export { useLanguage } from "./model/useLanguage";
export { LanguageSection } from "./ui/LanguageSection";
export { languageSettingsSection } from "./settingsSection";
