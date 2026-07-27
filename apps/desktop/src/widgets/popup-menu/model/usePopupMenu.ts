/**
 * Open/close state and trigger handlers for the `•••` / right-click menu.
 *
 * Lives with the widget rather than in App.tsx: the menu's anchor position,
 * its dismiss rules (click-outside, Escape) and its action routing are one
 * concern, and nothing outside the popup shell needs to see them.
 *
 * The shell still owns the *rendering* decision (`anchor ? <PopupMenu…> : null`)
 * because the menu is positioned `fixed` against the window, not nested in the
 * widget.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { isTauriRuntime } from "@/shared/lib";

import type { MenuAction, MenuAnchor, PopupMenuMode } from "../ui/PopupMenu";

/**
 * Capture mode's window is only as tall as the bar, so the menu would be
 * clipped by the OS window. Grow the window before opening. Every other mode is
 * already tall enough.
 */
const CAPTURE_WITH_MENU_HEIGHT = 300;

/**
 * @param mode          current popup mode; only capture needs the window grown.
 * @param dismissSignal any value that changes when the user navigates. The menu
 *                      closes whenever it changes. Callers pass a mode *event*
 *                      counter rather than `mode` itself, so a repeat of the
 *                      mode you're already in (the tray can issue one) still
 *                      dismisses the menu.
 */
export function usePopupMenu(mode: PopupMenuMode, dismissSignal?: unknown) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const close = useCallback(() => setAnchor(null), []);

  useEffect(() => {
    setAnchor(null);
  }, [dismissSignal]);

  useEffect(() => {
    if (!anchor) return;

    function onMouseDown(event: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setAnchor(null);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setAnchor(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor]);

  async function openMenuAt(x: number, y: number) {
    if (mode === "capture" && isTauriRuntime()) {
      await invoke("set_popup_height", { height: CAPTURE_WITH_MENU_HEIGHT })
        .catch(() => undefined);
    }
    setAnchor({ x, y });
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

  // Quitting stops all reminders (they only fire while the app runs), so gate it
  // behind the themed confirm window. The tray Quit item shows the same window
  // from Rust; both resolve via `useConfirmResultRouting`.
  function requestQuit() {
    setAnchor(null);
    void invoke("show_confirm", { payload: { kind: "quit" } }).catch(
      () => undefined,
    );
  }

  async function handleAction(action: MenuAction) {
    setAnchor(null);
    if (!isTauriRuntime()) return;
    try {
      switch (action) {
        case "capture":
          await invoke("enter_capture_mode");
          break;
        case "list":
          await invoke("enter_list_mode");
          break;
        case "chain":
          await invoke("enter_chain_mode");
          break;
        case "settings":
          await invoke("enter_settings_mode");
          break;
        case "hide":
          await invoke("hide_main_window");
          break;
        case "quit":
          requestQuit();
          break;
      }
    } catch {
      // Silent.
    }
  }

  return {
    anchor,
    menuRef,
    close,
    handleAction,
    handleContextMenu,
    handleMenuButtonClick,
  };
}
