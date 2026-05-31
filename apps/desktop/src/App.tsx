import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { parseReminder } from "@linodea/parser";
import type {
  ReminderNode,
  ReminderParseResult,
  ReminderStatus,
} from "@linodea/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";

import "./App.css";
import { PreviewLine } from "@/features/autocorrect-display";
import { LanguageSection, useLanguage, type LanguageId } from "@/features/language";
import {
  MAX_PREALERTS,
  PrealertsSection,
  usePrealerts,
  type PrealertConfig,
} from "@/features/prealerts";
import {
  StartupSection,
  useAutostart,
  type AutostartState,
} from "@/features/startup";
import { ThemeSection, useTheme, type ThemeId } from "@/features/theme";
import {
  DUE_NOTIFICATION_POLL_INTERVAL_MS,
  enableReminderNotifications,
  notifyDueReminders,
} from "@/entities/reminder";
import { stringsFor, type Strings } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib";

const DEVICE_ID_STORAGE_KEY = "linodea.deviceId";
const MODE_EVENT = "linodea:mode";

const CAPTURE_WITH_MENU_HEIGHT = 300;
const MENU_WIDTH = 200;
const MENU_HEIGHT = 220;

type Mode = "capture" | "list" | "settings";

interface ReminderStatusPatch {
  id: string;
  status: ReminderStatus;
  updatedAt: string;
  completedAt?: string;
  snoozedUntil?: string;
}

interface MenuAnchor {
  x: number;
  y: number;
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState<Mode>("capture");
  const [reminders, setReminders] = useState<ReminderNode[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [updatingReminderId, setUpdatingReminderId] = useState<string>();
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [theme, setTheme] = useTheme();
  const [prealertConfig, setPrealertConfig] = usePrealerts();
  const [language, setLanguage] = useLanguage();
  const [autostart, setAutostart] = useAutostart();

  const strings = useMemo(() => stringsFor(language), [language]);

  const parsedReminder = useMemo(
    () =>
      input.trim()
        ? parseReminder(input, { preferredLanguage: language })
        : undefined,
    [input, language],
  );
  const canSave = Boolean(parsedReminder?.draft.scheduledAt && input.trim());

  const refreshList = useCallback(async () => {
    if (!isTauriRuntime()) {
      return;
    }
    setIsLoadingList(true);
    try {
      const all = await invoke<ReminderNode[]>("list_reminder_nodes");
      setReminders(all.filter(isActionable).sort(byScheduledAt));
    } catch {
      // Silent.
    } finally {
      setIsLoadingList(false);
    }
  }, []);

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

    let mounted = true;
    let unlisten: UnlistenFn | undefined;

    void listen<string>(MODE_EVENT, (event) => {
      if (!mounted) {
        return;
      }
      setMode(parseMode(event.payload));
      setMenuAnchor(null);
    }).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (mode === "list") {
      void refreshList();
    }
  }, [mode, refreshList]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let isMounted = true;

    async function checkDueReminders() {
      try {
        await notifyDueReminders();
      } catch {
        // Silent.
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

  useEffect(() => {
    if (!menuAnchor) {
      return;
    }

    function onMouseDown(event: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuAnchor(null);
      }
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuAnchor(null);
      }
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuAnchor]);

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

      if (mode === "list") {
        await refreshList();
        focusCaptureInput(inputRef.current);
      } else if (mode === "settings") {
        focusCaptureInput(inputRef.current);
      } else {
        await hideMainWindow();
      }
    } catch {
      // Silent.
    } finally {
      setIsSaving(false);
    }
  }

  async function handleMarkDone(reminder: ReminderNode) {
    if (!isTauriRuntime()) {
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
    try {
      await invoke<ReminderNode>("update_reminder_node_status", { patch });
      await refreshList();
    } catch {
      // Silent.
    } finally {
      setUpdatingReminderId(undefined);
    }
  }

  async function openMenuAt(x: number, y: number) {
    if (mode === "capture" && isTauriRuntime()) {
      await invoke("set_popup_height", { height: CAPTURE_WITH_MENU_HEIGHT })
        .catch(() => undefined);
    }
    setMenuAnchor({ x, y });
  }

  function handleContextMenu(event: ReactMouseEvent) {
    event.preventDefault();
    void openMenuAt(event.clientX, event.clientY);
  }

  function handleMenuButtonClick(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    void openMenuAt(rect.left, rect.bottom + 4);
  }

  async function handleMenuAction(action: MenuAction) {
    setMenuAnchor(null);
    if (!isTauriRuntime()) {
      return;
    }
    try {
      switch (action) {
        case "capture":
          await invoke("enter_capture_mode");
          break;
        case "list":
          await invoke("enter_list_mode");
          break;
        case "settings":
          await invoke("enter_settings_mode");
          break;
        case "hide":
          await invoke("hide_main_window");
          break;
        case "quit":
          await invoke("quit_app");
          break;
      }
    } catch {
      // Silent.
    }
  }

  return (
    <main className="flex h-screen w-screen items-start justify-center bg-transparent pt-3">
      <div className="relative w-[560px]" onContextMenu={handleContextMenu}>
        <img
          alt=""
          className="pointer-events-none absolute -left-3 -top-3 z-10 h-12 w-12 select-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.55)]"
          draggable={false}
          src="/tauri-logo.png"
        />
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
              ref={inputRef}
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
            onClick={handleMenuButtonClick}
            tabIndex={-1}
            type="button"
          >
            •••
          </button>
        </form>

        {mode === "list" ? (
          <ListPanel
            isLoading={isLoadingList}
            onMarkDone={handleMarkDone}
            reminders={reminders}
            strings={strings}
            updatingReminderId={updatingReminderId}
          />
        ) : null}

        {mode === "settings" ? (
          <SettingsPanel
            activeLanguage={language}
            activeTheme={theme}
            autostart={autostart}
            onAutostartChange={setAutostart}
            onLanguageChange={setLanguage}
            onPrealertsChange={setPrealertConfig}
            onThemeChange={setTheme}
            prealertConfig={prealertConfig}
            strings={strings}
          />
        ) : null}
      </div>

      {menuAnchor ? (
        <PopupMenu
          anchor={menuAnchor}
          menuRef={menuRef}
          mode={mode}
          onAction={handleMenuAction}
          strings={strings}
        />
      ) : null}
    </main>
  );
}

type MenuAction = "capture" | "list" | "settings" | "hide" | "quit";

function PopupMenu({
  anchor,
  menuRef,
  mode,
  onAction,
  strings,
}: {
  anchor: MenuAnchor;
  menuRef: React.RefObject<HTMLDivElement | null>;
  mode: Mode;
  onAction: (action: MenuAction) => void;
  strings: Strings;
}) {
  const { left, top } = clampMenuPosition(anchor);

  return (
    <div
      className="fixed z-50 min-w-[200px] rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg)] p-1 shadow-2xl backdrop-blur"
      ref={menuRef}
      role="menu"
      style={{ left, top }}
    >
      <MenuItem
        disabled={mode === "capture"}
        label={strings.menu.capture}
        onClick={() => onAction("capture")}
      />
      <MenuItem
        disabled={mode === "list"}
        label={strings.menu.reminders}
        onClick={() => onAction("list")}
      />
      <MenuItem
        disabled={mode === "settings"}
        label={strings.menu.settings}
        onClick={() => onAction("settings")}
      />
      <div className="my-1 h-px bg-[var(--lin-border)]" />
      <MenuItem label={strings.menu.hide} onClick={() => onAction("hide")} />
      <MenuItem
        label={strings.menu.quit}
        onClick={() => onAction("quit")}
        variant="danger"
      />
    </div>
  );
}

function MenuItem({
  disabled,
  label,
  onClick,
  variant,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
  variant?: "danger";
}) {
  const base =
    "w-full rounded-md px-3 py-1.5 text-left text-sm transition disabled:cursor-default";
  const tone = disabled
    ? "text-[var(--lin-text-mute)]"
    : variant === "danger"
      ? "text-[var(--lin-danger)] hover:bg-[var(--lin-danger-bg)]"
      : "text-[var(--lin-text)] hover:bg-[var(--lin-bg-hover)]";

  return (
    <button
      className={`${base} ${tone}`}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      {label}
    </button>
  );
}

function clampMenuPosition(anchor: MenuAnchor): { left: number; top: number } {
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  let left = anchor.x;
  let top = anchor.y;
  if (left + MENU_WIDTH > winW - 4) {
    left = Math.max(4, winW - MENU_WIDTH - 4);
  }
  if (top + MENU_HEIGHT > winH - 4) {
    top = Math.max(4, anchor.y - MENU_HEIGHT - 4);
  }
  return { left, top };
}

function ListPanel({
  isLoading,
  onMarkDone,
  reminders,
  strings,
  updatingReminderId,
}: {
  isLoading: boolean;
  onMarkDone: (reminder: ReminderNode) => void;
  reminders: ReminderNode[];
  strings: Strings;
  updatingReminderId: string | undefined;
}) {
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
                onClick={() => onMarkDone(reminder)}
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

function SettingsPanel({
  activeLanguage,
  activeTheme,
  autostart,
  onAutostartChange,
  onLanguageChange,
  onPrealertsChange,
  onThemeChange,
  prealertConfig,
  strings,
}: {
  activeLanguage: LanguageId;
  activeTheme: ThemeId;
  autostart: AutostartState;
  onAutostartChange: (next: boolean) => void;
  onLanguageChange: (next: LanguageId) => void;
  onPrealertsChange: (next: PrealertConfig) => void;
  onThemeChange: (theme: ThemeId) => void;
  prealertConfig: PrealertConfig;
  strings: Strings;
}) {
  return (
    <section className="mt-3 max-h-[600px] overflow-y-auto rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] px-4 py-4 shadow-2xl backdrop-blur transition-colors">
      <div className="grid gap-5">
        <SettingsSection
          title={strings.settings.appearance.title}
          hint={strings.settings.appearance.hint}
        >
          <ThemeSection
            activeTheme={activeTheme}
            onThemeChange={onThemeChange}
            strings={strings}
          />
        </SettingsSection>

        <SettingsSection
          title={strings.settings.notifications.title}
          hint={strings.settings.notifications.hint(MAX_PREALERTS)}
        >
          <PrealertsSection
            config={prealertConfig}
            onChange={onPrealertsChange}
            strings={strings}
          />
        </SettingsSection>

        <SettingsSection
          title={strings.settings.language.title}
          hint={strings.settings.language.hint}
        >
          <LanguageSection
            activeLanguage={activeLanguage}
            onLanguageChange={onLanguageChange}
          />
        </SettingsSection>

        <SettingsSection
          title={strings.settings.startup.title}
          hint={strings.settings.startup.hint}
        >
          <StartupSection
            autostart={autostart}
            onChange={onAutostartChange}
            strings={strings}
          />
        </SettingsSection>
      </div>
    </section>
  );
}

function SettingsSection({
  children,
  hint,
  title,
}: {
  children: React.ReactNode;
  hint?: string;
  title: string;
}) {
  return (
    <div className="grid gap-2">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--lin-text-dim)]">
          {title}
        </p>
        {hint ? (
          <p className="mt-0.5 text-xs text-[var(--lin-text-mute)]">{hint}</p>
        ) : null}
      </header>
      {children}
    </div>
  );
}

function parseMode(payload: string): Mode {
  if (payload === "list") return "list";
  if (payload === "settings") return "settings";
  return "capture";
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

function isActionable(reminder: ReminderNode): boolean {
  return (
    reminder.status === "pending" ||
    reminder.status === "missed" ||
    reminder.status === "snoozed"
  );
}

function byScheduledAt(a: ReminderNode, b: ReminderNode): number {
  return a.scheduledAt.localeCompare(b.scheduledAt);
}

function focusCaptureInput(input: HTMLInputElement | null) {
  window.requestAnimationFrame(() => input?.focus());
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export default App;
