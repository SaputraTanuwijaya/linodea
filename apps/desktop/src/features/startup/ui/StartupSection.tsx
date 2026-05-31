/**
 * Startup section UI.
 *
 * Renders inside a SettingsSection wrapper. Just the toggle row — no title,
 * no hint paragraph (those live on the section wrapper).
 */

import type { Strings } from "@/shared/i18n";

import type { AutostartState } from "../model/startup";

export function StartupSection({
  autostart,
  onChange,
  strings,
}: {
  autostart: AutostartState;
  onChange: (next: boolean) => void;
  strings: Strings;
}) {
  const { available, enabled } = autostart;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-[var(--lin-text)]">
          {strings.startup.toggleLabel}
        </p>
        <p className="mt-0.5 text-xs text-[var(--lin-text-mute)]">
          {available ? strings.startup.toggleHint : strings.startup.unavailable}
        </p>
      </div>
      <button
        aria-checked={enabled}
        aria-label={strings.startup.toggleLabel}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-[var(--lin-border)] transition-colors ${
          enabled ? "bg-[var(--lin-accent)]" : "bg-[var(--lin-text-mute)]"
        } ${available ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
        disabled={!available}
        onClick={() => onChange(!enabled)}
        role="switch"
        type="button"
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-[var(--lin-bg)] shadow-sm transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
