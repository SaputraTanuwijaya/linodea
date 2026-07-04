/**
 * The custom Linodea confirmation window (label "confirm").
 *
 * Rust shows this small, centered, always-on-top window when the app needs a
 * yes/no decision that must survive the main window being hidden:
 *   - "quit"         — quitting stops all reminders, so ask first.
 *   - "autostart"    — first-run prompt to enable launch-on-boot (recommended).
 *   - "autostartOff" — confirm turning OFF launch-on-startup in Settings
 *                      (reduces reliability the same way quitting does).
 *
 * Themed + i18n like the rest of the app, so it replaces the native OS dialog
 * (which read as an error/system alert and broke the app's visual language).
 * The action itself lives in the main window: this page only renders the choice
 * and emits `linodea:confirm-result` for `App` to act on.
 */

import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";

import { getStoredLanguage } from "@/features/language";
import { stringsFor } from "@/shared/i18n";

const CONFIRM_EVENT = "linodea:confirm";
const RESULT_EVENT = "linodea:confirm-result";

type ConfirmKind = "quit" | "autostart" | "autostartOff";

interface ConfirmPayload {
  kind: ConfirmKind;
}

export function ConfirmPage() {
  const [kind, setKind] = useState<ConfirmKind | null>(null);
  const strings = useMemo(() => stringsFor(getStoredLanguage()), []);

  useEffect(() => {
    let mounted = true;
    let unlisten: UnlistenFn | undefined;
    void listen<ConfirmPayload>(CONFIRM_EVENT, (event) => {
      if (mounted) setKind(event.payload.kind);
    }).then((fn) => {
      if (mounted) unlisten = fn;
      else fn();
    });
    // Startup race: if `show_confirm` fired before this listener was ready (the
    // first-run autostart prompt), drain the kind Rust stashed.
    void invoke<ConfirmKind | null>("take_pending_confirm")
      .then((pending) => {
        if (mounted && pending) setKind(pending);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // Per-kind copy + which button is the recommended (emphasized, Enter) one.
  const view = useMemo(() => {
    if (kind === "quit") {
      return {
        title: strings.quitConfirm.title,
        body: strings.quitConfirm.body,
        primaryLabel: strings.quitConfirm.cancel, // "Keep running" — recommended
        primaryConfirmed: false,
        secondaryLabel: strings.quitConfirm.confirm, // "Quit anyway"
        secondaryDanger: true,
      };
    }
    if (kind === "autostart") {
      return {
        title: strings.autostartPrompt.title,
        body: strings.autostartPrompt.body,
        primaryLabel: strings.autostartPrompt.enable, // "Yes" — recommended
        primaryConfirmed: true,
        secondaryLabel: strings.autostartPrompt.notNow,
        secondaryDanger: false,
      };
    }
    if (kind === "autostartOff") {
      return {
        title: strings.disableAutostartConfirm.title,
        body: strings.disableAutostartConfirm.body,
        primaryLabel: strings.disableAutostartConfirm.keepOn, // recommended
        primaryConfirmed: false,
        secondaryLabel: strings.disableAutostartConfirm.turnOff,
        secondaryDanger: true,
      };
    }
    return null;
  }, [kind, strings]);

  function resolve(confirmed: boolean) {
    if (kind) void emit(RESULT_EVENT, { kind, confirmed });
    setKind(null);
    void invoke("dismiss_confirm").catch(() => undefined);
  }

  // Enter = recommended action; Escape = the safe/decline outcome (never quits,
  // never enables) so an accidental dismiss can't do the surprising thing.
  useEffect(() => {
    if (!view) return;
    const active = view;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") resolve(false);
      else if (event.key === "Enter") resolve(active.primaryConfirmed);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  if (!view) return null;

  return (
    <main className="flex h-screen w-screen items-stretch bg-transparent p-2">
      <div className="flex w-full flex-col justify-between gap-3 rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] px-5 py-4 shadow-2xl">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--lin-text)]">{view.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--lin-text-dim)]">
            {view.body}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            className={
              "h-8 rounded-md border border-[var(--lin-border)] px-3 text-xs font-medium transition " +
              (view.secondaryDanger
                ? "text-[var(--lin-danger)] hover:bg-[var(--lin-danger-bg)]"
                : "text-[var(--lin-text)] hover:bg-[var(--lin-bg-hover)]")
            }
            onClick={() => resolve(!view.primaryConfirmed)}
            type="button"
          >
            {view.secondaryLabel}
          </button>
          <button
            autoFocus
            className="h-8 rounded-md bg-[var(--lin-accent)] px-3 text-xs font-semibold text-[var(--lin-bg)] transition hover:opacity-90"
            onClick={() => resolve(view.primaryConfirmed)}
            type="button"
          >
            {view.primaryLabel}
          </button>
        </div>
      </div>
    </main>
  );
}
