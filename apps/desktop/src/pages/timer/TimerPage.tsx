/**
 * The on-screen countdown timer window (label "timer").
 *
 * Rust shows this small, transparent, always-on-top, non-focusing window at the
 * bottom-right when a `/countdown` reminder is captured, emitting `linodea:timer`
 * with `{ title, targetMs }`. A 1s tick renders the remaining time down to zero;
 * because the window is visible, its interval isn't WebView-throttled.
 *
 * It is purely a display: the reminder scheduler still owns firing the alert at
 * the exact instant. At zero the window just hides itself; `✕` dismisses early
 * (the reminder still fires). A new `/countdown` replaces the shown timer.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";

import { getStoredLanguage } from "@/features/language";
import { stringsFor } from "@/shared/i18n";

const TIMER_EVENT = "linodea:timer";

interface TimerPayload {
  title: string;
  targetMs: number;
}

export function TimerPage() {
  const [timer, setTimer] = useState<TimerPayload | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const strings = useMemo(() => stringsFor(getStoredLanguage()), []);

  // Receive new countdowns. A fresh one replaces whatever is showing.
  useEffect(() => {
    let mounted = true;
    let unlisten: UnlistenFn | undefined;
    void listen<TimerPayload>(TIMER_EVENT, (event) => {
      setTimer(event.payload);
      setNow(Date.now());
    }).then((fn) => {
      if (mounted) unlisten = fn;
      else fn();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // Tick once a second while a timer is active.
  useEffect(() => {
    if (!timer) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [timer]);

  const remainingMs = timer ? timer.targetMs - now : 0;

  // Hide once the countdown reaches zero — the scheduler fires the alert.
  useEffect(() => {
    if (timer && remainingMs <= 0) {
      setTimer(null);
      void invoke("dismiss_timer").catch(() => undefined);
    }
  }, [timer, remainingMs]);

  if (!timer || remainingMs <= 0) return null;

  function dismiss() {
    setTimer(null);
    void invoke("dismiss_timer").catch(() => undefined);
  }

  return (
    <main className="flex h-screen w-screen items-stretch bg-transparent p-2">
      <div className="flex w-full flex-col justify-between rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] px-4 py-3 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-[var(--lin-text-mute)]">
            {strings.timer.caption}
          </span>
          <button
            aria-label={strings.timer.dismiss}
            className="text-xs leading-none text-[var(--lin-text-dim)] transition hover:text-[var(--lin-text)]"
            onClick={dismiss}
            type="button"
          >
            ✕
          </button>
        </div>
        <p className="text-center font-mono text-3xl font-semibold tabular-nums text-[var(--lin-text)]">
          {formatRemaining(remainingMs)}
        </p>
        <p className="truncate text-center text-xs text-[var(--lin-text-dim)]">
          {timer.title}
        </p>
      </div>
    </main>
  );
}

/** `H:MM:SS` when there are hours, otherwise `MM:SS`. */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
