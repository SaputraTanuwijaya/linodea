import { invoke } from "@tauri-apps/api/core";
import { parseReminder } from "@linodea/parser";
import type {
  ReminderNode,
  ReminderParseResult,
  ReminderStatus,
} from "@linodea/types";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import "./App.css";

const DEVICE_ID_STORAGE_KEY = "linodea.deviceId";

interface ReminderStatusPatch {
  id: string;
  status: ReminderStatus;
  updatedAt: string;
  completedAt?: string;
  snoozedUntil?: string;
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [reminders, setReminders] = useState<ReminderNode[]>([]);
  const [dueReminderCount, setDueReminderCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Local storage is idle.");
  const [isSaving, setIsSaving] = useState(false);
  const [updatingReminderId, setUpdatingReminderId] = useState<string>();

  const parsedReminder = useMemo(
    () => (input.trim() ? parseReminder(input) : undefined),
    [input],
  );
  const canSave = Boolean(parsedReminder?.draft.scheduledAt && input.trim());
  const visibleReminders = reminders.slice(0, 6);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setStatusMessage("Run the Tauri desktop app to save reminders locally.");
      return;
    }

    void refreshLocalData(setReminders, setDueReminderCount, setStatusMessage);
  }, []);

  useEffect(() => {
    function handleWindowFocus() {
      focusCaptureInput(inputRef.current);
    }

    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, []);

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();

    if (input.length > 0) {
      setInput("");
      setStatusMessage("Capture cleared.");
      return;
    }

    void hideMainWindow(setStatusMessage);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!parsedReminder) {
      focusCaptureInput(inputRef.current);
      return;
    }

    if (!parsedReminder.draft.scheduledAt) {
      setStatusMessage("Add a reminder time before saving.");
      focusCaptureInput(inputRef.current);
      return;
    }

    if (!isTauriRuntime()) {
      setStatusMessage("Parser preview is ready; saving needs the desktop runtime.");
      focusCaptureInput(inputRef.current);
      return;
    }

    setIsSaving(true);
    setStatusMessage("Saving reminder...");

    try {
      const reminder = createReminderNode(parsedReminder, getDeviceId());
      await invoke<ReminderNode>("create_reminder_node", { reminder });
      setInput("");
      await refreshLocalData(
        setReminders,
        setDueReminderCount,
        setStatusMessage,
        "Reminder saved locally.",
      );
      await hideMainWindow(setStatusMessage);
      focusCaptureInput(inputRef.current);
    } catch (error) {
      setStatusMessage(toDisplayError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleMarkDone(reminder: ReminderNode) {
    if (!isTauriRuntime()) {
      setStatusMessage("Status updates need the desktop runtime.");
      return;
    }

    const completedAt = new Date().toISOString();
    const patch: ReminderStatusPatch = {
      id: reminder.id,
      status: "done",
      updatedAt: completedAt,
      completedAt,
    };

    setUpdatingReminderId(reminder.id);
    setStatusMessage("Updating reminder...");

    try {
      await invoke<ReminderNode>("update_reminder_node_status", { patch });
      await refreshLocalData(
        setReminders,
        setDueReminderCount,
        setStatusMessage,
        "Reminder marked done.",
      );
    } catch (error) {
      setStatusMessage(toDisplayError(error));
    } finally {
      setUpdatingReminderId(undefined);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-100 text-zinc-950">
      <section className="mx-auto grid min-h-screen w-full max-w-3xl content-start gap-6 px-5 py-8 sm:py-12">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-cyan-700">Linodea</p>
            <h1 className="text-2xl font-semibold leading-tight">
              Quick capture
            </h1>
          </div>
          <p className="text-sm text-zinc-500">
            {reminders.length} local / {dueReminderCount} due
          </p>
        </header>

        <form
          className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm"
          onSubmit={handleSubmit}
        >
          <div className="border-b border-zinc-200 p-4">
            <label className="sr-only" htmlFor="quick-capture-input">
              Reminder
            </label>
            <input
              autoFocus
              className="h-14 w-full border-0 bg-white text-lg font-medium outline-none placeholder:text-zinc-400"
              id="quick-capture-input"
              onKeyDown={handleInputKeyDown}
              onChange={(event) => setInput(event.target.value)}
              placeholder="besok jam 7 pagi les privat Kevin, siapin soal aljabar"
              ref={inputRef}
              value={input}
            />
          </div>

          <div className="min-h-28 px-4 py-3">
            {parsedReminder ? (
              <ParsePreview parseResult={parsedReminder} />
            ) : (
              <div className="flex min-h-20 items-center text-sm text-zinc-500">
                Waiting for capture.
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-4 py-3">
            <p className="text-sm text-zinc-500" role="status">
              {statusMessage}
            </p>
            <button
              className="h-10 rounded-md bg-zinc-950 px-5 text-sm font-medium text-white transition enabled:hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canSave || isSaving}
              type="submit"
            >
              {isSaving ? "Saving" : "Save"}
            </button>
          </div>
        </form>

        <section className="grid gap-3">
          <h2 className="text-sm font-semibold text-zinc-700">
            Local reminders
          </h2>
          {visibleReminders.length > 0 ? (
            <ul className="grid gap-2">
              {visibleReminders.map((reminder) => (
                <li
                  className="rounded-md border border-zinc-200 bg-white px-3 py-2 shadow-sm"
                  key={reminder.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-zinc-950">{reminder.title}</p>
                      <p className="text-sm text-zinc-500">
                        {formatDateTime(reminder.scheduledAt)}
                      </p>
                    </div>
                    {isActionableReminderStatus(reminder.status) ? (
                      <button
                        className="h-8 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 transition hover:border-cyan-600 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={updatingReminderId === reminder.id}
                        onClick={() => void handleMarkDone(reminder)}
                        type="button"
                      >
                        {updatingReminderId === reminder.id ? "Saving" : "Done"}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      {reminder.type}
                    </span>
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      {reminder.status}
                    </span>
                    <p className="text-sm text-zinc-500">
                      {reminder.rawInput}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-500">
              No local reminders saved yet.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}

function ParsePreview({ parseResult }: { parseResult: ReminderParseResult }) {
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-zinc-950">
          {parseResult.draft.title}
        </span>
        <span className="rounded bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-800">
          {parseResult.draft.type}
        </span>
        <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
          {parseResult.draft.category}
        </span>
        <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
          {Math.round(parseResult.draft.confidence * 100)}%
        </span>
      </div>

      <p className="text-zinc-600">
        {parseResult.draft.scheduledAt
          ? formatDateTime(parseResult.draft.scheduledAt)
          : "No reminder time detected yet."}
      </p>

      {parseResult.draft.checklist.length > 0 ? (
        <p className="text-zinc-600">
          Checklist: {parseResult.draft.checklist.join(", ")}
        </p>
      ) : null}

      {parseResult.issues.length > 0 ? (
        <p className="text-amber-700">
          {parseResult.issues.map((issue) => issue.message).join(" ")}
        </p>
      ) : null}
    </div>
  );
}

async function refreshLocalData(
  setReminders: (reminders: ReminderNode[]) => void,
  setDueReminderCount: (count: number) => void,
  setStatusMessage: (message: string) => void,
  successMessage = "Local SQLite storage is ready.",
) {
  try {
    const now = new Date().toISOString();
    const [reminders, dueReminders] = await Promise.all([
      invoke<ReminderNode[]>("list_reminder_nodes"),
      invoke<ReminderNode[]>("list_due_reminder_nodes", { now }),
    ]);
    setReminders(reminders);
    setDueReminderCount(dueReminders.length);
    setStatusMessage(successMessage);
  } catch (error) {
    setStatusMessage(toDisplayError(error));
  }
}

async function hideMainWindow(
  setStatusMessage: (message: string) => void,
): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    await invoke("hide_main_window");
  } catch (error) {
    setStatusMessage(toDisplayError(error));
  }
}

function createReminderNode(
  parseResult: ReminderParseResult,
  deviceId: string,
): ReminderNode {
  if (!parseResult.draft.scheduledAt) {
    throw new Error("Reminder scheduled time is required.");
  }

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: parseResult.draft.title,
    rawInput: parseResult.rawInput,
    scheduledAt: parseResult.draft.scheduledAt,
    timezone: parseResult.draft.timezone,
    type: parseResult.draft.type,
    status: "pending",
    category: parseResult.draft.category,
    checklist: parseResult.draft.checklist,
    confidence: parseResult.draft.confidence,
    createdAt: now,
    updatedAt: now,
    createdOnDeviceId: deviceId,
    syncVersion: 0,
  };
}

function getDeviceId(): string {
  const existingDeviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);

  if (existingDeviceId) {
    return existingDeviceId;
  }

  const deviceId = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  return deviceId;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function isActionableReminderStatus(status: ReminderStatus): boolean {
  return status === "pending" || status === "missed" || status === "snoozed";
}

function focusCaptureInput(input: HTMLInputElement | null) {
  window.requestAnimationFrame(() => input?.focus());
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function toDisplayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
