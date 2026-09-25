// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  ADMIN,
  APP,
  DUBAI,
  KOLKATA,
  baseSnapshot,
  claimed,
  fakeRpc,
  fakeSleep,
  fakeTransport,
  memoryLog,
  org,
  task,
} from "./fixtures";
import type { EmailRpc } from "./rpc";
import type { EmailSnapshot } from "./snapshot";
import {
  ORG_CACHE_MAX_AGE_MS,
  createPlanningGate,
  runEmailTick,
  type PlanningGate,
} from "./worker";

// Friday 25 Sep 2026. Kolkata's window is 02:30–05:30Z (08:00–11:00 IST), Dubai's 04:00–07:00Z.
const at = (time: string) => new Date(`2026-09-25T${time}Z`);
const MINUTE = 60_000;

const withDueTomorrow = (overrides: Partial<EmailSnapshot> = {}) =>
  baseSnapshot({ tasks: [task({ dueDate: "2026-09-28" })], ...overrides });

function tickAt(rpc: EmailRpc, gate: PlanningGate, now: Date) {
  return runEmailTick({
    rpc,
    transport: fakeTransport(),
    now,
    appUrl: APP,
    log: memoryLog(),
    sleep: fakeSleep(),
    gate,
  });
}

describe("planning gate", () => {
  test("an empty cache (a fresh start) always plans", () => {
    expect(createPlanningGate().shouldPlan(at("01:00:00"))).toBe(true);
  });

  test("with every organization outside its window, it skips until the first window opens", () => {
    const gate = createPlanningGate();
    gate.remember(baseSnapshot(), at("02:00:00"));
    expect(gate.shouldPlan(at("02:05:00"))).toBe(false);
    expect(gate.shouldPlan(at("02:29:59"))).toBe(false);
    expect(gate.shouldPlan(at("02:30:00"))).toBe(true); // 08:00 in Kolkata
  });

  test("inside any window it plans on every tick", () => {
    const gate = createPlanningGate();
    gate.remember(baseSnapshot(), at("04:10:00"));
    for (const time of ["04:15:00", "05:40:00", "06:55:00"]) {
      expect(gate.shouldPlan(at(time))).toBe(true);
    }
  });

  test("the cache goes stale after an hour, so a closed tick plans anyway to refresh it", () => {
    const gate = createPlanningGate();
    gate.remember(baseSnapshot(), at("08:00:00"));
    expect(ORG_CACHE_MAX_AGE_MS).toBe(60 * MINUTE);
    expect(gate.shouldPlan(at("08:59:59"))).toBe(false);
    expect(gate.shouldPlan(at("09:00:00"))).toBe(true);
  });

  test("a clock that went back does not trust the cache", () => {
    const gate = createPlanningGate();
    gate.remember(baseSnapshot(), at("09:00:00"));
    expect(gate.shouldPlan(at("08:30:00"))).toBe(true);
  });

  test("a weekend day that is not the weekly day needs no planning", () => {
    const gate = createPlanningGate();
    const saturday = new Date("2026-09-26T04:30:00Z"); // 08:30 Dubai, 10:00 IST
    gate.remember(baseSnapshot(), new Date("2026-09-26T04:00:00Z"));
    expect(gate.shouldPlan(saturday)).toBe(false);
    const weeklyOnSaturday = baseSnapshot({
      organizations: [org(DUBAI, "upCarrera", "Asia/Dubai", { weeklyDay: 6 })],
    });
    gate.remember(weeklyOnSaturday, new Date("2026-09-26T04:00:00Z"));
    expect(gate.shouldPlan(saturday)).toBe(true);
  });

  test("a malformed snapshot clears the cache, so every tick plans again", () => {
    const gate = createPlanningGate();
    gate.remember(baseSnapshot(), at("08:00:00"));
    gate.remember(
      { ...baseSnapshot(), organizations: null } as unknown as EmailSnapshot,
      at("08:05:00"),
    );
    expect(gate.shouldPlan(at("08:10:00"))).toBe(true);
  });
});

describe("runEmailTick with a planning gate", () => {
  test("window entry: no snapshot while every organization is closed, planning once one opens", async () => {
    const gate = createPlanningGate();
    const rpc = fakeRpc({ snapshots: [withDueTomorrow()] });
    expect(await tickAt(rpc, gate, at("02:00:00"))).toMatchObject({ planned: 0 });
    expect(rpc.snapshots).toBe(1);
    expect(await tickAt(rpc, gate, at("02:25:00"))).toMatchObject({ planned: 0, claimed: 0 });
    expect(rpc.snapshots).toBe(1);
    expect(rpc.claims).toBe(2); // the claim still runs on every tick
    await tickAt(rpc, gate, at("02:30:00"));
    expect(rpc.snapshots).toBe(2);
    await tickAt(rpc, gate, at("04:05:00")); // Dubai opens: Maya's reminder and digest
    expect(
      rpc.enqueued
        .at(-1)!
        .map((row) => row.kind)
        .sort(),
    ).toEqual(["daily_digest", "due_reminder"]);
  });

  test("a skipped tick that claims rows fetches one snapshot to compose them, and sends", async () => {
    const gate = createPlanningGate();
    const access = claimed({ id: "a1", kind: "account_access", recipientUserId: ADMIN });
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: [access] });
    gate.remember(baseSnapshot(), at("08:00:00"));
    const result = await tickAt(rpc, gate, at("08:10:00"));
    expect(result).toMatchObject({ planned: 0, enqueued: 0, claimed: 1, sent: 1 });
    expect(rpc.snapshots).toBe(1);
    expect(rpc.enqueued).toEqual([]);
  });

  test("the snapshot fetched to compose refreshes the cache too", async () => {
    const gate = createPlanningGate();
    const access = claimed({ id: "a1", kind: "account_access", recipientUserId: ADMIN });
    gate.remember(baseSnapshot(), at("08:00:00"));
    await tickAt(fakeRpc({ snapshots: [baseSnapshot()], claim: [access] }), gate, at("08:50:00"));
    // An hour after 08:00, but only 20 minutes after the compose snapshot.
    expect(gate.shouldPlan(at("09:10:00"))).toBe(false);
    expect(gate.shouldPlan(at("09:50:00"))).toBe(true);
  });

  test("a settings change takes effect within the hour", async () => {
    // At 08:00Z (12:00 Dubai) the cached send hour is 08:00; the admin then moves it to 12:00.
    const before = withDueTomorrow();
    const after = withDueTomorrow({
      organizations: [
        org(DUBAI, "upCarrera", "Asia/Dubai", { sendHour: 12 }),
        org(KOLKATA, "Teachers' Training Institute of India", "Asia/Kolkata"),
      ],
    });
    const gate = createPlanningGate();
    const rpc = fakeRpc({ snapshots: [before, after] });
    expect(await tickAt(rpc, gate, at("08:00:00"))).toMatchObject({ planned: 0 });
    expect(await tickAt(rpc, gate, at("08:05:00"))).toMatchObject({ planned: 0 });
    expect(await tickAt(rpc, gate, at("08:55:00"))).toMatchObject({ planned: 0 });
    expect(rpc.snapshots).toBe(1);
    // The hourly refresh sees the new send hour (13:00 Dubai is inside 12:00–15:00).
    expect((await tickAt(rpc, gate, at("09:00:00"))).planned).toBeGreaterThan(0);
    expect(rpc.snapshots).toBe(2);
    // From then on the cache itself says Dubai is open.
    expect(gate.shouldPlan(at("09:05:00"))).toBe(true);
  });

  test("restart: a new gate plans on its first tick even outside every window", async () => {
    const rpc = fakeRpc({ snapshots: [withDueTomorrow()] });
    const old = createPlanningGate();
    await tickAt(rpc, old, at("08:00:00"));
    await tickAt(rpc, old, at("08:05:00"));
    expect(rpc.snapshots).toBe(1);
    await tickAt(rpc, createPlanningGate(), at("08:10:00"));
    expect(rpc.snapshots).toBe(2);
    // And a new gate inside the window plans exactly as a tick without a gate does.
    // One snapshot for both: the task fixture numbers every task it makes.
    const snapshot = withDueTomorrow();
    const withGate = fakeRpc({ snapshots: [structuredClone(snapshot)] });
    const without = fakeRpc({ snapshots: [structuredClone(snapshot)] });
    await tickAt(withGate, createPlanningGate(), at("04:30:00"));
    await runEmailTick({
      rpc: without,
      transport: fakeTransport(),
      now: at("04:30:00"),
      appUrl: APP,
      log: memoryLog(),
      sleep: fakeSleep(),
    });
    expect(withGate.enqueued).toEqual(without.enqueued);
    expect(withGate.enqueued[0].length).toBeGreaterThan(0);
  });

  test("a failing planning snapshot leaves the cache empty, so the next tick tries again", async () => {
    const gate = createPlanningGate();
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], snapshotFailsAt: 1 });
    await expect(tickAt(rpc, gate, at("08:00:00"))).rejects.toThrow("boom");
    expect(gate.shouldPlan(at("08:05:00"))).toBe(true);
  });
});
