/**
 * App.tsx — popup orchestrator.
 *
 * Owns:
 *   - the current popup mode (capture / list / settings) driven by Rust events
 *   - menu open/close state and the click-outside / Escape handlers for it
 *   - composition of the popup shell: logo, capture form, page body, menu
 *   - a "list refresh signal" so the list page reflects new captures
 *   - feature-state hooks (theme, language, prealerts, autostart, app-update)
 *     gathered into a single SettingsBundle for SettingsPage
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

import { useCallback, useEffect, useRef, useState } from "react";

import "./App.css";
import { useAppSettings } from "./model/useAppSettings";
import { useConfirmResultRouting } from "./model/useConfirmResultRouting";
import { useMode } from "./model/useMode";
import {
  enableReminderNotifications,
  startReminderNotificationScheduler,
  type ReminderNotificationScheduler,
} from "@/entities/reminder";
import { CapturePage } from "@/pages/capture";
import { ChainPage } from "@/pages/chain";
import { ListPage } from "@/pages/list";
import { SettingsPage } from "@/pages/settings";
import { isTauriRuntime } from "@/shared/lib";
import { PopupMenu, usePopupMenu } from "@/widgets/popup-menu";

function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const schedulerRef = useRef<ReminderNotificationScheduler | null>(null);

  const { mode, settingsFocus, modeEpoch } = useMode();
  const [listRefreshKey, setListRefreshKey] = useState(0);
  // Count of reminders sitting in the `missed` state, read from each scheduler
  // sync. Surfaced as a badge on the capture bar's menu button so a user who
  // relaunches (landing in capture, not the list) sees they have missed items.
  const [missedCount, setMissedCount] = useState(0);

  const {
    bundle: settingsBundle,
    strings,
    language,
    aiAssist,
    setAutostart,
    updateReady,
  } = useAppSettings();

  const menu = usePopupMenu(mode, modeEpoch);

  useConfirmResultRouting(setAutostart);

  // Apply a scheduler pass's result: update the missed badge, and if the pass
  // just moved reminders into `missed`, bump the list refresh signal. Marking
  // missed is async; without this an already-open list keeps showing them as
  // pending (it read the rows before the pass wrote the new status) until it's
  // reopened. A coalesced pass returns undefined, so this no-ops for those.
  const applySyncResult = useCallback(
    (result?: { missedCount: number; newlyMissed: number }) => {
      if (!result) return;
      setMissedCount(result.missedCount);
      if (result.newlyMissed > 0) setListRefreshKey((k) => k + 1);
    },
    [],
  );

  // --- Mount-time effects --------------------------------------------------

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void enableReminderNotifications().catch(() => undefined);
  }, []);

  // The first-run launch-on-boot prompt is triggered from Rust setup() (see
  // desktop::prompt_launch_on_boot). It used to fire from a hidden-window
  // setTimeout here, but WebView2 throttles timers in the hidden main window, so
  // it fired unreliably. Rust owns the trigger + the answered marker now.

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const scheduler = startReminderNotificationScheduler();
    schedulerRef.current = scheduler;

    // The very first sync can land before the Tauri IPC bridge is ready at cold
    // start; `listReminderNodes()` then fails, the scheduler swallows it, and
    // nothing is marked missed — so the badge/list only caught up on a later
    // interaction-triggered sync (the reported bug). `sync()` returns a result
    // on success and `undefined` on failure, so retry a few times until one
    // lands. (The 15s backstop would eventually recover it; this just makes the
    // first pass prompt so the missed badge shows right after relaunch.)
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < 6 && !cancelled; attempt += 1) {
        const result = await scheduler.sync();
        if (cancelled) return;
        if (result) {
          applySyncResult(result);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
    })();

    // Re-sync when the window regains focus: cheap reconciliation after the
    // machine wakes or the popup is summoned, on top of the precise timer.
    const onFocus = () => void scheduler.sync().then(applySyncResult);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      scheduler.stop();
      schedulerRef.current = null;
    };
  }, [applySyncResult]);

  useEffect(() => {
    function onFocus() {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Opening the reminder list runs a scheduler pass first, so any reminder that
  // just crossed into `missed` is marked before/at open time rather than waiting
  // for the next backstop tick. `applySyncResult` then refreshes the open list.
  useEffect(() => {
    if (mode !== "list" || !isTauriRuntime()) return;
    void schedulerRef.current?.sync().then(applySyncResult);
  }, [mode, applySyncResult]);

  // --- Render -------------------------------------------------------------

  // Popup z-scale (all inside the single main window). The capture bar and each
  // page body both use `backdrop-blur`, which creates a stacking context, so
  // ordering can't be left to DOM order — later-rendered page bodies would cover
  // the capture bar's dropdowns. Explicit layers, low → high:
  //   page body (list/chain/settings)      base (implicit; its own bg + context)
  //   capture bar + slash/anchor dropdowns z-20 (set on the form in CapturePage)
  //   logo ribbon                          z-30 (decorative, sits over the bar)
  //   floating menus (••• / context menu)  z-50 (fixed; top layer)
  return (
    <main className="flex h-screen w-screen items-start justify-center bg-transparent pt-3">
      <div className="relative w-[560px]" onContextMenu={menu.handleContextMenu}>
        {mode !== "settings" ? (
          <>
            <img
              alt=""
              className="pointer-events-none absolute -left-5 -top-7 z-30 h-20 w-20 rotate-[8deg] select-none object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
              draggable={false}
              src="/brand/logo.png"
            />

            <CapturePage
              aiAssist={aiAssist}
              inputRef={inputRef}
              language={language}
              missedCount={missedCount}
              onMenuButtonClick={menu.handleMenuButtonClick}
              updateReady={updateReady}
              onSaved={() => {
                setListRefreshKey((k) => k + 1);
                // Arm a precise timer for the reminder just captured (e.g. an
                // "in 1m" boiling-water reminder fires on the second, not on the
                // next coarse backstop tick).
                void schedulerRef.current?.sync().then(applySyncResult);
              }}
              shouldHideAfterSave={mode === "capture"}
              strings={strings}
            />
          </>
        ) : null}

        {mode === "list" ? (
          <ListPage
            language={language}
            onMutate={() => void schedulerRef.current?.sync().then(applySyncResult)}
            refreshKey={listRefreshKey}
            strings={strings}
          />
        ) : null}

        {mode === "chain" ? (
          <ChainPage refreshKey={listRefreshKey} strings={strings} />
        ) : null}

        {mode === "settings" ? (
          <SettingsPage bundle={settingsBundle} focusSectionId={settingsFocus} />
        ) : null}
      </div>

      {menu.anchor ? (
        <PopupMenu
          anchor={menu.anchor}
          menuRef={menu.menuRef}
          missedCount={missedCount}
          mode={mode}
          onAction={menu.handleAction}
          strings={strings}
          updateReady={updateReady}
        />
      ) : null}
    </main>
  );
}

export default App;
