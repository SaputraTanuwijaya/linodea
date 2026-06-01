/**
 * The chain view mode — a read-only, category-grouped tree of reminder chains.
 *
 * Reads the assembled forest from `list_reminder_chains` (Rust owns ordering +
 * integrity). Roots are bucketed under category section headers (category is
 * the grouping key + color). Within a section a small lane layout draws the
 * connectors: roots share one vertical trunk, each child hooks off its parent
 * with a curved elbow (git's color + consistency, YouTube's shape). Done /
 * cancelled nodes are dimmed but kept, so the tree never loses its shape.
 *
 * Read-only for now — lifecycle actions and link/unlink/reorder move in once
 * this view replaces the flat list.
 */

import { useCallback, useEffect, useState } from "react";

import { listReminderChains } from "@/entities/reminder";
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

interface FlatRow {
  node: ReminderNode;
  depth: number;
  parentIndex: number | null;
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

  const sections = REMINDER_CATEGORIES.map((category) => ({
    category,
    roots: chains.filter((chain) => chain.node.category === category),
  })).filter((section) => section.roots.length > 0);

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
              roots={roots}
              strings={strings}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryChains({
  category,
  roots,
  strings,
}: {
  category: ReminderCategory;
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
              <span
                className="flex-none rounded-full"
                style={{
                  width: 12,
                  height: 12,
                  marginLeft: 6,
                  background: categoryColor(row.node.category),
                  boxShadow: "0 0 0 3px var(--lin-bg)",
                }}
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
