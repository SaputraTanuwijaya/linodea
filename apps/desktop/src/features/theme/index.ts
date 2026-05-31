/**
 * Public surface for the theme feature.
 */

export {
  applyTheme,
  getStoredTheme,
  THEMES,
  type ThemeDefinition,
  type ThemeId,
} from "./model/themes";
export { useTheme } from "./model/useTheme";
export { ThemeSection } from "./ui/ThemeSection";
