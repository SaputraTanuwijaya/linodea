/**
 * Public surface for the language feature.
 *
 * `getStoredLanguage` is exposed for the notification driver
 * (entities/reminder/lib/notifications.ts) which reads the language directly
 * from storage on each poll tick. `applyLanguage` is exposed for the
 * pre-mount bootstrap in main.tsx.
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
