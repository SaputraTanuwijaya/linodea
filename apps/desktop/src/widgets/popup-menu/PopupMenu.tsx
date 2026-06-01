/**
 * Right-click / `•••` context menu rendered above the popup.
 *
 * State (open/closed, anchor position) lives in App.tsx because the menu's
 * trigger is the popup shell itself, not this component. PopupMenu is
 * stateless apart from layout clamping.
 */

import type { RefObject } from "react";

import type { Strings } from "@/shared/i18n";

export type MenuAction = "capture" | "list" | "chain" | "settings" | "hide" | "quit";

export interface MenuAnchor {
  x: number;
  y: number;
}

export type PopupMenuMode = "capture" | "list" | "chain" | "settings";

const MENU_WIDTH = 200;
const MENU_HEIGHT = 256;

export function PopupMenu({
  anchor,
  menuRef,
  mode,
  onAction,
  strings,
}: {
  anchor: MenuAnchor;
  menuRef: RefObject<HTMLDivElement | null>;
  mode: PopupMenuMode;
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
        disabled={mode === "chain"}
        label={strings.menu.chains}
        onClick={() => onAction("chain")}
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
