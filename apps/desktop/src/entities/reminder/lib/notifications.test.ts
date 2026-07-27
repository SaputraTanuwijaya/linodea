/**
 * Tests for the reminder notification state machine (`notifyDueReminders`).
 *
 * Pins the behavior of every branch — future / on-time-due / late-fire /
 * missed / already-missed / prealert-dedupe / recurring-advance / snooze-timing
 * — by driving the function over an in-memory world with a fake clock. It reads
 * through `listReminderNodes` / `getReminderFireRecords` and writes through the
 * command wrappers, so we mock those boundaries.
 *
 * Acknowledge-to-complete (L0b): a due reminder FIRES but is NOT auto-completed
 * — it stays `pending` and is marked done only on the user's Done click. The
 * tests assert no `done` write on dispatch for on-time / late / snoozed fires;
 * an unacknowledged fire stays pending + overdue, never silently `done`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderNode } from "@linodea/types";
import type { FireRecord } from "../api/commands";

// --- shared mock state (hoisted so the vi.mock factories can close over it) ---
// vi.mock factories run during import evaluation, before the module body's
// top-level statements — so the state they reference must come from vi.hoisted.
const H = vi.hoisted(() => ({
  reminders: [] as ReminderNode[],
  fireStore: {} as Record<string, FireRecord>,
  alerts: [] as AlertRecord[],
  statusUpdates: [] as StatusUpdate[],
  advances: [] as AdvanceRecord[],
  permission: true,
  prealertOffsets: [] as { minutes: number }[],
  recurNextIso: "2999-01-01T00:00:00.000Z",
}));

interface AlertRecord {
  reminderId: string;
  title: string;
  kind: "due" | "prealert";
  leadMinutes?: number;
  whenMs: number;
}
interface StatusUpdate {
  id: string;
  status: string;
  completedAt?: string;
  snoozedUntil?: string;
}
interface AdvanceRecord {
  id: string;
  scheduledAt: string;
  recurrence?: { count?: number };
}

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => H.permission),
  requestPermission: vi.fn(async () => (H.permission ? "granted" : "denied")),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: { payload?: AlertRecord }) => {
    if (cmd === "show_alert" && args?.payload) H.alerts.push(args.payload);
    return undefined;
  }),
}));

// Deterministic recurrence advance — the exact next instant isn't what we pin,
// only that a recurring reminder advances instead of auto-doning.
vi.mock("@linodea/parser", () => ({
  addRecurrenceInterval: vi.fn(() => H.recurNextIso),
}));

// Mock the whole prealerts feature surface (its real index pulls in React UI).
vi.mock("@/features/prealerts", () => ({
  getStoredPrealerts: vi.fn(() => ({ offsets: H.prealertOffsets })),
  sortDescending: (offsets: { minutes: number }[]) =>
    [...offsets].sort((a, b) => b.minutes - a.minutes),
}));

vi.mock("../api/commands", () => ({
  listReminderNodes: vi.fn(async () => H.reminders),
  getReminderFireRecords: vi.fn(async () => structuredClone(H.fireStore)),
  setReminderFireRecord: vi.fn(async (id: string, record: FireRecord) => {
    H.fireStore[id] = structuredClone(record);
  }),
  clearReminderFireRecordCommand: vi.fn(async (id: string) => {
    delete H.fireStore[id];
  }),
  updateReminderNodeStatus: vi.fn(async (patch: StatusUpdate) => {
    H.statusUpdates.push(patch);
    const target = H.reminders.find((r) => r.id === patch.id);
    if (target) target.status = patch.status as ReminderNode["status"];
    return target;
  }),
  advanceReminderRecurrence: vi.fn(
    async (patch: { id: string; scheduledAt: string; recurrence?: { count?: number } }) => {
      H.advances.push(patch);
      const target = H.reminders.find((r) => r.id === patch.id);
      return target;
    },
  ),
}));

// Import under test AFTER the mocks are declared.
import { notifyDueReminders } from "./notifications";

// --- fixtures --------------------------------------------------------------
const BASE_ISO = "2026-07-16T12:00:00.000Z";
const BASE_MS = Date.parse(BASE_ISO);
const MIN = 60_000;
const iso = (offsetMs: number) => new Date(BASE_MS + offsetMs).toISOString();

let idSeq = 0;
function makeReminder(overrides: Partial<ReminderNode> = {}): ReminderNode {
  idSeq += 1;
  return {
    id: `r${idSeq}`,
    title: "test reminder",
    rawInput: "test reminder",
    scheduledAt: BASE_ISO,
    timezone: "Asia/Jakarta",
    type: "main",
    status: "pending",
    tags: [],
    checklist: [],
    confidence: 1,
    createdAt: iso(-2 * 60 * MIN), // 2h before "now" so prealerts are eligible
    updatedAt: iso(-2 * 60 * MIN),
    createdOnDeviceId: "test-device",
    syncVersion: 0,
    ...overrides,
  };
}

beforeAll(() => {
  // notifications.ts touches localStorage in its one-time legacy migration; the
  // node env has none, so give it a minimal in-memory stub (starts empty → the
  // migration is a clean no-op).
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
});

beforeEach(() => {
  H.reminders = [];
  H.fireStore = {};
  H.alerts = [];
  H.statusUpdates = [];
  H.advances = [];
  H.permission = true;
  H.prealertOffsets = [];
  idSeq = 0;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE_ISO));
});

afterEach(() => {
  vi.useRealTimers();
});

const dueAlerts = () => H.alerts.filter((a) => a.kind === "due");
const prealertAlerts = () => H.alerts.filter((a) => a.kind === "prealert");
const doneUpdates = () => H.statusUpdates.filter((s) => s.status === "done");
const missedUpdates = () => H.statusUpdates.filter((s) => s.status === "missed");

// --- tests -----------------------------------------------------------------

describe("notifyDueReminders", () => {
  it("leaves a future reminder untouched and reports it as the next fire", async () => {
    const r = makeReminder({ scheduledAt: iso(60 * MIN) });
    H.reminders = [r];

    const result = await notifyDueReminders();

    expect(H.alerts).toHaveLength(0);
    expect(H.statusUpdates).toHaveLength(0);
    expect(result.sentCount).toBe(0);
    expect(result.missedCount).toBe(0);
    expect(result.nextFireMs).toBe(BASE_MS + 60 * MIN);
  });

  it("fires an on-time due reminder but leaves it pending (acknowledge-to-complete)", async () => {
    const r = makeReminder({ scheduledAt: BASE_ISO });
    H.reminders = [r];

    await notifyDueReminders();

    expect(dueAlerts()).toHaveLength(1);
    expect(dueAlerts()[0]).toMatchObject({ reminderId: r.id, kind: "due", whenMs: BASE_MS });
    // No silent completion — done only on the user's Done click.
    expect(doneUpdates()).toHaveLength(0);
    expect(H.statusUpdates).toHaveLength(0);
    expect(r.status).toBe("pending");
    // Deduped so it won't re-fire, and `due` blocks a later `missed` re-mark.
    expect(H.fireStore[r.id]).toEqual({ due: true });
  });

  it("late-fires a reminder overdue within the 5-min window, leaving it pending (not missed, not done)", async () => {
    const r = makeReminder({ scheduledAt: iso(-3 * MIN) });
    H.reminders = [r];

    const result = await notifyDueReminders();

    expect(dueAlerts()).toHaveLength(1);
    expect(missedUpdates()).toHaveLength(0);
    // Acknowledge-to-complete: the late fire still shows, but no auto-done.
    expect(doneUpdates()).toHaveLength(0);
    expect(r.status).toBe("pending");
    expect(H.fireStore[r.id]).toEqual({ due: true });
    expect(result.missedCount).toBe(0);
    expect(result.newlyMissed).toBe(0);
  });

  it("marks a reminder overdue beyond the 5-min window as missed (no alert, no done)", async () => {
    const r = makeReminder({ scheduledAt: iso(-10 * MIN) });
    H.reminders = [r];

    const result = await notifyDueReminders();

    expect(H.alerts).toHaveLength(0);
    expect(missedUpdates()).toHaveLength(1);
    expect(missedUpdates()[0]).toMatchObject({ id: r.id, status: "missed" });
    expect(missedUpdates()[0].completedAt).toBeUndefined();
    expect(doneUpdates()).toHaveLength(0);
    expect(result.missedCount).toBe(1);
    expect(result.newlyMissed).toBe(1);
  });

  it("counts an already-missed reminder without re-alerting or re-writing it", async () => {
    const r = makeReminder({ scheduledAt: iso(-30 * MIN), status: "missed" });
    H.reminders = [r];

    const result = await notifyDueReminders();

    expect(H.alerts).toHaveLength(0);
    expect(H.statusUpdates).toHaveLength(0);
    expect(result.missedCount).toBe(1);
    expect(result.newlyMissed).toBe(0);
  });

  it("fires a crossed prealert once and dedupes it on the next pass", async () => {
    const r = makeReminder({ scheduledAt: iso(10 * MIN) });
    H.reminders = [r];
    H.prealertOffsets = [{ minutes: 10 }]; // fire-time = due - 10min = now

    const first = await notifyDueReminders();

    expect(prealertAlerts()).toHaveLength(1);
    expect(prealertAlerts()[0]).toMatchObject({ kind: "prealert", leadMinutes: 10 });
    expect(dueAlerts()).toHaveLength(0); // due is still in the future
    expect(H.fireStore[r.id]).toEqual({ prealerts: [10] });
    expect(first.sentCount).toBe(1);

    await notifyDueReminders();

    expect(prealertAlerts()).toHaveLength(1); // no second prealert
  });

  it("advances a recurring reminder instead of completing it", async () => {
    const r = makeReminder({
      scheduledAt: BASE_ISO,
      recurrence: { freq: "daily", interval: 1, count: 3 },
    });
    H.reminders = [r];

    await notifyDueReminders();

    expect(dueAlerts()).toHaveLength(1);
    expect(H.advances).toHaveLength(1);
    expect(H.advances[0]).toMatchObject({ id: r.id, scheduledAt: H.recurNextIso });
    expect(H.advances[0].recurrence?.count).toBe(2); // decremented
    expect(doneUpdates()).toHaveLength(0);
    expect(H.fireStore[r.id]).toBeUndefined(); // fire record forgotten for next cycle
  });

  it("fires a snoozed reminder at snoozedUntil, not its original scheduledAt", async () => {
    // scheduledAt is 1h ago (would be `missed`); snoozedUntil is now → due.
    const r = makeReminder({
      status: "snoozed",
      scheduledAt: iso(-60 * MIN),
      snoozedUntil: BASE_ISO,
    });
    H.reminders = [r];

    await notifyDueReminders();

    expect(dueAlerts()).toHaveLength(1);
    expect(dueAlerts()[0].whenMs).toBe(BASE_MS);
    expect(missedUpdates()).toHaveLength(0);
    expect(doneUpdates()).toHaveLength(0); // acknowledge-to-complete: no auto-done
    expect(r.status).toBe("snoozed"); // unchanged; user acknowledges via the alert
  });
});
