/**
 * Language registry + persistence.
 *
 * The Strings interface lives in `shared/i18n` because everything depends on
 * it. This file owns only the *user-changeable* side of the language: the
 * registry of available languages and the read/write of the user's choice.
 */

import type { LanguageId } from "@/shared/i18n";

export type { LanguageId };

export interface LanguageDefinition {
  id: LanguageId;
  name: string;
  description: string;
  /** Short bilingual-friendly sample shown on the picker card. */
  sample: string;
}

const STORAGE_KEY = "linodea.language.v1";
const DEFAULT_LANGUAGE: LanguageId = "en";

export const LANGUAGES: LanguageDefinition[] = [
  {
    id: "en",
    name: "English",
    description: "Interface in English. Parser breaks ties toward English.",
    sample: "tomorrow 7am tutoring with Kevin",
  },
  {
    id: "id",
    name: "Indonesian",
    description: "Antarmuka berbahasa Indonesia. Parser memilih kata Indonesia saat ragu.",
    sample: "besok jam 7 pagi les privat Kevin",
  },
];

export function getStoredLanguage(): LanguageId {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isLanguageId(stored) ? stored : DEFAULT_LANGUAGE;
}

export function persistLanguage(language: LanguageId): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, language);
}

export function applyLanguage(language: LanguageId): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
}

function isLanguageId(value: string | null): value is LanguageId {
  return value === "en" || value === "id";
}
