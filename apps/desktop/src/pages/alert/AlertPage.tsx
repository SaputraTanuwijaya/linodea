/**
 * The custom Linodea alert window (label "alert").
 *
 * Rust shows this small, always-on-top, non-focusing window at a reminder's
 * fire time and emits `linodea:notify` with the payload. This is the primary
 * notification surface — it bypasses the OS toast (and Windows Focus Assist),
 * and renders with the app's own theme + i18n.
 *
 * Notifications are QUEUED, not overwritten: a prealert and its due fire can
 * land in the same scheduler pass (microseconds apart) — without a queue the
 * due would clobber the prealert before it was ever seen. We show one card at
 * a time and advance on dismiss / Done / Snooze, hiding the window only once
 * the queue drains.
 *
 * Actions depend on `kind`. A DUE fire is the real notification, so it offers
 * Done + Snooze (reusing the reminder status command; Snooze also clears the
 * fire-dedupe record so the reminder re-fires at the new time). A PREALERT is
 * only a heads-up — it must not move or complete the real reminder — so it
 * offers a single Dismiss that just closes the card (same effect as the
 * auto-dismiss). The reminder still fires at its actual due time.
 *
 * Dwell/sound policy: a fired reminder is never completed automatically, so
 * these buttons are the ONLY way it gets marked done — the card has to
 * survive long enough to actually reach. It pauses entirely while the pointer
 * is over it so it can't vanish mid-reach, and any hover silences the
 * remaining pings: once you've clearly seen it, it shuts up.
 *
 * How long it stays, how loud and how often it pings, and how big the type is
 * all come from the payload's `presence` — one user-facing dial, since
 * early feedback was that the card was both too quiet and too small to work as
 * a reminder. Rust sizes the window from the same value.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";

import { clearReminderFireRecord, updateReminderNodeStatus } from "@/entities/reminder";
import { alertProfile, type AlertPresence } from "@/features/alerts";
import { getStoredLanguage } from "@/features/language";
import { stringsFor } from "@/shared/i18n";
import { formatDateTime, playUiSound, useTauriEvent } from "@/shared/lib";

const NOTIFY_EVENT = "linodea:notify";
const SNOOZE_MS = 10 * 60_000;
const MAX_QUEUE = 8;

interface AlertPayload {
  reminderId: string;
  title: string;
  kind: "due" | "prealert";
  leadMinutes?: number;
  whenMs: number;
  /** Absent on an alert queued before this shipped; `alertProfile` defaults. */
  presence?: AlertPresence;
}

export function AlertPage() {
  const [queue, setQueue] = useState<AlertPayload[]>([]);
  // True while the pointer rests on the card: freezes the auto-dismiss so the
  // window cannot disappear out from under a click in progress.
  const [paused, setPaused] = useState(false);
  const pingTimersRef = useRef<number[]>([]);
  const strings = useMemo(() => stringsFor(getStoredLanguage()), []);
  const current = queue[0];
  // Per-card, not per-window: a queued alert keeps the presence it was fired
  // with even if the setting changed while it waited.
  const profile = alertProfile(current?.presence);

  /** Cancel any pings not yet played. Called once the user clearly has seen it. */
  function silencePings() {
    pingTimersRef.current.forEach((id) => window.clearTimeout(id));
    pingTimersRef.current = [];
  }

  useTauriEvent<AlertPayload>(NOTIFY_EVENT, (payload) => {
    setQueue((q) => [...q, payload].slice(-MAX_QUEUE));
  });

  // A new card at the head of the queue starts un-paused, even if a stale
  // pointer-enter never got its matching leave (the window can hide mid-hover).
  useEffect(() => {
    setPaused(false);
  }, [current]);

  // Sound: ping on show, then up to twice more. Cleared when the card advances
  // or the user interacts. Kept separate from the dismiss timer below so that
  // pausing on hover doesn't restart the ping sequence from zero.
  useEffect(() => {
    if (!current) return;
    const { pingRepeatMs, volume } = alertProfile(current.presence);
    playUiSound("notification", volume);
    const ids = pingRepeatMs.map((delay) =>
      window.setTimeout(() => playUiSound("notification", volume), delay),
    );
    pingTimersRef.current = ids;
    return () => {
      ids.forEach((id) => window.clearTimeout(id));
      pingTimersRef.current = [];
    };
  }, [current]);

  // Drive auto-dismiss off the head of the queue. When the queue drains, hide
  // the window (Rust shows it again on the next fire). Hovering suspends the
  // countdown; leaving restarts it with a full window rather than a remainder,
  // which is the forgiving choice when the buttons are the only way to complete.
  useEffect(() => {
    if (!current) {
      void invoke("dismiss_alert").catch(() => undefined);
      return;
    }
    if (paused) return;
    const id = window.setTimeout(
      () => setQueue((q) => q.slice(1)),
      alertProfile(current.presence).dwellMs,
    );
    return () => window.clearTimeout(id);
  }, [current, paused]);

  function advance() {
    setQueue((q) => q.slice(1));
  }

  // Prealerts are informational: dismissing just closes the card, leaving the
  // reminder's status/schedule untouched so it still fires at its due time.
  function handleDismiss() {
    advance();
  }

  function handleDone() {
    if (!current) return;
    const at = new Date().toISOString();
    void updateReminderNodeStatus({
      id: current.reminderId,
      status: "done",
      updatedAt: at,
      completedAt: at,
    }).catch(() => undefined);
    advance();
  }

  function handleSnooze() {
    if (!current) return;
    void clearReminderFireRecord(current.reminderId);
    void updateReminderNodeStatus({
      id: current.reminderId,
      status: "snoozed",
      updatedAt: new Date().toISOString(),
      snoozedUntil: new Date(Date.now() + SNOOZE_MS).toISOString(),
    }).catch(() => undefined);
    advance();
  }

  if (!current) return null;

  const body =
    current.kind === "due"
      ? strings.notificationBody.due(
          formatDateTime(new Date(current.whenMs).toISOString()),
        )
      : strings.notificationBody.prealert(current.leadMinutes ?? 0);

  return (
    <main className="flex h-screen w-screen items-stretch bg-transparent p-2">
      <div
        // Centered with a fixed gap rather than spread to the edges: at the
        // larger sizes `justify-between` left a dead band between the text and
        // the buttons, which read as a broken card rather than a bigger one.
        className={`flex w-full flex-col justify-center gap-3 rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] shadow-2xl ${profile.padClass}`}
        onPointerEnter={() => {
          silencePings();
          setPaused(true);
        }}
        onPointerLeave={() => setPaused(false)}
      >
        <div className="min-w-0">
          <p
            className={`text-[var(--lin-text)] ${profile.titleClampClass} ${profile.titleClass}`}
          >
            {current.title}
          </p>
          <p className={`truncate text-[var(--lin-text-dim)] ${profile.bodyClass}`}>
            {body}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2.5">
          {queue.length > 1 ? (
            <span className={`mr-auto text-[var(--lin-text-mute)] ${profile.bodyClass}`}>
              +{queue.length - 1}
            </span>
          ) : null}
          {current.kind === "prealert" ? (
            // A prealert is a heads-up — a single Dismiss that touches nothing.
            <button
              className={`rounded-md border border-[var(--lin-border)] font-medium text-[var(--lin-text)] transition hover:bg-[var(--lin-bg-hover)] ${profile.buttonClass}`}
              onClick={handleDismiss}
              type="button"
            >
              {strings.list.dismiss}
            </button>
          ) : (
            // Done carries the accent fill: it is the primary action, and making
            // the two visually distinct (not just adjacent grey twins) is half
            // of what makes them easier to hit correctly under time pressure.
            <>
              <button
                className={`rounded-md border border-[var(--lin-border)] font-medium text-[var(--lin-text)] transition hover:bg-[var(--lin-bg-hover)] ${profile.buttonClass}`}
                onClick={handleSnooze}
                type="button"
              >
                {strings.list.snooze}
              </button>
              <button
                className={`rounded-md bg-[var(--lin-accent)] font-semibold text-[var(--lin-bg)] transition hover:opacity-90 ${profile.buttonClass}`}
                onClick={handleDone}
                type="button"
              >
                {strings.list.done}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
