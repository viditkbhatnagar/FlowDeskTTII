// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ADMIN,
  APP,
  FRIDAY_0830_DUBAI,
  MAYA,
  baseSnapshot,
  claimed,
  fakeRpc,
  fakeSleep,
  fakeTransport,
  memoryLog,
  task,
} from "./fixtures";
import type { EmailRpc } from "./rpc";
import type { EmailTransport } from "./transport";
import { runEmailTick, startEmailWorker, stopEmailWorker, type EmailLog } from "./worker";

const t = task({ title: "Upload fee reconciliation", dueDate: "2026-09-28" });
const assigned = claimed({ id: "e1", kind: "task_assigned", taskId: t.id, recipientUserId: MAYA });
const deps = (
  rpc: EmailRpc,
  transport: EmailTransport,
  log: EmailLog = memoryLog(),
  sleep = fakeSleep(),
) => ({ rpc, transport, now: FRIDAY_0830_DUBAI, appUrl: APP, log, sleep });

const failFor =
  (...addresses: string[]) =>
  (message: { to: string }) =>
    addresses.includes(message.to) ? new Error(`mailbox full for ${message.to}`) : undefined;

describe("runEmailTick", () => {
  test("plans, enqueues, claims, sends and completes", async () => {
    const snapshot = baseSnapshot({ tasks: [t] });
    const rpc = fakeRpc({ snapshots: [snapshot], claim: [assigned] });
    const transport = fakeTransport();
    const result = await runEmailTick(deps(rpc, transport));
    expect(rpc.enqueued[0].map((row) => row.kind).sort()).toEqual(["daily_digest", "due_reminder"]);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({ to: "maya@upcarrera.test", toName: "Maya Chen" });
    expect(transport.sent[0].subject).toBe("Task assigned to you: Upload fee reconciliation");
    expect(rpc.completed).toEqual([[{ id: "e1", outcome: "sent" }]]);
    expect(result).toEqual({
      planned: 2,
      enqueued: 2,
      claimed: 1,
      sent: 1,
      suppressed: 0,
      retried: 0,
      failed: 0,
      deferred: 0,
    });
  });

  test("a send failure becomes a retry with the error, and the rest still go out", async () => {
    const other = claimed({ id: "e2", kind: "account_access", recipientUserId: ADMIN });
    const rpc = fakeRpc({ snapshots: [baseSnapshot({ tasks: [t] })], claim: [assigned, other] });
    const result = await runEmailTick(deps(rpc, fakeTransport(failFor("maya@upcarrera.test"))));
    expect(rpc.completed).toEqual([
      [{ id: "e1", outcome: "retry", error: "mailbox full for maya@upcarrera.test" }],
      [{ id: "e2", outcome: "sent" }],
    ]);
    expect(result).toMatchObject({ sent: 1, retried: 1 });
  });

  test("a suppressed row is completed with its reason and nothing is sent", async () => {
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: [assigned] });
    const transport = fakeTransport();
    const result = await runEmailTick(deps(rpc, transport));
    expect(transport.sent).toEqual([]);
    expect(rpc.completed[0]).toEqual([
      { id: "e1", outcome: "suppressed", error: "task no longer exists or is archived" },
    ]);
    expect(result.suppressed).toBe(1);
  });

  test("composes against a snapshot taken after the claim", async () => {
    // The task was created (and its email queued) between the first snapshot and the claim.
    const rpc = fakeRpc({
      snapshots: [baseSnapshot(), baseSnapshot({ tasks: [t] })],
      claim: [assigned],
    });
    const transport = fakeTransport();
    await runEmailTick(deps(rpc, transport));
    expect(rpc.snapshots).toBe(2);
    expect(rpc.completed[0]).toEqual([{ id: "e1", outcome: "sent" }]);
  });

  test("rows are composed with the planning snapshot: one snapshot for the whole tick", async () => {
    const other = claimed({ id: "e2", kind: "account_access", recipientUserId: ADMIN });
    const rpc = fakeRpc({ snapshots: [baseSnapshot({ tasks: [t] })], claim: [assigned, other] });
    const result = await runEmailTick(deps(rpc, fakeTransport()));
    expect(result).toMatchObject({ claimed: 2, sent: 2 });
    expect(rpc.snapshots).toBe(1);
  });

  test("a row suppressed on the planning snapshot is checked once more on a fresh one", async () => {
    const gone = claimed({ id: "e4", kind: "task_assigned", taskId: "missing" });
    const later = claimed({ id: "e5", kind: "task_assigned", taskId: "also-missing" });
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: [gone, later] });
    const result = await runEmailTick(deps(rpc, fakeTransport()));
    expect(result.suppressed).toBe(2);
    // One refresh for the first suppression; the second row is already on the fresh snapshot.
    expect(rpc.snapshots).toBe(2);
  });

  test("when planning threw outright, rows are composed with a fresh snapshot", async () => {
    const broken = { ...baseSnapshot(), people: null } as unknown as ReturnType<
      typeof baseSnapshot
    >;
    const other = claimed({ id: "e2", kind: "account_access", recipientUserId: ADMIN });
    const rpc = fakeRpc({ snapshots: [broken, baseSnapshot()], claim: [other] });
    const result = await runEmailTick(deps(rpc, fakeTransport()));
    expect(result).toMatchObject({ planned: 0, sent: 1 });
    expect(rpc.snapshots).toBe(2);
  });

  test("no claimed rows: one snapshot, nothing completed", async () => {
    const rpc = fakeRpc({ snapshots: [baseSnapshot()] });
    const result = await runEmailTick(deps(rpc, fakeTransport()));
    expect(rpc.snapshots).toBe(1);
    expect(rpc.completed).toEqual([]);
    expect(result.claimed).toBe(0);
  });

  test("a compose crash fails that row only", async () => {
    const broken = claimed({
      id: "e3",
      kind: "account_access",
      payload: null as unknown as Record<string, unknown>,
    });
    const rpc = fakeRpc({ snapshots: [baseSnapshot({ tasks: [t] })], claim: [broken, assigned] });
    const log = memoryLog();
    const result = await runEmailTick(deps(rpc, fakeTransport(), log));
    expect(rpc.completed[0]).toEqual([expect.objectContaining({ id: "e3", outcome: "failed" })]);
    expect(rpc.completed[1]).toEqual([{ id: "e1", outcome: "sent" }]);
    expect(result).toMatchObject({ failed: 1, sent: 1 });
    expect(
      log.lines.some((line) =>
        line.startsWith("error [email] compose failed for account_access e3"),
      ),
    ).toBe(true);
  });

  test("if the snapshot after the claim fails, unsettled rows go back as retries and the tick rejects", async () => {
    // The planning snapshot predates the task, so the row needs a fresh one, which fails.
    const other = claimed({ id: "e2", kind: "account_access", recipientUserId: ADMIN });
    const rpc = fakeRpc({
      snapshots: [baseSnapshot()],
      claim: [assigned, other],
      snapshotFailsAt: 2,
    });
    const transport = fakeTransport();
    await expect(runEmailTick(deps(rpc, transport))).rejects.toThrow("boom");
    expect(transport.sent).toEqual([]);
    const reason = "snapshot before send: email_worker_snapshot: boom";
    expect(rpc.completed).toEqual([
      [
        { id: "e1", outcome: "retry", error: reason },
        { id: "e2", outcome: "retry", error: reason },
      ],
    ]);
  });

  test("a snapshot that fails mid-batch keeps what was already sent", async () => {
    const first = claimed({ id: "e0", kind: "account_access", recipientUserId: ADMIN });
    const rpc = fakeRpc({
      snapshots: [baseSnapshot()],
      claim: [first, assigned],
      snapshotFailsAt: 2,
    });
    const transport = fakeTransport();
    await expect(runEmailTick(deps(rpc, transport))).rejects.toThrow("boom");
    expect(transport.sent.map((m) => m.to)).toEqual(["admin@upcarrera.test"]);
    expect(rpc.completed).toEqual([
      [{ id: "e0", outcome: "sent" }],
      [{ id: "e1", outcome: "retry", error: "snapshot before send: email_worker_snapshot: boom" }],
    ]);
  });

  test("a failing planning snapshot rejects the tick before anything is claimed", async () => {
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], snapshotFailsAt: 1, claim: [assigned] });
    await expect(runEmailTick(deps(rpc, fakeTransport()))).rejects.toThrow("boom");
    expect(rpc.claims).toBe(0);
  });
});

describe("startEmailWorker", () => {
  afterEach(() => stopEmailWorker());

  const enabledEnv = {
    EMAIL_WORKER_ENABLED: "true",
    EMAIL_WORKER_SECRET: "k".repeat(40),
    // Nothing listens on port 9, so every tick fails fast.
    SUPABASE_URL: "http://127.0.0.1:9",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    EMAIL_TRANSPORT: "log",
    EMAIL_LOG_DIR: "/tmp/flowdesk-email-test-unused",
    EMAIL_WORKER_INTERVAL_MS: "60000",
  };

  test("disabled: logs why once and does not start, however often it is called", () => {
    const log = memoryLog();
    expect(startEmailWorker({ env: {}, log })).toBe(false);
    expect(startEmailWorker({ env: {}, log })).toBe(false);
    expect(log.lines).toEqual([
      'info [email] worker not started: EMAIL_WORKER_ENABLED is not "true"',
    ]);
  });

  test("misconfigured: reports the problem as an error line without throwing", () => {
    const log = memoryLog();
    expect(startEmailWorker({ env: { ...enabledEnv, EMAIL_WORKER_SECRET: "short" }, log })).toBe(
      false,
    );
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toStartWith("error [email] worker not started: EMAIL_WORKER_SECRET");
    expect(log.lines[0]).toContain("at least 32");
  });

  test("the log transport is refused in production, so a dry run cannot consume the queue", () => {
    const log = memoryLog();
    expect(startEmailWorker({ env: { ...enabledEnv, NODE_ENV: "production" }, log })).toBe(false);
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toStartWith(
      "error [email] worker not started: EMAIL_TRANSPORT=log is refused with NODE_ENV=production",
    );
    expect(log.lines[0]).toContain("EMAIL_LOG_ALLOW_PRODUCTION=true");
    stopEmailWorker();
    const allowed = { ...enabledEnv, NODE_ENV: "production", EMAIL_LOG_ALLOW_PRODUCTION: "true" };
    expect(startEmailWorker({ env: allowed, log, firstTickDelayMs: 60_000 })).toBe(true);
  });

  test("starts exactly once per process", () => {
    const log = memoryLog();
    expect(startEmailWorker({ env: enabledEnv, log, firstTickDelayMs: 60_000 })).toBe(true);
    expect(startEmailWorker({ env: enabledEnv, log, firstTickDelayMs: 60_000 })).toBe(false);
    expect(log.lines.filter((line) => line.includes("worker started"))).toHaveLength(1);
    expect(log.lines[0]).not.toContain("k".repeat(40));
  });

  test("stopping resolves only once the tick in flight has finished", async () => {
    // A Supabase that takes 150 ms to answer (with an error), so the stop lands mid-tick.
    const slow = createServer((_req, res) => {
      setTimeout(() => res.writeHead(500).end("{}"), 150);
    });
    await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
    const { port } = slow.address() as AddressInfo;
    const log = memoryLog();
    const env = { ...enabledEnv, SUPABASE_URL: `http://127.0.0.1:${port}` };
    startEmailWorker({ env, log, firstTickDelayMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(log.lines.some((line) => line.includes("tick 1"))).toBe(false);
    await stopEmailWorker();
    expect(log.lines.some((line) => line.includes("tick 1 failed"))).toBe(true);
    slow.close();
  });

  test("a failing tick is logged, never thrown", async () => {
    const log = memoryLog();
    startEmailWorker({ env: enabledEnv, log, firstTickDelayMs: 0 });
    for (let i = 0; i < 100 && !log.lines.some((l) => l.includes("tick 1 failed")); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const failure = log.lines.find((line) => line.includes("tick 1 failed"));
    expect(failure).toStartWith("error [email] tick 1 failed: email_worker_snapshot:");
    expect(failure).not.toContain("k".repeat(40));
  });
});
