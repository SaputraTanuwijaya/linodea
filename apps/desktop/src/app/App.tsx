/**
 * App.tsx — popup orchestrator.
 *
 * Owns almost nothing on purpose. Each concern is one hook, and App composes
 * them and lays out the shell:
 *   - useMode                   which surface is showing (Rust drives it)
 *   - useReminderScheduler      firing, missed reconciliation, missedCount
 *   - useAppSettings            feature hooks → SettingsBundle
 *   - useConfirmResultRouting   the themed confirm window's answer
 *   - usePopupMenu              ••• / right-click menu state and actions
 *
 * The only state left here is `listRefreshKey`, the one signal genuinely shared
 * by two owners: a capture that just saved, and a scheduler pass that just
 * marked reminders missed.
 *
 * Does NOT own:
 *   - the capture form's input state or save flow → CapturePage
 *   - the reminders list data → ListPage
 *   - any settings UI → SettingsPage + per-feature sections
 *   - the popup menu rendering → widgets/popup-menu
 *
 * Aim: stay an orchestrator. New features land in `features/<name>` plus a
 * registry entry — never a JSX block here, and never a new `useState`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import "./App.css";
import { useAppSettings } from "./model/useAppSettings";
import { useConfirmResultRouting } from "./model/useConfirmResultRouting";
import { useMode } from "./model/useMode";
import { useReminderScheduler } from "@/entities/reminder";
import { CapturePage } from "@/pages/capture";
import { ChainPage } from "@/pages/chain";
import { ListPage } from "@/pages/list";
import { SettingsPage } from "@/pages/settings";
import { PopupMenu, usePopupMenu } from "@/widgets/popup-menu";

function App() {
  const inputRef = useRef<HTMLInputElement>(null);

  const { mode, settingsFocus, modeEpoch } = useMode();
  // Signals the list/chain pages to re-fetch. Bumped from two places: a capture
  // that just saved, and a scheduler pass that just marked reminders missed.
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const bumpListRefresh = useCallback(() => setListRefreshKey((k) => k + 1), []);

  const { missedCount, sync: syncScheduler } = useReminderScheduler({
    listVisible: mode === "list",
    onNewlyMissed: bumpListRefresh,
  });

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

  // The first-run launch-on-boot prompt is triggered from Rust setup() (see
  // desktop::prompt_launch_on_boot). It used to fire from a hidden-window
  // setTimeout here, but WebView2 throttles timers in the hidden main window, so
  // it fired unreliably. Rust owns the trigger + the answered marker now.

  // Refocus the capture input whenever the window comes back, so the popup is
  // always type-ready without a click.
  useEffect(() => {
    function onFocus() {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

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
                bumpListRefresh();
                // Arm a precise timer for the reminder just captured (e.g. an
                // "in 1m" boiling-water reminder fires on the second, not on the
                // next coarse backstop tick).
                syncScheduler();
              }}
              shouldHideAfterSave={mode === "capture"}
              strings={strings}
            />
          </>
        ) : null}

        {mode === "list" ? (
          <ListPage
            language={language}
            onMutate={syncScheduler}
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
