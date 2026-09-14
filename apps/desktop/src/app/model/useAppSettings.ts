/**
 * Composes every feature-state hook into the one `SettingsBundle` that
 * SettingsPage renders from, plus the handful of values the popup shell itself
 * needs (strings, the active language, AI Assist, the update badge).
 *
 * Lives in `app/` because composing features *is* orchestration — no other
 * layer is allowed to import from all of `features/` at once.
 *
 * Adding a settings feature means adding its hook here plus a registry entry in
 * `pages/settings/sectionRegistry.ts` — never a new `useState` in App.tsx.
 */

import { useMemo } from "react";

import { useAiAssist } from "@/features/ai-assist";
import { useAlertPresence } from "@/features/alerts";
import { useAppUpdate } from "@/features/app-update";
import { useLanguage } from "@/features/language";
import { usePhoneLink } from "@/features/phone-link";
import { usePrealerts } from "@/features/prealerts";
import { useAutostart } from "@/features/startup";
import { useTheme } from "@/features/theme";
import { stringsFor } from "@/shared/i18n";
import type { SettingsBundle } from "@/shared/settings";

export function useAppSettings() {
  const [theme, setTheme] = useTheme();
  const [language, setLanguage] = useLanguage();
  const [prealertConfig, setPrealertConfig] = usePrealerts();
  const [alertPresence, setAlertPresence] = useAlertPresence();
  const [autostart, setAutostart] = useAutostart();
  // Fed the prealert offsets so the phone raises the same set of alerts this
  // machine does; Rust cannot read them from localStorage on its own.
  const phoneLink = usePhoneLink(
    prealertConfig.offsets.map((offset) => offset.minutes),
  );
  const aiAssist = useAiAssist();
  // Owns its own background check + download. Nothing here drives it; the shell
  // only reads "ready" to badge the ••• button, and the Settings panel does the
  // rest.
  const appUpdate = useAppUpdate();

  const strings = useMemo(() => stringsFor(language), [language]);

  // Build the bundle once per state change so SettingsPage gets a stable
  // reference per render and the registry can render each section uniformly.
  const bundle = useMemo<SettingsBundle>(
    () => ({
      strings,
      theme: { value: theme, set: setTheme },
      language: { value: language, set: setLanguage },
      prealerts: { value: prealertConfig, set: setPrealertConfig },
      alertPresence: { value: alertPresence, set: setAlertPresence },
      autostart: { value: autostart, set: setAutostart },
      aiAssist,
      phoneLink,
      appUpdate,
    }),
    [
      strings,
      theme,
      setTheme,
      language,
      setLanguage,
      prealertConfig,
      setPrealertConfig,
      alertPresence,
      setAlertPresence,
      autostart,
      setAutostart,
      aiAssist,
      phoneLink,
      appUpdate,
    ],
  );

  return {
    bundle,
    strings,
    language,
    aiAssist,
    /** Needed by the confirm-result routing, which applies the user's answer. */
    setAutostart,
    updateReady: appUpdate.state.phase === "ready",
  };
}
