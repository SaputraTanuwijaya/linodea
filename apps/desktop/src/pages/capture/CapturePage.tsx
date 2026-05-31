/**
 * The capture form — always visible at the top of the popup, regardless of
 * mode. Owns its input value, parse, and save flow.
 *
 * On a successful save:
 *   - calls `onSaved` so App.tsx can bump the list-refresh signal.
 *   - hides the window only when the popup is in capture mode (in list /
 *     settings mode, saving keeps the popup open and re-focuses the input).
 *
 * The `••• menu` button trigger and the right-click context menu are owned
 * by App.tsx — this component just renders the button and calls back.
 */

import { invoke } from "@tauri-apps/api/core";
import { parseReminder } from "@linodea/parser";
import { useMemo, useRef, useState } from "react";
import type {
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";

import { PreviewLine } from "@/features/autocorrect-display";
import type { LanguageId } from "@/features/language";
import {
  createReminderNode,
  createReminderNodeCommand,
  notifyDueReminders,
} from "@/entities/reminder";
import type { Strings } from "@/shared/i18n";
import { getDeviceId, isTauriRuntime } from "@/shared/lib";

export function CapturePage({
  inputRef,
  language,
  onMenuButtonClick,
  onSaved,
  shouldHideAfterSave,
  strings,
}: {
  /** Forwarded so App.tsx can refocus the input on window focus events. */
  inputRef: RefObject<HTMLInputElement | null>;
  language: LanguageId;
  onMenuButtonClick: (event: ReactMouseEvent) => void;
  /** Called after a successful save; App.tsx uses this to refresh the list. */
  onSaved: () => void;
  /** True only in capture mode — list/settings modes keep the popup open. */
  shouldHideAfterSave: boolean;
  strings: Strings;
}) {
  const [input, setInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const internalRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? internalRef;

  const parsedReminder = useMemo(
    () =>
      input.trim()
        ? parseReminder(input, { preferredLanguage: language })
        : undefined,
    [input, language],
  );
  const canSave = Boolean(parsedReminder?.draft.scheduledAt && input.trim());

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setInput("");
    void hideMainWindow();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave || !parsedReminder?.draft.scheduledAt) {
      focusInput(ref.current);
      return;
    }

    if (!isTauriRuntime()) return;

    setIsSaving(true);
    try {
      const reminder = createReminderNode(parsedReminder, getDeviceId());
      await createReminderNodeCommand(reminder);
      await notifyDueReminders().catch(() => undefined);
      setInput("");
      onSaved();

      if (shouldHideAfterSave) {
        await hideMainWindow();
      } else {
        focusInput(ref.current);
      }
    } catch {
      // Silent.
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="relative flex w-full items-center rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] py-3.5 pl-11 pr-11 shadow-2xl backdrop-blur transition-colors"
      onSubmit={handleSubmit}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label className="sr-only" htmlFor="quick-capture-input">
          {strings.menu.capture}
        </label>
        <input
          autoFocus
          className="w-full bg-transparent text-base font-medium leading-tight tracking-tight text-[var(--lin-text)] outline-none placeholder:text-[var(--lin-text-mute)]"
          id="quick-capture-input"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={strings.placeholder}
          ref={ref}
          spellCheck={false}
          value={input}
        />
        <p className="truncate text-xs leading-tight text-[var(--lin-text-dim)]">
          <PreviewLine
            isSaving={isSaving}
            parseResult={parsedReminder}
            strings={strings}
          />
        </p>
      </div>
      <button
        aria-label="Open menu"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs leading-none text-[var(--lin-text-dim)] transition hover:bg-[var(--lin-bg-hover)] hover:text-[var(--lin-text)]"
        onClick={onMenuButtonClick}
        tabIndex={-1}
        type="button"
      >
        •••
      </button>
    </form>
  );
}

function focusInput(input: HTMLInputElement | null) {
  window.requestAnimationFrame(() => input?.focus());
}

async function hideMainWindow(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke("hide_main_window");
  } catch {
    // Silent.
  }
}
