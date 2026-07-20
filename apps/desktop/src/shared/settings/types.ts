/**
 * Shared settings types — the contract between features and the settings page.
 *
 * Each feature that contributes a Settings UI exports a
 * `SettingsSectionDescriptor`. The descriptor is collected in
 * `pages/settings/sectionRegistry.ts` and the SettingsPage renders them in
 * `order`.
 *
 * The bundle is the union of every feature's state + setters, passed down by
 * the SettingsPage so each section can pick what it needs without prop
 * threading at the SettingsPage level.
 *
 * Lives in `shared/` because both features (descriptors) and pages
 * (consumers) depend on it. Putting it in either would create a cycle.
 */

import type { ComponentType } from "react";

import type { AiAssistController } from "@/features/ai-assist";
import type { AppUpdateController } from "@/features/app-update";
import type { AutostartState } from "@/features/startup";
import type { LanguageId } from "@/features/language";
import type { PrealertConfig } from "@/features/prealerts";
import type { ThemeId } from "@/features/theme";
import type { Strings } from "@/shared/i18n";

/**
 * One feature's piece of the settings state: a value plus its setter.
 *
 * Setters return `void` and may be synchronous or async — features that
 * persist asynchronously (like autostart) hide that inside the setter.
 */
export interface SettingsSlot<T, U = T> {
  value: T;
  set: (next: U) => void | Promise<void>;
}

/**
 * The union of every feature's settings state, passed down once by
 * SettingsPage. Each section component pulls only what it needs.
 *
 * Adding a feature: extend this with a new slot, populate it in the bundle
 * builder where `useSettingsBundle` lives, and add the section descriptor.
 */
export interface SettingsBundle {
  strings: Strings;
  theme: SettingsSlot<ThemeId>;
  language: SettingsSlot<LanguageId>;
  prealerts: SettingsSlot<PrealertConfig>;
  autostart: SettingsSlot<AutostartState, boolean>;
  aiAssist: AiAssistController;
  appUpdate: AppUpdateController;
}

/**
 * Self-describing settings section. Each feature exports one of these.
 *
 *   - `id` is stable, used as React key and for any later persistence.
 *   - `order` controls visual position (lower = earlier). Convention: 10, 20,
 *     30, 40 with gaps so new sections can be inserted between.
 *   - `title` and `hint` are selectors so they can interpolate from strings.
 *   - `Component` is rendered inside the SettingsSection wrapper; it receives
 *     the full bundle and picks what it needs.
 */
export interface SettingsSectionDescriptor {
  id: string;
  order: number;
  title: (s: Strings) => string;
  hint: (s: Strings) => string;
  Component: ComponentType<{ bundle: SettingsBundle }>;
}
