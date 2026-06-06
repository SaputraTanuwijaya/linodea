/**
 * The capture form — always visible at the top of the popup, regardless of
 * mode. Owns its input value, parse, and save flow.
 *
 * On a successful save:
 *   - calls `onSaved` so App.tsx can bump the list-refresh signal.
 *   - hides the window only when the popup is in capture mode (in list /
 *     settings mode, saving keeps the popup open and re-focuses the input).
 *   - if the reminder used `/countdown`, shows the on-screen countdown timer
 *     window (`show_timer`). The timer is display-only — the scheduler still
 *     owns firing the alert at the exact instant.
 *
 * `/link` is a two-phase flow: picking it from the slash dropdown opens an
 * *anchor picker* (the same dropdown, now listing reminders); arrow/Enter binds
 * an anchor, shown as a chip. The message you then type resolves its time
 * **relative to the anchor** (`parseAnchorLink`), and on save the new reminder
 * is created and linked under the anchor (`move_reminder_node`). No anchor
 * picked ⇒ it just saves as a normal reminder (linking never blocks a save).
 *
 * The input is a `HighlightedInput` (transparent input over a colored mirror)
 * so `/command` tokens render yellow, and `useSlashCommands` drives the
 * autocomplete dropdown. The window grows while a dropdown is open (capture
 * mode only) so the menu isn't clipped, mirroring the `•••` menu behavior.
 */

import { invoke } from "@tauri-apps/api/core";
import { parseAnchorLink, parseReminder } from "@linodea/parser";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
  SyntheticEvent,
} from "react";
import type { ReminderNode } from "@linodea/types";

import { PreviewLine } from "@/features/autocorrect-display";
import type { LanguageId } from "@/features/language";
import {
  HighlightedInput,
  SlashCommandMenu,
  useSlashCommands,
  type SlashApplyResult,
  type SlashCommandSuggestion,
} from "@/features/slash-commands";
import {
  byScheduledAt,
  createLinkedReminderNode,
  createReminderNode,
  createReminderNodeCommand,
  isActionable,
  listReminderNodes,
  moveReminderNode,
} from "@/entities/reminder";
import type { Strings } from "@/shared/i18n";
import { formatDateTime, getDeviceId, isTauriRuntime } from "@/shared/lib";

const CAPTURE_DEFAULT_HEIGHT = 130;
const CAPTURE_WITH_SLASH_HEIGHT = 240;

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
  const [caret, setCaret] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // `/link` two-phase state. `anchorPicking` = phase 2 (choosing the anchor);
  // `linkAnchor` = the bound anchor (phase 3, typing the message).
  const [anchorPicking, setAnchorPicking] = useState(false);
  const [anchors, setAnchors] = useState<ReminderNode[]>([]);
  const [anchorIndex, setAnchorIndex] = useState(0);
  const [linkAnchor, setLinkAnchor] = useState<ReminderNode | null>(null);

  const internalRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? internalRef;

  const slash = useSlashCommands(input, caret, strings);

  const filteredAnchors = useMemo(() => {
    const q = input.trim().toLowerCase();
    return q ? anchors.filter((a) => a.title.toLowerCase().includes(q)) : anchors;
  }, [anchors, input]);
  const clampedAnchorIndex = Math.min(anchorIndex, Math.max(0, filteredAnchors.length - 1));

  const parsedReminder = useMemo(
    () =>
      !linkAnchor && !anchorPicking && input.trim()
        ? parseReminder(input, { preferredLanguage: language })
        : undefined,
    [input, language, linkAnchor, anchorPicking],
  );

  // Live resolution of the linked reminder's time, relative to the anchor.
  const linkPreview = useMemo(() => {
    if (!linkAnchor || !input.trim()) return undefined;
    try {
      return parseAnchorLink(input, {
        anchor: linkAnchor.scheduledAt,
        timezone: linkAnchor.timezone,
        defaultDirection: "before",
      });
    } catch {
      return undefined;
    }
  }, [linkAnchor, input]);

  const canSave = linkAnchor
    ? Boolean(input.trim())
    : Boolean(parsedReminder?.draft.scheduledAt && input.trim());

  // Grow the popup while any dropdown is open so it isn't clipped; restore on
  // close. Capture mode only — list/settings own their own height.
  const menuOpen = slash.isOpen || anchorPicking;
  useEffect(() => {
    if (!isTauriRuntime() || !shouldHideAfterSave) return;
    void invoke("set_popup_height", {
      height: menuOpen ? CAPTURE_WITH_SLASH_HEIGHT : CAPTURE_DEFAULT_HEIGHT,
    }).catch(() => undefined);
  }, [menuOpen, shouldHideAfterSave]);

  function syncCaret(el: HTMLInputElement) {
    setCaret(el.selectionStart ?? el.value.length);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setInput(event.target.value);
    syncCaret(event.currentTarget);
    if (anchorPicking) setAnchorIndex(0);
  }

  function handleSelect(event: SyntheticEvent<HTMLInputElement>) {
    syncCaret(event.currentTarget);
  }

  function applySlash(result: SlashApplyResult) {
    setInput(result.value);
    setCaret(result.caret);
    window.requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(result.caret, result.caret);
    });
  }

  /** A command was chosen from the dropdown. `/link` opens the anchor picker
   *  instead of inserting text; every other command inserts as before. */
  function chooseCommand(suggestion: SlashCommandSuggestion) {
    if (suggestion.command.name === "link") {
      void enterAnchorMode();
      return;
    }
    applySlash(slash.applyCommand(suggestion));
  }

  async function enterAnchorMode() {
    setInput("");
    setCaret(0);
    setAnchorIndex(0);
    setLinkAnchor(null);
    let list: ReminderNode[] = [];
    if (isTauriRuntime()) {
      try {
        list = (await listReminderNodes()).filter(isActionable).sort(byScheduledAt);
      } catch {
        // Silent — empty picker shows the "nothing to link to" hint.
      }
    }
    setAnchors(list);
    setAnchorPicking(true);
    focusInput(ref.current);
  }

  function bindAnchor(anchor: ReminderNode) {
    setLinkAnchor(anchor);
    setAnchorPicking(false);
    setAnchors([]);
    setAnchorIndex(0);
    setInput("");
    setCaret(0);
    focusInput(ref.current);
  }

  /** Exit the link flow entirely (Esc / chip ✕), back to a normal capture. */
  function cancelLink() {
    setLinkAnchor(null);
    setAnchorPicking(false);
    setAnchors([]);
    setAnchorIndex(0);
    setInput("");
    setCaret(0);
    focusInput(ref.current);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Phase 2: choosing an anchor.
    if (anchorPicking) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setAnchorIndex((i) => Math.min(i + 1, filteredAnchors.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setAnchorIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const anchor = filteredAnchors[clampedAnchorIndex];
        if (anchor) bindAnchor(anchor);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelLink();
        return;
      }
      return; // let other keys type into the filter
    }

    if (slash.isOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        slash.moveSelection(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        slash.moveSelection(-1);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const selected = slash.suggestions[slash.selectedIndex];
        if (selected) {
          event.preventDefault();
          chooseCommand(selected);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        slash.close();
        return;
      }
    }

    if (event.key !== "Escape") return;
    event.preventDefault();
    // Phase 3: Esc drops the link first; otherwise dismiss the window.
    if (linkAnchor) {
      cancelLink();
      return;
    }
    setInput("");
    void hideMainWindow();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSave) {
      focusInput(ref.current);
      return;
    }
    if (!isTauriRuntime()) return;

    setIsSaving(true);
    try {
      // Linked save: resolve time off the anchor, create, then link under it.
      if (linkAnchor) {
        const link = parseAnchorLink(input, {
          anchor: linkAnchor.scheduledAt,
          timezone: linkAnchor.timezone,
          defaultDirection: "before",
        });
        const node = createLinkedReminderNode(link, linkAnchor, input, getDeviceId());
        await createReminderNodeCommand(node);
        await moveReminderNode({
          id: node.id,
          parentId: linkAnchor.id,
          updatedAt: new Date().toISOString(),
        });
        setInput("");
        setCaret(0);
        setLinkAnchor(null);
        onSaved();
        if (shouldHideAfterSave) await hideMainWindow();
        else focusInput(ref.current);
        return;
      }

      if (!parsedReminder?.draft.scheduledAt) return;
      const reminder = createReminderNode(parsedReminder, getDeviceId());
      await createReminderNodeCommand(reminder);

      // `/countdown` reminders get an on-screen countdown timer. Display-only:
      // the scheduler still fires the alert at the exact instant.
      if (parsedReminder.countdown && parsedReminder.draft.scheduledAt) {
        void invoke("show_timer", {
          payload: {
            title: reminder.title,
            targetMs: Date.parse(parsedReminder.draft.scheduledAt),
          },
        }).catch(() => undefined);
      }

      setInput("");
      setCaret(0);
      // onSaved triggers the scheduler to fire anything immediately due and
      // arm a precise timer for this new reminder.
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
      <div className="relative flex min-w-0 flex-1 flex-col gap-1">
        <label className="sr-only" htmlFor="quick-capture-input">
          {strings.menu.capture}
        </label>

        {linkAnchor ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex max-w-[60%] items-center gap-1 truncate rounded-full border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-2 py-0.5 text-xs text-[var(--lin-text)]">
              <span className="truncate">⛓ {linkAnchor.title}</span>
              <button
                aria-label={strings.link.chipClear}
                className="flex-none text-[var(--lin-text-mute)] transition hover:text-[var(--lin-text)]"
                onClick={cancelLink}
                tabIndex={-1}
                type="button"
              >
                ✕
              </button>
            </span>
            <span className="truncate text-xs text-[var(--lin-text-mute)]">
              {strings.link.hint}
            </span>
          </div>
        ) : null}

        <HighlightedInput
          inputRef={ref}
          onChange={handleChange}
          onKeyDown={handleInputKeyDown}
          onSelect={handleSelect}
          placeholder={strings.placeholder}
          value={input}
        />

        <p className="truncate text-xs leading-tight text-[var(--lin-text-dim)]">
          {linkAnchor ? (
            linkPreview ? (
              <>
                →{" "}
                <span className="text-[var(--lin-text)]">
                  {formatDateTime(linkPreview.scheduledAt)}
                </span>{" "}
                · {linkPreview.role === "followup" ? "follow-up" : "prep"}
              </>
            ) : (
              strings.link.hint
            )
          ) : (
            <PreviewLine
              isSaving={isSaving}
              parseResult={parsedReminder}
              strings={strings}
            />
          )}
        </p>

        {anchorPicking ? (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg)] p-1 shadow-2xl"
            role="listbox"
          >
            <div className="px-3 py-1.5 text-xs text-[var(--lin-text-mute)]">
              {strings.link.pickHeader}
            </div>
            {filteredAnchors.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--lin-text-mute)]">
                {strings.link.noMatch}
              </div>
            ) : (
              filteredAnchors.map((anchor, index) => (
                <button
                  aria-selected={index === clampedAnchorIndex}
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left transition ${
                    index === clampedAnchorIndex ? "bg-[var(--lin-bg-hover)]" : ""
                  }`}
                  key={anchor.id}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    bindAnchor(anchor);
                  }}
                  role="option"
                  type="button"
                >
                  <span className="truncate text-sm text-[var(--lin-text)]">
                    {anchor.title}
                  </span>
                  <span className="flex-none whitespace-nowrap text-xs text-[var(--lin-text-dim)]">
                    {formatDateTime(anchor.scheduledAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : slash.isOpen ? (
          <SlashCommandMenu
            onPick={chooseCommand}
            selectedIndex={slash.selectedIndex}
            suggestions={slash.suggestions}
          />
        ) : null}
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
