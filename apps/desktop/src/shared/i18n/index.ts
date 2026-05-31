/**
 * Public surface for shared/i18n.
 *
 * Anyone (features, pages, app, entities) can import from here. The language
 * picker UI and persistence live in `features/language` — that's the only
 * thing that owns *changing* the language.
 */

export { stringsFor } from "./strings";
export type { LanguageId, Strings } from "./strings";
