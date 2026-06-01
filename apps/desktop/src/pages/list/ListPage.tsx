/**
 * The reminders list mode.
 *
 * Owns its own data: fetches on mount and whenever `refreshKey` changes
 * (App.tsx bumps it after a capture save so an open list reflects the new
 * row immediately).
 *
 * Per-row lifecycle actions: Done, Snooze (presets), Edit (inline re-parse of
 * the raw text through the same parser as capture), Delete. After any mutation
 * it refetches and calls `onMutate` so App can re-sync the notification
 * scheduler (fire times may have changed).
 *
 * Stop-gap surface — the lifecycle *commands* are permanent, but this list UI
 * is replaced by the linked-list chain view in Phase 2.
 */

import { parseReminder } from "@linodea/parser";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  byScheduledAt,
  clearReminderFireRecord,
  deleteReminderNode,
  isActionable,
  listReminderNodes,
  updateReminderNode,
  updateReminderNodeStatus,
} from "@/entities/reminder";
import type { LanguageId } from "@/features/language";
import type { ReminderNode } from "@linodea/types";
import type { Strings } from "@/shared/i18n";
import { formatDateTime, isTauriRuntime } from "@/shared/lib";

type RowMode = "snooze" | "edit";
interface RowAction {
  id: string;
  mode: RowMode;
}

export function ListPage({
  language,
  onMutate,
  refreshKey,
  strings,
}: {
  /** Parser tie-break preference, mirrored from capture, used for inline edit. */
  language: LanguageId;
  /** Called after any successful mutation so App can re-sync the scheduler. */
  onMutate?: () => void;
  /** Bumping this triggers a refetch — used after a save in capture mode. */
  refreshKey: number;
  strings: Strings;
}) {
  const [reminders, setReminders] = useState<ReminderNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [rowAction, setRowAction] = useState<RowAction | null>(null);
  const [editText, setEditText] = useState("");

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setIsLoading(true);
    try {
      const all = await listReminderNodes();
      setReminders(all.filter(isActionable).sort(byScheduledAt));
    } catch {
      // Silent.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  // Live parse of the edit text so Save can be blocked when there's no time.
  const editParsedAt = useMemo(
    () =>
      editText.trim()
        ? parseReminder(editText, { preferredLanguage: language }).draft.scheduledAt
        : undefined,
    [editText, language],
  );

  async function runMutation(id: string, mutate: () => Promise<unknown>) {
    if (!isTauriRuntime()) return;
    setBusyId(id);
    try {
      await mutate();
      setRowAction(null);
      await refresh();
      onMutate?.();
    } catch {
      // Silent.
    } finally {
      setBusyId(undefined);
    }
  }

  function handleMarkDone(reminder: ReminderNode) {
    const completedAt = new Date().toISOString();
    void runMutation(reminder.id, () =>
      updateReminderNodeStatus({
        id: reminder.id,
        status: "done",
        updatedAt: completedAt,
        completedAt,
      }),
    );
  }

  function handleSnooze(reminder: ReminderNode, snoozedUntil: string) {
    // Clear the fire dedupe so an already-fired reminder re-fires at the new time.
    clearReminderFireRecord(reminder.id);
    void runMutation(reminder.id, () =>
      updateReminderNodeStatus({
        id: reminder.id,
        status: "snoozed",
        updatedAt: new Date().toISOString(),
        snoozedUntil,
      }),
    );
  }

  function handleDelete(reminder: ReminderNode) {
    void runMutation(reminder.id, () => deleteReminderNode(reminder.id));
  }

  function handleSaveEdit(reminder: ReminderNode) {
    const parsed = parseReminder(editText, { preferredLanguage: language });
    if (!parsed.draft.scheduledAt) return;
    void runMutation(reminder.id, () =>
      updateReminderNode({
        id: reminder.id,
        title: parsed.draft.title,
        rawInput: parsed.rawInput,
        scheduledAt: parsed.draft.scheduledAt!,
        timezone: parsed.draft.timezone,
        type: parsed.draft.type,
        category: parsed.draft.category,
        checklist: parsed.draft.checklist,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  function beginEdit(reminder: ReminderNode) {
    setEditText(reminder.rawInput);
    setRowAction({ id: reminder.id, mode: "edit" });
  }

  return (
    <section className="mt-3 rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] px-4 py-3 shadow-2xl backdrop-blur transition-colors">
      <header className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--lin-text-dim)]">
          {strings.list.queued}
        </p>
        <p className="text-xs text-[var(--lin-text-mute)]">
          {strings.list.pending(reminders.length)}
        </p>
      </header>
      {isLoading && reminders.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-[var(--lin-text-mute)]">
          {strings.list.loading}
        </p>
      ) : reminders.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-[var(--lin-text-mute)]">
          {strings.list.empty}
        </p>
      ) : (
        <ul className="max-h-[280px] overflow-y-auto">
          {reminders.map((reminder, index) => {
            const isBusy = busyId === reminder.id;
            const active = rowAction?.id === reminder.id ? rowAction.mode : null;
            const rowBorder = index > 0 ? "border-t border-[var(--lin-border)]" : "";

            if (active === "edit") {
              return (
                <li className={`flex items-center gap-2 px-1 py-2 ${rowBorder}`} key={reminder.id}>
                  <input
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    autoFocus
                    className="min-w-0 flex-1 rounded-md border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-2 py-1 text-sm text-[var(--lin-text)] outline-none"
                    onChange={(event) => setEditText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && editParsedAt) handleSaveEdit(reminder);
                      if (event.key === "Escape") setRowAction(null);
                    }}
                    placeholder={strings.list.editPlaceholder}
                    spellCheck={false}
                    value={editText}
                  />
                  <RowButton
                    disabled={isBusy || !editParsedAt}
                    label={strings.list.save}
                    onClick={() => handleSaveEdit(reminder)}
                  />
                  <RowButton
                    label={strings.list.cancel}
                    onClick={() => setRowAction(null)}
                  />
                </li>
              );
            }

            if (active === "snooze") {
              return (
                <li className={`flex items-center gap-2 px-1 py-2 ${rowBorder}`} key={reminder.id}>
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--lin-text-dim)]">
                    {strings.list.snooze}
                  </span>
                  <RowButton
                    disabled={isBusy}
                    label={strings.list.snooze10m}
                    onClick={() => handleSnooze(reminder, snoozePreset("10m"))}
                  />
                  <RowButton
                    disabled={isBusy}
                    label={strings.list.snooze1h}
                    onClick={() => handleSnooze(reminder, snoozePreset("1h"))}
                  />
                  <RowButton
                    disabled={isBusy}
                    label={strings.list.snoozeTomorrow}
                    onClick={() => handleSnooze(reminder, snoozePreset("tomorrow"))}
                  />
                  <RowButton
                    label={strings.list.cancel}
                    onClick={() => setRowAction(null)}
                  />
                </li>
              );
            }

            return (
              <li className={`flex items-center gap-2 px-1 py-2 ${rowBorder}`} key={reminder.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--lin-text)]">
                    {reminder.title}
                  </p>
                  <p className="truncate text-xs text-[var(--lin-text-dim)]">
                    {formatDateTime(reminder.snoozedUntil ?? reminder.scheduledAt)}
                  </p>
                </div>
                <RowButton
                  disabled={isBusy}
                  label={isBusy ? "..." : strings.list.done}
                  onClick={() => handleMarkDone(reminder)}
                />
                <RowButton
                  disabled={isBusy}
                  label={strings.list.snooze}
                  onClick={() => setRowAction({ id: reminder.id, mode: "snooze" })}
                />
                <RowButton
                  disabled={isBusy}
                  label={strings.list.edit}
                  onClick={() => beginEdit(reminder)}
                />
                <RowButton
                  danger
                  disabled={isBusy}
                  label={strings.list.delete}
                  onClick={() => handleDelete(reminder)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RowButton({
  danger,
  disabled,
  label,
  onClick,
}: {
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  const tint = danger
    ? "text-[var(--lin-danger)] hover:bg-[var(--lin-danger-bg)]"
    : "text-[var(--lin-text)] hover:bg-[var(--lin-bg-hover)]";
  return (
    <button
      className={`h-7 shrink-0 rounded-md border border-[var(--lin-border)] px-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${tint}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

/** Compute an ISO `snoozedUntil` for a preset, relative to now (local time). */
function snoozePreset(preset: "10m" | "1h" | "tomorrow"): string {
  const now = new Date();
  if (preset === "10m") return new Date(now.getTime() + 10 * 60_000).toISOString();
  if (preset === "1h") return new Date(now.getTime() + 60 * 60_000).toISOString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow.toISOString();
}
