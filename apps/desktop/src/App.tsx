import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { parseReminder } from "@linodea/parser";
import type {
  ParserIssue,
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
import {
  DUE_NOTIFICATION_POLL_INTERVAL_MS,
  enableReminderNotifications,
  notifyDueReminders,
} from "./notifications";
import {
  applyTheme,
  getStoredTheme,
  persistTheme,
  THEMES,
  type ThemeDefinition,
  type ThemeId,
} from "./themes";
import {
  bestUnit,
  getStoredPrealerts,
  hasDuplicate,
  MAX_PREALERTS,
  nextAvailableOffset,
  persistPrealerts,
  sortDescending,
  toMinutes,
  unitValue,
  type OffsetUnit,
  type PrealertConfig,
  type PrealertOffset,
} from "./prealerts";
import {
  applyLanguage,
  getStoredLanguage,
  LANGUAGES,
  persistLanguage,
  stringsFor,
  type LanguageDefinition,
  type LanguageId,
  type Strings,
} from "./i18n";
import {
  readAutostart,
  writeAutostart,
  type AutostartState,
} from "./startup";

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
  const [theme, setThemeState] = useState<ThemeId>(() => getStoredTheme());
  const [prealertConfig, setPrealertConfig] = useState<PrealertConfig>(() =>
    getStoredPrealerts(),
  );
  const [language, setLanguageState] = useState<LanguageId>(() =>
    getStoredLanguage(),
  );
  const [autostart, setAutostart] = useState<AutostartState>({
    available: false,
    enabled: false,
  });

  const strings = useMemo(() => stringsFor(language), [language]);

  const parsedReminder = useMemo(
    () =>
      input.trim()
        ? parseReminder(input, { preferredLanguage: language })
        : undefined,
    [input, language],
  );
  const canSave = Boolean(parsedReminder?.draft.scheduledAt && input.trim());

  const handleThemeChange = useCallback((next: ThemeId) => {
    applyTheme(next);
    persistTheme(next);
    setThemeState(next);
  }, []);

  const handlePrealertsChange = useCallback((next: PrealertConfig) => {
    persistPrealerts(next);
    setPrealertConfig(next);
  }, []);

  const handleLanguageChange = useCallback((next: LanguageId) => {
    applyLanguage(next);
    persistLanguage(next);
    setLanguageState(next);
  }, []);

  const handleAutostartChange = useCallback(async (next: boolean) => {
    const result = await writeAutostart(next);
    setAutostart(result);
  }, []);

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
    let mounted = true;
    void readAutostart().then((state) => {
      if (mounted) setAutostart(state);
    });
    return () => {
      mounted = false;
    };
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
            onAutostartChange={handleAutostartChange}
            onLanguageChange={handleLanguageChange}
            onPrealertsChange={handlePrealertsChange}
            onThemeChange={handleThemeChange}
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
          <div className="grid grid-cols-2 gap-2">
            {THEMES.map((theme) => (
              <ThemeCard
                isActive={theme.id === activeTheme}
                key={theme.id}
                onSelect={() => onThemeChange(theme.id)}
                strings={strings}
                theme={theme}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title={strings.settings.notifications.title}
          hint={strings.settings.notifications.hint(MAX_PREALERTS)}
        >
          <PrealertEditor
            config={prealertConfig}
            onChange={onPrealertsChange}
            strings={strings}
          />
        </SettingsSection>

        <SettingsSection
          title={strings.settings.language.title}
          hint={strings.settings.language.hint}
        >
          <div className="grid grid-cols-2 gap-2">
            {LANGUAGES.map((lang) => (
              <LanguageCard
                isActive={lang.id === activeLanguage}
                key={lang.id}
                language={lang}
                onSelect={() => onLanguageChange(lang.id)}
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title={strings.settings.startup.title}
          hint={strings.settings.startup.hint}
        >
          <StartupToggle
            autostart={autostart}
            onChange={onAutostartChange}
            strings={strings}
          />
        </SettingsSection>
      </div>
    </section>
  );
}

function StartupToggle({
  autostart,
  onChange,
  strings,
}: {
  autostart: AutostartState;
  onChange: (next: boolean) => void;
  strings: Strings;
}) {
  const { available, enabled } = autostart;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-[var(--lin-text)]">
          {strings.startup.toggleLabel}
        </p>
        <p className="mt-0.5 text-xs text-[var(--lin-text-mute)]">
          {available ? strings.startup.toggleHint : strings.startup.unavailable}
        </p>
      </div>
      <button
        aria-checked={enabled}
        aria-label={strings.startup.toggleLabel}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-[var(--lin-border)] transition-colors ${
          enabled ? "bg-[var(--lin-accent)]" : "bg-[var(--lin-text-mute)]"
        } ${available ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
        disabled={!available}
        onClick={() => onChange(!enabled)}
        role="switch"
        type="button"
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-[var(--lin-bg)] shadow-sm transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

function PrealertEditor({
  config,
  onChange,
  strings,
}: {
  config: PrealertConfig;
  onChange: (next: PrealertConfig) => void;
  strings: Strings;
}) {
  const sorted = useMemo(() => sortDescending(config.offsets), [config.offsets]);

  function updateOffset(index: number, minutes: number) {
    if (minutes <= 0) return;
    if (hasDuplicate(sorted, minutes, index)) return;
    const nextOffsets = sorted.map((offset, i) =>
      i === index ? { minutes } : offset,
    );
    onChange({ offsets: nextOffsets });
  }

  function deleteOffset(index: number) {
    onChange({ offsets: sorted.filter((_, i) => i !== index) });
  }

  function addOffset() {
    if (sorted.length >= MAX_PREALERTS) return;
    onChange({ offsets: [...sorted, nextAvailableOffset(sorted)] });
  }

  return (
    <div className="grid gap-2">
      {sorted.length === 0 ? (
        <p className="text-xs text-[var(--lin-text-mute)]">
          {strings.prealerts.emptyState}
        </p>
      ) : (
        sorted.map((offset, index) => (
          <PrealertRow
            index={index}
            key={`${index}-${offset.minutes}`}
            offset={offset}
            onDelete={() => deleteOffset(index)}
            onUpdate={(minutes) => updateOffset(index, minutes)}
            siblings={sorted}
            strings={strings}
          />
        ))
      )}
      {sorted.length < MAX_PREALERTS ? (
        <button
          className="w-fit rounded-md border border-dashed border-[var(--lin-border)] px-3 py-1.5 text-xs font-medium text-[var(--lin-text-dim)] transition hover:border-[var(--lin-text-dim)] hover:text-[var(--lin-text)]"
          onClick={addOffset}
          type="button"
        >
          {strings.prealerts.addButton}
        </button>
      ) : null}
    </div>
  );
}

function PrealertRow({
  index,
  offset,
  onDelete,
  onUpdate,
  siblings,
  strings,
}: {
  index: number;
  offset: PrealertOffset;
  onDelete: () => void;
  onUpdate: (minutes: number) => void;
  siblings: PrealertOffset[];
  strings: Strings;
}) {
  const unit = bestUnit(offset.minutes);
  const value = unitValue(offset.minutes, unit);
  const candidateForCurrent = toMinutes(value, unit);
  const isDuplicate =
    candidateForCurrent !== offset.minutes &&
    hasDuplicate(siblings, candidateForCurrent, index);

  function handleValueChange(nextValueRaw: string) {
    const parsed = Number.parseInt(nextValueRaw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    onUpdate(toMinutes(parsed, unit));
  }

  function handleUnitChange(nextUnit: OffsetUnit) {
    onUpdate(toMinutes(value, nextUnit));
  }

  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={strings.prealerts.valueLabel}
        className={`h-8 w-16 rounded-md border bg-[var(--lin-bg-hover)] px-2 text-sm text-[var(--lin-text)] outline-none transition focus:border-[var(--lin-text-dim)] ${
          isDuplicate ? "border-[var(--lin-danger)]" : "border-[var(--lin-border)]"
        }`}
        inputMode="numeric"
        min={1}
        onChange={(event) => handleValueChange(event.target.value)}
        type="number"
        value={value}
      />
      <select
        aria-label={strings.prealerts.unitLabel}
        className="h-8 rounded-md border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-2 text-sm text-[var(--lin-text)] outline-none transition focus:border-[var(--lin-text-dim)]"
        onChange={(event) => handleUnitChange(event.target.value as OffsetUnit)}
        value={unit}
      >
        <option value="D">{strings.prealerts.units.D}</option>
        <option value="H">{strings.prealerts.units.H}</option>
        <option value="M">{strings.prealerts.units.M}</option>
      </select>
      <span className="text-xs text-[var(--lin-text-dim)]">
        {strings.prealerts.suffix}
      </span>
      <span className="ml-auto text-xs text-[var(--lin-text-mute)]">
        {strings.prealerts.describe(offset.minutes)}
      </span>
      <button
        aria-label={strings.prealerts.removeLabel}
        className="ml-1 rounded-md px-2 py-1 text-xs leading-none text-[var(--lin-text-dim)] transition hover:bg-[var(--lin-danger-bg)] hover:text-[var(--lin-danger)]"
        onClick={onDelete}
        type="button"
      >
        ✕
      </button>
    </div>
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

function ThemeCard({
  isActive,
  onSelect,
  strings,
  theme,
}: {
  isActive: boolean;
  onSelect: () => void;
  strings: Strings;
  theme: ThemeDefinition;
}) {
  const ring = isActive
    ? "ring-2 ring-[var(--lin-text)]"
    : "ring-1 ring-[var(--lin-border)] hover:ring-[var(--lin-text-dim)]";
  const localized = strings.themes[theme.id];

  return (
    <button
      aria-pressed={isActive}
      className={`flex items-center gap-3 rounded-xl bg-[var(--lin-bg-hover)] p-2.5 text-left transition ${ring}`}
      onClick={onSelect}
      type="button"
    >
      <ThemeSwatchPreview theme={theme} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--lin-text)]">
          {localized.name}
        </p>
        <p className="truncate text-xs text-[var(--lin-text-dim)]">
          {localized.description}
        </p>
      </div>
    </button>
  );
}

function ThemeSwatchPreview({ theme }: { theme: ThemeDefinition }) {
  return (
    <div
      className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-[var(--lin-border)]"
      style={{ background: theme.swatch.bg }}
    >
      <div
        className="absolute bottom-0 left-0 right-0 h-1/2"
        style={{ background: theme.swatch.surface }}
      />
      <div
        className="absolute left-1.5 top-1.5 h-1.5 w-4 rounded-full"
        style={{ background: theme.swatch.text }}
      />
    </div>
  );
}

function LanguageCard({
  isActive,
  language,
  onSelect,
}: {
  isActive: boolean;
  language: LanguageDefinition;
  onSelect: () => void;
}) {
  const ring = isActive
    ? "ring-2 ring-[var(--lin-text)]"
    : "ring-1 ring-[var(--lin-border)] hover:ring-[var(--lin-text-dim)]";

  return (
    <button
      aria-pressed={isActive}
      className={`flex items-center gap-3 rounded-xl bg-[var(--lin-bg-hover)] p-2.5 text-left transition ${ring}`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--lin-border)] bg-[var(--lin-bg)] text-sm font-semibold uppercase text-[var(--lin-text)]">
        {language.id}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--lin-text)]">
          {language.name}
        </p>
        <p className="truncate text-xs text-[var(--lin-text-dim)]">
          {language.sample}
        </p>
      </div>
    </button>
  );
}

function parseMode(payload: string): Mode {
  if (payload === "list") return "list";
  if (payload === "settings") return "settings";
  return "capture";
}

function PreviewLine({
  isSaving,
  parseResult,
  strings,
}: {
  isSaving: boolean;
  parseResult: ReminderParseResult | undefined;
  strings: Strings;
}) {
  if (isSaving) {
    return <>{strings.preview.saving}</>;
  }
  if (!parseResult) {
    return <>{" "}</>;
  }

  const base = parseResult.draft.scheduledAt
    ? formatDateTime(parseResult.draft.scheduledAt)
    : strings.preview.needsTime;

  const autocorrects = parseResult.issues.filter(isDisplayableAutocorrect);

  if (autocorrects.length === 0) {
    return <>{base}</>;
  }

  return (
    <>
      <span>{base}</span>
      <span className="text-[var(--lin-text-mute)]">
        {" · "}
        {formatAutocorrects(autocorrects)}
      </span>
    </>
  );
}

function isDisplayableAutocorrect(issue: ParserIssue): boolean {
  return (
    issue.code === "autocorrect" &&
    typeof issue.original === "string" &&
    typeof issue.corrected === "string"
  );
}

function formatAutocorrects(issues: ParserIssue[]): string {
  const first = issues[0];
  const head = `${first.original} → ${first.corrected}`;
  if (issues.length === 1) {
    return head;
  }
  return `${head} (+${issues.length - 1})`;
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
