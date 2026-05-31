/**
 * The reminders list mode.
 *
 * Owns its own data: fetches on mount and whenever `refreshKey` changes
 * (App.tsx bumps it after a capture save so an open list reflects the new
 * row immediately).
 *
 * Stop-gap surface — replaced by the linked-list chain view in Phase 2.
 */

import { useCallback, useEffect, useState } from "react";

import {
  byScheduledAt,
  isActionable,
  listReminderNodes,
  updateReminderNodeStatus,
} from "@/entities/reminder";
import type { ReminderNode } from "@linodea/types";
import type { Strings } from "@/shared/i18n";
import { formatDateTime, isTauriRuntime } from "@/shared/lib";

export function ListPage({
  refreshKey,
  strings,
}: {
  /** Bumping this triggers a refetch — used after a save in capture mode. */
  refreshKey: number;
  strings: Strings;
}) {
  const [reminders, setReminders] = useState<ReminderNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [updatingReminderId, setUpdatingReminderId] = useState<string>();

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

  async function handleMarkDone(reminder: ReminderNode) {
    if (!isTauriRuntime()) return;

    const completedAt = new Date().toISOString();
    setUpdatingReminderId(reminder.id);
    try {
      await updateReminderNodeStatus({
        id: reminder.id,
        status: "done",
        updatedAt: completedAt,
        completedAt,
      });
      await refresh();
    } catch {
      // Silent.
    } finally {
      setUpdatingReminderId(undefined);
    }
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
          {reminders.map((reminder, index) => (
            <li
              className={`flex items-center gap-3 px-1 py-2 ${
                index > 0 ? "border-t border-[var(--lin-border)]" : ""
              }`}
              key={reminder.id}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--lin-text)]">
                  {reminder.title}
                </p>
                <p className="truncate text-xs text-[var(--lin-text-dim)]">
                  {formatDateTime(reminder.scheduledAt)}
                </p>
              </div>
              <button
                className="h-7 shrink-0 rounded-md border border-[var(--lin-border)] px-2.5 text-xs font-medium text-[var(--lin-text)] transition hover:bg-[var(--lin-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={updatingReminderId === reminder.id}
                onClick={() => handleMarkDone(reminder)}
                type="button"
              >
                {updatingReminderId === reminder.id ? "..." : strings.list.done}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
