import { invoke } from "@tauri-apps/api/core";
import { parseReminder } from "@linodea/parser";
import type { ReminderNode, ReminderParseResult } from "@linodea/types";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import "./App.css";
import {
  DUE_NOTIFICATION_POLL_INTERVAL_MS,
  enableReminderNotifications,
  notifyDueReminders,
} from "./notifications";

const DEVICE_ID_STORAGE_KEY = "linodea.deviceId";

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const parsedReminder = useMemo(
    () => (input.trim() ? parseReminder(input) : undefined),
    [input],
  );
  const canSave = Boolean(parsedReminder?.draft.scheduledAt && input.trim());

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    void enableReminderNotifications().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let isMounted = true;

    async function checkDueReminders() {
      try {
        await notifyDueReminders();
      } catch {
        // Silent: popup has no status surface; failures recover on next tick.
      }
      if (!isMounted) {
        return;
      }
    }

    void checkDueReminders();
    const intervalId = window.setInterval(
      () => void checkDueReminders(),
      DUE_NOTIFICATION_POLL_INTERVAL_MS,
    );

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
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
    setInput("");
    void hideMainWindow();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave || !parsedReminder?.draft.scheduledAt) {
      focusCaptureInput(inputRef.current);
      return;
    }

    if (!isTauriRuntime()) {
      return;
    }

    setIsSaving(true);

    try {
      const reminder = createReminderNode(parsedReminder, getDeviceId());
      await invoke<ReminderNode>("create_reminder_node", { reminder });
      await notifyDueReminders().catch(() => undefined);
      setInput("");
      await hideMainWindow();
    } catch {
      // Silent: keep popup minimal. Future slice can flash an inline error.
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="flex h-screen w-screen items-center justify-center bg-transparent p-2">
      <form
        className="flex w-full items-center gap-3 rounded-2xl border border-zinc-700/60 bg-zinc-900/95 px-4 py-3 shadow-2xl backdrop-blur"
        onSubmit={handleSubmit}
      >
        <img
          alt=""
          className="h-9 w-9 shrink-0 select-none"
          draggable={false}
          src="/tauri-logo.png"
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <label className="sr-only" htmlFor="quick-capture-input">
            Reminder
          </label>
          <input
            autoFocus
            className="w-full bg-transparent text-base font-medium text-zinc-100 outline-none placeholder:text-zinc-500"
            id="quick-capture-input"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="besok jam 7 pagi les privat Kevin"
            ref={inputRef}
            spellCheck={false}
            value={input}
          />
          <p className="mt-0.5 truncate text-xs text-zinc-400">
            {previewLine(parsedReminder, isSaving)}
          </p>
        </div>
      </form>
    </main>
  );
}

function previewLine(
  parseResult: ReminderParseResult | undefined,
  isSaving: boolean,
): string {
  if (isSaving) {
    return "Saving...";
  }
  if (!parseResult) {
    return "Press Enter to save - Esc to dismiss";
  }
  if (parseResult.draft.scheduledAt) {
    return formatDateTime(parseResult.draft.scheduledAt);
  }
  return "Add a time, e.g. \"in 30m\" or \"besok jam 7 pagi\"";
}

async function hideMainWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke("hide_main_window");
  } catch {
    // Silent.
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

export default App;
