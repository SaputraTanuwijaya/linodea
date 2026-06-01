/**
 * The chain view mode — a category-grouped tree of reminder chains.
 *
 * Reads the assembled forest from `list_reminder_chains` (Rust owns ordering +
 * integrity). Roots are bucketed under category section headers (category is
 * the grouping key + color). Within a section a small lane layout draws the
 * connectors: roots share one vertical trunk, each child hooks off its parent
 * with a curved elbow (git's color + consistency, YouTube's shape). Done /
 * cancelled nodes are dimmed but kept, so the tree never loses its shape.
 *
 * The ONLY interaction is the manual category-correction escape hatch: click a
 * node's category dot to recategorize it (parser's guess is just a default).
 * Optional and non-destructive — reminders work fine uncategorized; this is for
 * the rare miss, not a management chore. Deliberately NOT a workspace: no
 * link/reorder/arrange (that would make it a calendar).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { listReminderChains, setReminderCategory } from "@/entities/reminder";
import { categoryColor } from "@/shared/config";
import type { Strings } from "@/shared/i18n";
import { formatDateTime, isTauriRuntime } from "@/shared/lib";
import {
  REMINDER_CATEGORIES,
  type ChainNode,
  type ReminderCategory,
  type ReminderNode,
} from "@linodea/types";

const ROW_H = 40;
const BASE_X = 12;
const INDENT = 26;
const CATEGORY_MENU_HEIGHT = 268;

interface FlatRow {
  node: ReminderNode;
  depth: number;
  parentIndex: number | null;
}

interface CategoryMenuState {
  id: string;
  x: number;
  y: number;
}

/** Depth-first flatten of a category's roots into rows, tracking each row's
 * parent row index so the connectors can be drawn. */
function flattenChains(roots: ChainNode[]): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (chain: ChainNode, depth: number, parentIndex: number | null) => {
    const index = rows.length;
    rows.push({ node: chain.node, depth, parentIndex });
    chain.children.forEach((child) => walk(child, depth + 1, index));
  };
  roots.forEach((root) => walk(root, 0, null));
  return rows;
}

const laneX = (depth: number) => BASE_X + depth * INDENT;
const rowY = (index: number) => index * ROW_H + ROW_H / 2;

/** Vertical down the parent's lane, rounding into the child's lane at its row. */
function elbow(parentX: number, parentY: number, childX: number, childY: number): string {
  return `M ${parentX} ${parentY} L ${parentX} ${childY - 10} Q ${parentX} ${childY} ${parentX + 10} ${childY} L ${childX - 8} ${childY}`;
}

export function ChainPage({
  refreshKey,
  strings,
}: {
  /** Bumping this triggers a refetch — used after a save in capture mode. */
  refreshKey: number;
  strings: Strings;
}) {
  const [chains, setChains] = useState<ChainNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [categoryMenu, setCategoryMenu] = useState<CategoryMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setIsLoading(true);
    try {
      setChains(await listReminderChains());
    } catch {
      // Silent.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  // Close the category menu on outside click / Escape.
  useEffect(() => {
    if (!categoryMenu) return;
    function onMouseDown(event: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setCategoryMenu(null);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setCategoryMenu(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [categoryMenu]);

  function openCategoryMenu(id: string, event: ReactMouseEvent) {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setCategoryMenu({ id, x: rect.left, y: rect.bottom + 4 });
  }

  async function pickCategory(category: ReminderCategory) {
    if (!categoryMenu) return;
    const id = categoryMenu.id;
    setCategoryMenu(null);
    try {
      await setReminderCategory({ id, category, updatedAt: new Date().toISOString() });
      await refresh();
    } catch {
      // Silent.
    }
  }

  const sections = REMINDER_CATEGORIES.map((category) => ({
    category,
    roots: chains.filter((chain) => chain.node.category === category),
  })).filter((section) => section.roots.length > 0);

  // Flip the menu above the anchor when it would overflow the window bottom.
  const menuTop =
    categoryMenu && categoryMenu.y + CATEGORY_MENU_HEIGHT > window.innerHeight
      ? Math.max(4, categoryMenu.y - CATEGORY_MENU_HEIGHT - 8)
      : categoryMenu?.y;

  return (
    <section className="mt-3 rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] px-4 py-3 shadow-2xl backdrop-blur transition-colors">
      <header className="mb-2 px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--lin-text-dim)]">
          {strings.chain.queued}
        </p>
      </header>
      {isLoading && sections.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-[var(--lin-text-mute)]">
          {strings.list.loading}
        </p>
      ) : sections.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-[var(--lin-text-mute)]">
          {strings.chain.empty}
        </p>
      ) : (
        <div className="max-h-[300px] space-y-3 overflow-y-auto">
          {sections.map(({ category, roots }) => (
            <CategoryChains
              category={category}
              key={category}
              onDotClick={openCategoryMenu}
              roots={roots}
              strings={strings}
            />
          ))}
        </div>
      )}

      {categoryMenu ? (
        <div
          className="fixed z-50 min-w-[160px] rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg)] p-1 shadow-2xl"
          ref={menuRef}
          style={{ left: categoryMenu.x, top: menuTop }}
        >
          {REMINDER_CATEGORIES.map((category) => (
            <button
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-[var(--lin-text)] transition hover:bg-[var(--lin-bg-hover)]"
              key={category}
              onClick={() => void pickCategory(category)}
              type="button"
            >
              <span
                className="h-2.5 w-2.5 flex-none rounded-full"
                style={{ background: categoryColor(category) }}
              />
              {strings.category[category]}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function CategoryChains({
  category,
  onDotClick,
  roots,
  strings,
}: {
  category: ReminderCategory;
  onDotClick: (id: string, event: ReactMouseEvent) => void;
  roots: ChainNode[];
  strings: Strings;
}) {
  const rows = flattenChains(roots);
  const height = rows.length * ROW_H;
  const lineColor = categoryColor(category);

  const rootIndexes = rows
    .map((row, index) => (row.parentIndex === null ? index : -1))
    .filter((index) => index >= 0);
  const trunk =
    rootIndexes.length > 1
      ? `M ${laneX(0)} ${rowY(rootIndexes[0])} L ${laneX(0)} ${rowY(rootIndexes[rootIndexes.length - 1])}`
      : null;
  const hooks = rows
    .map((row, index) =>
      row.parentIndex === null
        ? null
        : elbow(laneX(row.depth - 1), rowY(row.parentIndex), laneX(row.depth), rowY(index)),
    )
    .filter((path): path is string => path !== null);

  const maxDepth = rows.reduce((max, row) => Math.max(max, row.depth), 0);
  const gutterWidth = laneX(maxDepth) + 24;

  return (
    <div>
      <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wider" style={{ color: lineColor }}>
        {strings.category[category]}
      </p>
      <div className="relative" style={{ height }}>
        <svg
          className="absolute left-0 top-0 overflow-visible"
          height={height}
          style={{ zIndex: 0, pointerEvents: "none" }}
          width={gutterWidth}
        >
          <g fill="none" stroke={lineColor} strokeLinecap="round" strokeWidth={2}>
            {trunk ? <path d={trunk} /> : null}
            {hooks.map((path, index) => (
              <path d={path} key={index} />
            ))}
          </g>
        </svg>
        {rows.map((row) => {
          const isDone = row.node.status === "done" || row.node.status === "cancelled";
          const meta = row.node.recurrence
            ? `${formatDateTime(row.node.snoozedUntil ?? row.node.scheduledAt)} · ↻ ${strings.recurrence.describe(row.node.recurrence)}`
            : formatDateTime(row.node.snoozedUntil ?? row.node.scheduledAt);
          return (
            <div
              className="relative flex items-center"
              key={row.node.id}
              style={{ height: ROW_H, zIndex: 1, paddingLeft: row.depth * INDENT }}
            >
              <button
                aria-label={strings.chain.setCategory}
                className="flex-none cursor-pointer rounded-full"
                onClick={(event) => onDotClick(row.node.id, event)}
                style={{
                  width: 12,
                  height: 12,
                  marginLeft: 6,
                  background: categoryColor(row.node.category),
                  boxShadow: "0 0 0 3px var(--lin-bg)",
                }}
                title={strings.chain.setCategory}
                type="button"
              />
              <span
                className={`ml-2.5 min-w-0 flex-1 truncate text-sm ${
                  isDone ? "text-[var(--lin-text-mute)] line-through" : "text-[var(--lin-text)]"
                }`}
              >
                {row.node.title}
              </span>
              <span className="ml-3 flex-none whitespace-nowrap text-xs text-[var(--lin-text-dim)]">
                {meta}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
