/**
 * Theme registry.
 *
 * Each theme entry maps to a `[data-theme="<id>"]` block in App.css.
 * Adding a new theme:
 *   1. Add a CSS block in App.css with the eight `--lin-*` variables.
 *   2. Add a `ThemeDefinition` here with matching id + a small swatch
 *      preview used in the settings picker.
 *
 * The swatch values can mirror the CSS or diverge for hand-picked
 * preview colors; they exist only to render the picker card.
 */

export type ThemeId = "dark" | "light";

export interface ThemeSwatch {
  bg: string;
  surface: string;
  text: string;
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  swatch: ThemeSwatch;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: "dark",
    name: "Dark",
    description: "Default. Easy on the eyes for night capture.",
    swatch: {
      bg: "rgb(24 24 27)",
      surface: "rgb(39 39 42)",
      text: "rgb(244 244 245)",
    },
  },
  {
    id: "light",
    name: "Light",
    description: "Bright surface for daytime use.",
    swatch: {
      bg: "rgb(255 255 255)",
      surface: "rgb(244 244 245)",
      text: "rgb(24 24 27)",
    },
  },
];

const STORAGE_KEY = "linodea.theme.v1";
const DEFAULT_THEME: ThemeId = "dark";

export function getStoredTheme(): ThemeId {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isThemeId(stored) ? stored : DEFAULT_THEME;
}

export function persistTheme(theme: ThemeId): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, theme);
}

export function applyTheme(theme: ThemeId): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
}

function isThemeId(value: string | null): value is ThemeId {
  return value === "dark" || value === "light";
}
