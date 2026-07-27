/**
 * The chain view mode — a tag-grouped tree of reminder chains.
 *
 * Reads the assembled forest from `list_reminder_chains` (Rust owns ordering +
 * integrity). Roots are bucketed under tag section headers. Within a section a
 * small lane layout draws the connectors: roots share one vertical trunk, each
 * child hooks off its parent with a curved elbow (git's color + consistency,
 * YouTube's shape). Done / cancelled nodes are dimmed but kept, so the tree
 * never loses its shape.
 *
 * **Grouping key is `tags[0]`, not the whole tag list.** A reminder can carry up
 * to five tags, but a tree section needs each node to appear exactly once —
 * showing a two-tag reminder under two headers would duplicate its children and
 * break the connector math. The first tag the user typed is the primary one, and
 * the row's tag chips show the rest. Grouping by any/all tags is deliberately
 * deferred (it needs a filter surface, not a second section list).
 *
 * The ONLY interaction is retagging: click a node's dot to edit its tags. There
 * is no auto-guess to correct anymore — tags come from what the user typed —
 * so this is plain editing, optional and non-destructive. Deliberately NOT a
 * workspace: no link/reorder/arrange (that would make it a calendar).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import {
  collectTagsInUse,
  deleteReminderNode,
  groupChainsByTag,
  listReminderChains,
  primaryTag,
  setReminderTags,
} from "@/entities/reminder";
import { tagColor } from "@/shared/config";
import type { Strings } from "@/shared/i18n";
import { formatDateTime, isTauriRuntime } from "@/shared/lib";
import {
  MAX_TAGS_PER_REMINDER,
  normalizeTag,
  type ChainNode,
  type ReminderNode,
} from "@linodea/types";

const ROW_H = 40;
const BASE_X = 12;
const INDENT = 26;
const TAG_MENU_HEIGHT = 268;

interface FlatRow {
  node: ReminderNode;
  depth: number;
  parentIndex: number | null;
}

interface TagMenuState {
  id: string;
  /** The reminder's current tags, so the popover can show and remove them. */
  tags: string[];
  x: number;
  y: number;
}

/** Effective time for ordering/display — a snooze moves the reminder. */
function effTime(node: ReminderNode): string {
  return node.snoozedUntil ?? node.scheduledAt;
}

/**
 * Flatten a section's roots into time-ordered rows.
 *
 * Within each node, children earlier than it (preps) render ABOVE it, later ones
 * (follow-ups) BELOW — both sorted by time, recursively — so the vertical order
 * reads chronologically. Depth still maps to indentation, so recursive `/link`
 * chains keep their level legible (the connector points up or down accordingly).
 *
 * Two passes: emit rows in order recording each row's parent id, then resolve
 * parent ids to row indices (a parent can now sit *below* its earlier children,
 * so its index isn't known at emit time).
 */
function flattenChains(roots: ChainNode[]): FlatRow[] {
  const ordered: Array<{ node: ReminderNode; depth: number; parentId: string | null }> = [];

  const walk = (chain: ChainNode, depth: number, parentId: string | null) => {
    const kids = [...chain.children].sort((a, b) =>
      effTime(a.node).localeCompare(effTime(b.node)),
    );
    const t = effTime(chain.node);
    kids
      .filter((c) => effTime(c.node).localeCompare(t) < 0)
      .forEach((c) => walk(c, depth + 1, chain.node.id));
    ordered.push({ node: chain.node, depth, parentId });
    kids
      .filter((c) => effTime(c.node).localeCompare(t) >= 0)
      .forEach((c) => walk(c, depth + 1, chain.node.id));
  };

  [...roots]
    .sort((a, b) => effTime(a.node).localeCompare(effTime(b.node)))
    .forEach((root) => walk(root, 0, null));

  const indexById = new Map<string, number>();
  ordered.forEach((row, i) => indexById.set(row.node.id, i));
  return ordered.map((row) => ({
    node: row.node,
    depth: row.depth,
    parentIndex:
      row.parentId !== null ? indexById.get(row.parentId) ?? null : null,
  }));
}

/** Every done/cancelled node id across the whole forest (all depths). These
 * are the rows shown dimmed + struck through; "Clear completed" removes them.
 * Pending descendants are NOT collected — the chain-aware delete promotes them
 * into the gap, so clearing a finished parent never drops an active child. */
function collectClearableIds(roots: ChainNode[]): string[] {
  const ids: string[] = [];
  const walk = (chain: ChainNode) => {
    if (chain.node.status === "done" || chain.node.status === "cancelled") {
      ids.push(chain.node.id);
    }
    chain.children.forEach(walk);
  };
  roots.forEach(walk);
  return ids;
}

const laneX = (depth: number) => BASE_X + depth * INDENT;
const rowY = (index: number) => index * ROW_H + ROW_H / 2;

/** From the parent's lane, run vertically toward the child's row (down for a
 * follow-up, up for a prep) then round into the child's lane. */
function elbow(parentX: number, parentY: number, childX: number, childY: number): string {
  const approach = childY >= parentY ? childY - 10 : childY + 10;
  return `M ${parentX} ${parentY} L ${parentX} ${approach} Q ${parentX} ${childY} ${parentX + 10} ${childY} L ${childX - 8} ${childY}`;
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
  const [isClearing, setIsClearing] = useState(false);
  const [tagMenu, setTagMenu] = useState<TagMenuState | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const clearableIds = useMemo(() => collectClearableIds(chains), [chains]);

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

  // Close the tag menu on outside click / Escape.
  useEffect(() => {
    if (!tagMenu) return;
    function onMouseDown(event: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setTagMenu(null);
      }
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setTagMenu(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tagMenu]);

  /** Every tag in use, for the popover's quick-pick list. */
  const tagsInUse = useMemo(() => collectTagsInUse(chains), [chains]);

  function openTagMenu(node: ReminderNode, event: ReactMouseEvent) {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setTagDraft("");
    setTagMenu({ id: node.id, tags: node.tags, x: rect.left, y: rect.bottom + 4 });
  }

  async function clearCompleted() {
    if (!isTauriRuntime() || clearableIds.length === 0 || isClearing) return;
    setIsClearing(true);
    try {
      // Delete by stable id; each delete re-stitches the chain (Rust owns it).
      for (const id of clearableIds) {
        await deleteReminderNode(id);
      }
      await refresh();
    } catch {
      // Silent.
    } finally {
      setIsClearing(false);
    }
  }

  /** Write a tag list and close the popover. Rust normalizes + caps it. */
  async function applyTags(tags: string[]) {
    if (!tagMenu) return;
    const id = tagMenu.id;
    setTagMenu(null);
    try {
      await setReminderTags({ id, tags, updatedAt: new Date().toISOString() });
      await refresh();
    } catch {
      // Silent.
    }
  }

  function addTag(raw: string) {
    const tag = normalizeTag(raw);
    if (!tag || !tagMenu) return;
    // Re-adding an existing tag is a no-op rather than a duplicate row.
    if (tagMenu.tags.includes(tag)) {
      setTagMenu(null);
      return;
    }
    void applyTags([...tagMenu.tags, tag]);
  }

  // Sections come from the tags actually in use, not a fixed enum. Grouping and
  // ordering live in the entity (`groupChainsByTag`) so they're unit-tested.
  const sections = useMemo(() => groupChainsByTag(chains), [chains]);

  // Flip the menu above the anchor when it would overflow the window bottom.
  const menuTop =
    tagMenu && tagMenu.y + TAG_MENU_HEIGHT > window.innerHeight
      ? Math.max(4, tagMenu.y - TAG_MENU_HEIGHT - 8)
      : tagMenu?.y;

  return (
    <section className="mt-3 rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] px-4 py-3 shadow-2xl backdrop-blur transition-colors">
      <header className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--lin-text-dim)]">
          {strings.chain.queued}
        </p>
        {clearableIds.length > 0 ? (
          <button
            className="flex-none rounded-md px-2 py-0.5 text-xs text-[var(--lin-text-mute)] transition hover:bg-[var(--lin-danger-bg)] hover:text-[var(--lin-danger)] disabled:opacity-50"
            disabled={isClearing}
            onClick={() => void clearCompleted()}
            type="button"
          >
            {strings.chain.clear} ({clearableIds.length})
          </button>
        ) : null}
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
          {sections.map(({ tag, roots }) => (
            <TagChains
              key={tag || UNTAGGED_SECTION_KEY}
              onDotClick={openTagMenu}
              roots={roots}
              strings={strings}
              tag={tag}
            />
          ))}
        </div>
      )}

      {tagMenu ? (
        <div
          className="fixed z-50 min-w-[184px] rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg)] p-1 shadow-2xl"
          ref={menuRef}
          style={{ left: tagMenu.x, top: menuTop }}
        >
          {tagMenu.tags.length < MAX_TAGS_PER_REMINDER ? (
            <input
              autoFocus
              className="mb-1 w-full rounded-md bg-[var(--lin-bg-hover)] px-2.5 py-1.5 text-sm text-[var(--lin-text)] outline-none placeholder:text-[var(--lin-text-mute)]"
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addTag(tagDraft);
              }}
              placeholder={strings.chain.tagInput}
              value={tagDraft}
            />
          ) : null}

          {/* The reminder's own tags — click one to remove it. */}
          {tagMenu.tags.map((tag) => (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-[var(--lin-text)] transition hover:bg-[var(--lin-danger-bg)] hover:text-[var(--lin-danger)]"
              key={tag}
              onClick={() => void applyTags(tagMenu.tags.filter((t) => t !== tag))}
              type="button"
            >
              <span
                className="h-2.5 w-2.5 flex-none rounded-full"
                style={{ background: tagColor(tag) }}
              />
              <span className="min-w-0 flex-1 truncate">{tag}</span>
              <span aria-hidden className="flex-none text-xs">
                ×
              </span>
            </button>
          ))}

          {/* Tags used elsewhere — one click reuses one instead of retyping. */}
          {tagsInUse
            .filter((tag) => !tagMenu.tags.includes(tag))
            .slice(0, 6)
            .map((tag) => (
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-[var(--lin-text-dim)] transition hover:bg-[var(--lin-bg-hover)] hover:text-[var(--lin-text)]"
                key={tag}
                onClick={() => addTag(tag)}
                type="button"
              >
                <span
                  className="h-2.5 w-2.5 flex-none rounded-full"
                  style={{ background: tagColor(tag) }}
                />
                <span className="min-w-0 flex-1 truncate">{tag}</span>
              </button>
            ))}

          {tagMenu.tags.length > 1 ? (
            <button
              className="mt-1 w-full rounded-md px-2.5 py-1.5 text-left text-xs text-[var(--lin-text-mute)] transition hover:bg-[var(--lin-danger-bg)] hover:text-[var(--lin-danger)]"
              onClick={() => void applyTags([])}
              type="button"
            >
              {strings.chain.clearTags}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** React key for the untagged section — `tag` is "" there, which is falsy. */
const UNTAGGED_SECTION_KEY = "__untagged__";

function TagChains({
  onDotClick,
  roots,
  strings,
  tag,
}: {
  onDotClick: (node: ReminderNode, event: ReactMouseEvent) => void;
  roots: ChainNode[];
  strings: Strings;
  /** The section's primary tag; `""` (the untagged sentinel) for the no-tags bucket. */
  tag: string;
}) {
  const rows = flattenChains(roots);
  const height = rows.length * ROW_H;
  const lineColor = tagColor(tag || undefined);

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
        {tag || strings.chain.untagged}
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
                aria-label={strings.chain.setTags}
                className="flex-none cursor-pointer rounded-full"
                onClick={(event) => onDotClick(row.node, event)}
                style={{
                  width: 12,
                  height: 12,
                  marginLeft: 6,
                  background: tagColor(primaryTag(row.node) || undefined),
                  boxShadow: "0 0 0 3px var(--lin-bg)",
                }}
                title={strings.chain.setTags}
                type="button"
              />
              <span
                className={`ml-2.5 min-w-0 truncate text-sm ${
                  isDone ? "text-[var(--lin-text-mute)] line-through" : "text-[var(--lin-text)]"
                }`}
              >
                {row.node.title}
              </span>
              {/* Secondary tags only — the primary one is already the section
                  header, so repeating it on every row would be noise. */}
              {row.node.tags.slice(1).map((tag) => (
                <span
                  className="ml-1.5 flex-none rounded px-1.5 py-0.5 text-[10px] leading-none"
                  key={tag}
                  style={{ color: tagColor(tag), background: "var(--lin-bg-hover)" }}
                >
                  {tag}
                </span>
              ))}
              <span className="ml-3 flex-1 whitespace-nowrap text-right text-xs text-[var(--lin-text-dim)]">
                {meta}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
