/**
 * App.tsx — popup orchestrator.
 *
 * Owns:
 *   - the current popup mode (capture / list / settings) driven by Rust events
 *   - menu open/close state and the click-outside / Escape handlers for it
 *   - composition of the popup shell: logo, capture form, page body, menu
 *   - a "list refresh signal" so the list page reflects new captures
 *   - feature-state hooks (theme, language, prealerts, autostart) gathered
 *     into a single SettingsBundle for SettingsPage
 *
 * Does NOT own:
 *   - the capture form's input state or save flow → CapturePage
 *   - the reminders list data → ListPage
 *   - any settings UI → SettingsPage + per-feature sections
 *   - the popup menu rendering → widgets/popup-menu
 *
 * Aim: stay an orchestrator. New features land in `features/<name>` plus a
 * registry entry — never a JSX block here.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import "./App.css";
import {
  enableReminderNotifications,
  startReminderNotificationScheduler,
  type ReminderNotificationScheduler,
} from "@/entities/reminder";
import { useLanguage } from "@/features/language";
import { usePrealerts } from "@/features/prealerts";
import { useAutostart } from "@/features/startup";
import { useTheme } from "@/features/theme";
import { CapturePage } from "@/pages/capture";
import { ListPage } from "@/pages/list";
import { SettingsPage } from "@/pages/settings";
import { stringsFor } from "@/shared/i18n";
import type { SettingsBundle } from "@/shared/settings";
import { isTauriRuntime } from "@/shared/lib";
import {
  PopupMenu,
  type MenuAction,
  type MenuAnchor,
} from "@/widgets/popup-menu";

const MODE_EVENT = "linodea:mode";
const CAPTURE_WITH_MENU_HEIGHT = 300;

type Mode = "capture" | "list" | "settings";

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const schedulerRef = useRef<ReminderNotificationScheduler | null>(null);

  const [mode, setMode] = useState<Mode>("capture");
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState(0);

  const [theme, setTheme] = useTheme();
  const [language, setLanguage] = useLanguage();
  const [prealertConfig, setPrealertConfig] = usePrealerts();
  const [autostart, setAutostart] = useAutostart();

  const strings = useMemo(() => stringsFor(language), [language]);

  // Build the bundle once per state change so SettingsPage gets a stable
  // reference per render and the registry can render each section uniformly.
  const settingsBundle = useMemo<SettingsBundle>(
    () => ({
      strings,
      theme: { value: theme, set: setTheme },
      language: { value: language, set: setLanguage },
      prealerts: { value: prealertConfig, set: setPrealertConfig },
      autostart: { value: autostart, set: setAutostart },
    }),
    [
      strings,
      theme,
      setTheme,
      language,
      setLanguage,
      prealertConfig,
      setPrealertConfig,
      autostart,
      setAutostart,
    ],
  );

  // --- Mount-time effects --------------------------------------------------

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void enableReminderNotifications().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let mounted = true;
    let unlisten: UnlistenFn | undefined;

    void listen<string>(MODE_EVENT, (event) => {
      if (!mounted) return;
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
    if (!isTauriRuntime()) return;

    const scheduler = startReminderNotificationScheduler();
    schedulerRef.current = scheduler;
    void scheduler.sync();

    // Re-sync when the window regains focus: cheap reconciliation after the
    // machine wakes or the popup is summoned, on top of the precise timer.
    const onFocus = () => void scheduler.sync();
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      scheduler.stop();
      schedulerRef.current = null;
    };
  }, []);

  useEffect(() => {
    function onFocus() {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // --- Menu lifecycle ------------------------------------------------------

  useEffect(() => {
    if (!menuAnchor) return;

    function onMouseDown(event: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuAnchor(null);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setMenuAnchor(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuAnchor]);

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
    if (!isTauriRuntime()) return;
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

  // --- Render -------------------------------------------------------------

  return (
    <main className="flex h-screen w-screen items-start justify-center bg-transparent pt-3">
      <div className="relative w-[560px]" onContextMenu={handleContextMenu}>
        <img
          alt=""
          className="pointer-events-none absolute -left-3 -top-3 z-10 h-12 w-12 select-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.55)]"
          draggable={false}
          src="/tauri-logo.png"
        />

        <CapturePage
          inputRef={inputRef}
          language={language}
          onMenuButtonClick={handleMenuButtonClick}
          onSaved={() => {
            setListRefreshKey((k) => k + 1);
            // Arm a precise timer for the reminder just captured (e.g. an
            // "in 1m" boiling-water reminder fires on the second, not on the
            // next coarse backstop tick).
            void schedulerRef.current?.sync();
          }}
          shouldHideAfterSave={mode === "capture"}
          strings={strings}
        />

        {mode === "list" ? (
          <ListPage
            language={language}
            onMutate={() => void schedulerRef.current?.sync()}
            refreshKey={listRefreshKey}
            strings={strings}
          />
        ) : null}

        {mode === "settings" ? (
          <SettingsPage bundle={settingsBundle} />
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

function parseMode(payload: string): Mode {
  if (payload === "list") return "list";
  if (payload === "settings") return "settings";
  return "capture";
}

export default App;
