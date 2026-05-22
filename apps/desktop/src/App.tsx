import { invoke } from "@tauri-apps/api/core";
import { parseReminder } from "@linodea/parser";
import type { ReminderNode, ReminderParseResult } from "@linodea/types";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import "./App.css";

const DEVICE_ID_STORAGE_KEY = "linodea.deviceId";

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [reminders, setReminders] = useState<ReminderNode[]>([]);
  const [statusMessage, setStatusMessage] = useState("Local storage is idle.");
  const [isSaving, setIsSaving] = useState(false);

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

    void refreshReminders(setReminders, setStatusMessage);
  }, []);

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") {
      return;
    }

    if (input.length > 0) {
      setInput("");
      setStatusMessage("Capture cleared.");
    }
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
      await refreshReminders(
        setReminders,
        setStatusMessage,
        "Reminder saved locally.",
      );
      focusCaptureInput(inputRef.current);
    } catch (error) {
      setStatusMessage(toDisplayError(error));
    } finally {
      setIsSaving(false);
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
          <p className="text-sm text-zinc-500">{reminders.length} local</p>
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
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-zinc-950">{reminder.title}</p>
                    <p className="text-sm text-zinc-500">
                      {formatDateTime(reminder.scheduledAt)}
                    </p>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      {reminder.type}
                    </span>
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      {reminder.status}
                    </span>
                    <p className="min-w-0 text-sm text-zinc-500">
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

async function refreshReminders(
  setReminders: (reminders: ReminderNode[]) => void,
  setStatusMessage: (message: string) => void,
  successMessage = "Local SQLite storage is ready.",
) {
  try {
    const reminders = await invoke<ReminderNode[]>("list_reminder_nodes");
    setReminders(reminders);
    setStatusMessage(successMessage);
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
