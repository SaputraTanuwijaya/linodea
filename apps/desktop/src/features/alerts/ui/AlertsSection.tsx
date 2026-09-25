/**
 * Alert presence picker.
 *
 * The Preview button fires a real alert window at the selected level — the only
 * honest way to judge "is this loud enough, is this big enough", which is what
 * the feedback was about. It sends a `prealert`-kind alert deliberately: a
 * prealert's single Dismiss touches no reminder state, so previewing can
 * never complete, snooze or reschedule anything.
 */

import { invoke } from "@tauri-apps/api/core";

import type { Strings } from "@/shared/i18n";
import { isTauriRuntime } from "@/shared/lib";

import { ALERT_PRESENCE_IDS, type AlertPresence } from "../model/alerts";

/** Lead time shown on the preview card. Cosmetic — nothing is scheduled. */
const PREVIEW_LEAD_MINUTES = 10;

export function AlertsSection({
  onPresenceChange,
  presence,
  strings,
}: {
  onPresenceChange: (presence: AlertPresence) => void;
  presence: AlertPresence;
  strings: Strings;
}) {
  function preview(level: AlertPresence) {
    if (!isTauriRuntime()) return;
    void invoke("show_alert", {
      payload: {
        reminderId: `preview-${level}`,
        title: strings.settings.alerts.previewTitle,
        kind: "prealert",
        leadMinutes: PREVIEW_LEAD_MINUTES,
        whenMs: Date.now() + PREVIEW_LEAD_MINUTES * 60_000,
        presence: level,
      },
    }).catch(() => undefined);
  }

  return (
    <div className="grid gap-2">
      {ALERT_PRESENCE_IDS.map((id) => {
        const isActive = id === presence;
        const localized = strings.settings.alerts.levels[id];
        return (
          <div
            className={`flex items-center gap-3 rounded-xl bg-[var(--lin-bg-hover)] p-3 transition ${
              isActive
                ? "ring-2 ring-[var(--lin-text)]"
                : "ring-1 ring-[var(--lin-border)]"
            }`}
            key={id}
          >
            <button
              aria-pressed={isActive}
              className="min-w-0 flex-1 text-left"
              onClick={() => onPresenceChange(id)}
              type="button"
            >
              <p className="truncate text-sm font-medium text-[var(--lin-text)]">
                {localized.name}
              </p>
              <p className="text-xs leading-4 text-[var(--lin-text-dim)]">
                {localized.description}
              </p>
            </button>
            <button
              className="flex-none rounded-md border border-[var(--lin-border)] px-3 py-1.5 text-xs font-medium text-[var(--lin-text)] transition hover:bg-[var(--lin-bg)]"
              onClick={() => preview(id)}
              type="button"
            >
              {strings.settings.alerts.preview}
            </button>
          </div>
        );
      })}
      <p className="pt-1 text-xs leading-4 text-[var(--lin-text-mute)]">
        {strings.settings.alerts.footnote}
      </p>
    </div>
  );
}
