/**
 * Updates section UI.
 *
 * Renders inside a SettingsSection wrapper — no title, no hint paragraph
 * (those live on the section wrapper).
 */

import type { Strings } from "@/shared/i18n";

import type { AppUpdateController } from "../model/types";

export function AppUpdateSection({
  controller,
  strings,
}: {
  controller: AppUpdateController;
  strings: Strings;
}) {
  const { phase, supported, currentVersion } = controller.state;
  const busy = phase === "checking" || phase === "downloading";

  return (
    <div className="grid gap-3">
      <div className="rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-3 py-2.5">
        <p className="text-sm text-[var(--lin-text)]">
          {statusText(controller, strings)}
        </p>
        {currentVersion ? (
          <p className="mt-0.5 text-xs text-[var(--lin-text-mute)]">
            {strings.update.currentVersion(currentVersion)}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className="rounded-md bg-[var(--lin-accent)] px-3 py-2 text-xs font-medium text-[var(--lin-bg)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!supported || busy}
          onClick={() => void controller.check()}
          type="button"
        >
          {phase === "checking"
            ? strings.update.checking
            : strings.update.checkButton}
        </button>

        {phase === "available" ? (
          <button
            className="rounded-md border border-[var(--lin-border)] px-3 py-2 text-xs font-medium text-[var(--lin-text)] transition hover:bg-[var(--lin-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void controller.install()}
            type="button"
          >
            {strings.update.installButton}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function statusText(
  { state }: AppUpdateController,
  strings: Strings,
): string {
  if (!state.supported) return strings.update.unavailable;
  switch (state.phase) {
    case "checking":
      return strings.update.checking;
    case "available":
      return strings.update.available(state.nextVersion ?? "");
    case "upToDate":
      return strings.update.upToDate;
    case "downloading":
      return strings.update.downloading;
    case "error":
      return strings.update.error;
    case "idle":
      // Nothing checked yet this session — the version line below carries the
      // only fact we actually have.
      return strings.update.notCheckedYet;
  }
}
