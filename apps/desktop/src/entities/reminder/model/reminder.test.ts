/**
 * Tests for the chain view's tag grouping.
 *
 * The invariant worth pinning: **one reminder appears in exactly one section.**
 * Sections used to come from a closed six-value category enum, which guaranteed
 * that for free. Tags don't — a reminder can carry five — so grouping keys on
 * `tags[0]` and these tests are what stops a future change from grouping by
 * every tag and silently duplicating nodes (which would also break the SVG
 * connector geometry, since it's drawn from row indices within one section).
 */

import { describe, expect, it } from "vitest";
import type { ChainNode, ReminderNode } from "@linodea/types";

import { collectTagsInUse, groupChainsByTag, primaryTag, UNTAGGED } from "./reminder";

function node(id: string, tags: string[]): ReminderNode {
  return {
    id,
    title: id,
    rawInput: id,
    scheduledAt: "2026-07-27T02:00:00.000Z",
    timezone: "Asia/Jakarta",
    type: "main",
    status: "pending",
    tags,
    checklist: [],
    confidence: 0.9,
    createdAt: "2026-07-26T02:00:00.000Z",
    updatedAt: "2026-07-26T02:00:00.000Z",
    createdOnDeviceId: "device-1",
    syncVersion: 0,
  };
}

const chain = (id: string, tags: string[], children: ChainNode[] = []): ChainNode => ({
  node: node(id, tags),
  children,
});

describe("primaryTag", () => {
  it("is the first tag typed", () => {
    expect(primaryTag(node("a", ["kerja", "urgent"]))).toBe("kerja");
  });

  it("is the untagged sentinel when there are no tags", () => {
    expect(primaryTag(node("a", []))).toBe(UNTAGGED);
  });
});

describe("groupChainsByTag", () => {
  it("groups a multi-tag reminder into exactly one section", () => {
    const sections = groupChainsByTag([chain("a", ["kerja", "urgent", "rapat"])]);

    expect(sections).toHaveLength(1);
    expect(sections[0].tag).toBe("kerja");
    expect(sections[0].roots.map((r) => r.node.id)).toEqual(["a"]);
  });

  it("orders tags alphabetically and puts untagged last", () => {
    const sections = groupChainsByTag([
      chain("none", []),
      chain("z", ["zeta"]),
      chain("a", ["alpha"]),
      chain("k", ["kerja"]),
    ]);

    expect(sections.map((s) => s.tag)).toEqual(["alpha", "kerja", "zeta", UNTAGGED]);
  });

  it("keeps every root exactly once across all sections", () => {
    const roots = [
      chain("a", ["kerja"]),
      chain("b", ["kerja", "urgent"]),
      chain("c", []),
      chain("d", ["skripsi"]),
    ];

    const ids = groupChainsByTag(roots).flatMap((s) => s.roots.map((r) => r.node.id));

    expect(ids.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("returns no sections for an empty forest", () => {
    expect(groupChainsByTag([])).toEqual([]);
  });
});

describe("collectTagsInUse", () => {
  it("gathers tags from every depth, deduped and sorted", () => {
    const forest = [
      chain("root", ["kerja"], [chain("kid", ["skripsi", "kerja"])]),
      chain("other", ["alpha"]),
    ];

    expect(collectTagsInUse(forest)).toEqual(["alpha", "kerja", "skripsi"]);
  });

  it("ignores untagged reminders rather than emitting an empty string", () => {
    expect(collectTagsInUse([chain("a", []), chain("b", ["kerja"])])).toEqual(["kerja"]);
  });
});
