/**
 * The custom Linodea alert window (label "alert").
 *
 * Rust shows this small, always-on-top, non-focusing window at a reminder's
 * fire time and emits `linodea:notify` with the payload. This is the primary
 * notification surface — it bypasses the OS toast (and Windows Focus Assist),
 * and renders with the app's own theme + i18n. The OS toast survives only as a
 * future app-off fallback.
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
import { formatDateTime } from "@/shared/lib";

const NOTIFY_EVENT = "linodea:notify";
const AUTO_DISMISS_MS = 8_000;
const SNOOZE_MS = 10 * 60_000;

interface AlertPayload {
  reminderId: string;
  title: string;
  kind: "due" | "prealert";
  leadMinutes?: number;
  whenMs: number;
}

export function AlertPage() {
  const [payload, setPayload] = useState<AlertPayload | null>(null);
  const strings = useMemo(() => stringsFor(getStoredLanguage()), []);

  useEffect(() => {
    let mounted = true;
    let unlisten: UnlistenFn | undefined;
    void listen<AlertPayload>(NOTIFY_EVENT, (event) => {
      setPayload(event.payload);
    }).then((fn) => {
      if (mounted) unlisten = fn;
      else fn();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!payload) return;
    const id = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload]);

  function dismiss() {
    setPayload(null);
    void invoke("dismiss_alert").catch(() => undefined);
  }

  function handleDone() {
    if (!payload) return;
    const at = new Date().toISOString();
    void updateReminderNodeStatus({
      id: payload.reminderId,
      status: "done",
      updatedAt: at,
      completedAt: at,
    }).catch(() => undefined);
    dismiss();
  }

  function handleSnooze() {
    if (!payload) return;
    clearReminderFireRecord(payload.reminderId);
    void updateReminderNodeStatus({
      id: payload.reminderId,
      status: "snoozed",
      updatedAt: new Date().toISOString(),
      snoozedUntil: new Date(Date.now() + SNOOZE_MS).toISOString(),
    }).catch(() => undefined);
    dismiss();
  }

  if (!payload) return null;

  const body =
    payload.kind === "due"
      ? strings.notificationBody.due(
          payload.title,
          formatDateTime(new Date(payload.whenMs).toISOString()),
        )
      : strings.notificationBody.prealert(payload.title, payload.leadMinutes ?? 0);

  return (
    <main className="flex h-screen w-screen items-stretch bg-transparent p-2">
      <div className="flex w-full flex-col justify-between rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] px-4 py-3 shadow-2xl">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--lin-text)]">
            {payload.title}
          </p>
          <p className="truncate text-xs text-[var(--lin-text-dim)]">{body}</p>
        </div>
        <div className="flex justify-end gap-2">
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
