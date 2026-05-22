import { invoke } from "@tauri-apps/api/core";
import { parseReminder } from "@linodea/parser";
import type { ReminderNode, ReminderParseResult } from "@linodea/types";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import "./App.css";

const DEVICE_ID_STORAGE_KEY = "linodea.deviceId";

function App() {
  const [input, setInput] = useState("");
  const [reminders, setReminders] = useState<ReminderNode[]>([]);
  const [statusMessage, setStatusMessage] = useState("Local storage is idle.");
  const [isSaving, setIsSaving] = useState(false);

  const parsedReminder = useMemo(
    () => (input.trim() ? parseReminder(input) : undefined),
    [input],
  );
  const canSave = Boolean(parsedReminder?.draft.scheduledAt && input.trim());

  useEffect(() => {
    if (!isTauriRuntime()) {
      setStatusMessage("Run the Tauri desktop app to save reminders locally.");
      return;
    }

    void refreshReminders(setReminders, setStatusMessage);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!parsedReminder) {
      return;
    }

    if (!parsedReminder.draft.scheduledAt) {
      setStatusMessage("Add a reminder time before saving.");
      return;
    }

    if (!isTauriRuntime()) {
      setStatusMessage("Parser preview is ready; saving needs the desktop runtime.");
      return;
    }

    setIsSaving(true);
    setStatusMessage("Saving reminder...");

    try {
      const reminder = createReminderNode(parsedReminder, getDeviceId());
      await invoke<ReminderNode>("create_reminder_node", { reminder });
      setInput("");
      await refreshReminders(setReminders, setStatusMessage);
    } catch (error) {
      setStatusMessage(toDisplayError(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-2 border-b border-zinc-200 pb-6">
          <p className="text-sm font-medium text-cyan-700">Linodea</p>
          <h1 className="text-3xl font-semibold leading-tight">
            Local reminder capture
          </h1>
        </header>

        <form
          className="grid gap-4 rounded-md border border-zinc-200 bg-white p-4 shadow-sm"
          onSubmit={handleSubmit}
        >
          <label className="grid gap-2">
            <span className="text-sm font-medium text-zinc-700">Reminder</span>
            <input
              autoFocus
              className="h-12 rounded-md border border-zinc-300 bg-white px-3 text-base outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
              onChange={(event) => setInput(event.target.value)}
              placeholder="besok jam 7 pagi les privat Kevin, siapin soal aljabar"
              value={input}
            />
          </label>

          {parsedReminder ? (
            <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-zinc-900">
                  {parsedReminder.draft.title}
                </span>
                <span className="rounded bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-800">
                  {parsedReminder.draft.type}
                </span>
                <span className="rounded bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700">
                  {parsedReminder.draft.category}
                </span>
              </div>
              <p className="text-zinc-600">
                {parsedReminder.draft.scheduledAt
                  ? formatDateTime(parsedReminder.draft.scheduledAt)
                  : "No reminder time detected yet."}
              </p>
              {parsedReminder.draft.checklist.length > 0 ? (
                <p className="text-zinc-600">
                  Checklist: {parsedReminder.draft.checklist.join(", ")}
                </p>
              ) : null}
              {parsedReminder.issues.length > 0 ? (
                <p className="text-amber-700">
                  {parsedReminder.issues.map((issue) => issue.message).join(" ")}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">{statusMessage}</p>
            <button
              className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition enabled:hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canSave || isSaving}
              type="submit"
            >
              {isSaving ? "Saving" : "Save"}
            </button>
          </div>
        </form>

        <section className="grid gap-3">
          <h2 className="text-sm font-semibold text-zinc-700">Stored reminders</h2>
          {reminders.length > 0 ? (
            <ul className="grid gap-2">
              {reminders.map((reminder) => (
                <li
                  className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm"
                  key={reminder.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-zinc-950">{reminder.title}</p>
                    <p className="text-sm text-zinc-500">
                      {formatDateTime(reminder.scheduledAt)}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">{reminder.rawInput}</p>
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

async function refreshReminders(
  setReminders: (reminders: ReminderNode[]) => void,
  setStatusMessage: (message: string) => void,
) {
  try {
    const reminders = await invoke<ReminderNode[]>("list_reminder_nodes");
    setReminders(reminders);
    setStatusMessage("Local SQLite storage is ready.");
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

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function toDisplayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default App;
