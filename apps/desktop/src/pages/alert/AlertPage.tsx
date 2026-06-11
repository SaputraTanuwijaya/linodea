/**
 * The custom Linodea alert window (label "alert").
 *
 * Rust shows this small, always-on-top, non-focusing window at a reminder's
 * fire time and emits `linodea:notify` with the payload. This is the primary
 * notification surface — it bypasses the OS toast (and Windows Focus Assist),
 * and renders with the app's own theme + i18n. The OS toast survives only as a
 * future app-off fallback.
 *
 * Notifications are QUEUED, not overwritten: a prealert and its due fire can
 * land in the same scheduler pass (microseconds apart) — without a queue the
 * due would clobber the prealert before it was ever seen. We show one card at
 * a time and advance on dismiss / Done / Snooze, hiding the window only once
 * the queue drains.
 *
 * Buttons reuse the existing reminder status command; Snooze also clears the
 * fire-dedupe record so a since-fired reminder re-fires at the new time.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";

import { clearReminderFireRecord, updateReminderNodeStatus } from "@/entities/reminder";
import { getStoredLanguage } from "@/features/language";
import { stringsFor } from "@/shared/i18n";
import { formatDateTime, playUiSound } from "@/shared/lib";

const NOTIFY_EVENT = "linodea:notify";
const AUTO_DISMISS_MS = 8_000;
const SNOOZE_MS = 10 * 60_000;
const MAX_QUEUE = 8;

interface AlertPayload {
  reminderId: string;
  title: string;
  kind: "due" | "prealert";
  leadMinutes?: number;
  whenMs: number;
}

export function AlertPage() {
  const [queue, setQueue] = useState<AlertPayload[]>([]);
  const strings = useMemo(() => stringsFor(getStoredLanguage()), []);
  const current = queue[0];

  useEffect(() => {
    let mounted = true;
    let unlisten: UnlistenFn | undefined;
    void listen<AlertPayload>(NOTIFY_EVENT, (event) => {
      setQueue((q) => [...q, event.payload].slice(-MAX_QUEUE));
    }).then((fn) => {
      if (mounted) unlisten = fn;
      else fn();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // Drive auto-dismiss off the head of the queue. When the queue drains, hide
  // the window (Rust shows it again on the next fire).
  useEffect(() => {
    if (!current) {
      void invoke("dismiss_alert").catch(() => undefined);
      return;
    }
    playUiSound("notification");
    const id = window.setTimeout(() => setQueue((q) => q.slice(1)), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [current]);

  function advance() {
    setQueue((q) => q.slice(1));
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
    clearReminderFireRecord(current.reminderId);
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
          current.title,
          formatDateTime(new Date(current.whenMs).toISOString()),
        )
      : strings.notificationBody.prealert(current.title, current.leadMinutes ?? 0);

  return (
    <main className="flex h-screen w-screen items-stretch bg-transparent p-2">
      <div className="flex w-full flex-col justify-between rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] px-4 py-3 shadow-2xl">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--lin-text)]">
            {current.title}
          </p>
          <p className="truncate text-xs text-[var(--lin-text-dim)]">{body}</p>
        </div>
        <div className="flex items-center justify-end gap-2">
          {queue.length > 1 ? (
            <span className="mr-auto text-xs text-[var(--lin-text-mute)]">
              +{queue.length - 1}
            </span>
          ) : null}
          <button
            className="h-7 rounded-md border border-[var(--lin-border)] px-2.5 text-xs font-medium text-[var(--lin-text)] transition hover:bg-[var(--lin-bg-hover)]"
            onClick={handleSnooze}
            type="button"
          >
            {strings.list.snooze}
          </button>
          <button
            className="h-7 rounded-md border border-[var(--lin-border)] px-2.5 text-xs font-medium text-[var(--lin-text)] transition hover:bg-[var(--lin-bg-hover)]"
            onClick={handleDone}
            type="button"
          >
            {strings.list.done}
          </button>
        </div>
      </div>
    </main>
  );
}
