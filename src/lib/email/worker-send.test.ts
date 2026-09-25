// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  ADMIN,
  APP,
  DAN,
  DUBAI,
  FRIDAY_0830_DUBAI,
  KOLKATA,
  LEAD,
  MAYA,
  PROJECT,
  baseSnapshot,
  claimed,
  fakeRpc,
  fakeSleep,
  fakeTransport,
  memoryLog,
  project,
  task,
} from "./fixtures";
import type { EmailRpc } from "./rpc";
import type { ClaimedEmail, SnapshotTask } from "./snapshot";
import { createGraphTransport, type EmailTransport } from "./transport";
import {
  CLAIM_LIMIT,
  CONFIG_PAUSE_SECONDS,
  DEFAULT_PAUSE_SECONDS,
  SEND_GAP_MS,
  runEmailTick,
  MAX_SEND_ATTEMPTS,
} from "./worker";

const CLIENT_SECRET = "graph-client-secret-never-logged";
const MON_0830_DUBAI = new Date("2026-09-28T04:30:00Z");

/** account_access always composes, so these rows exercise sending alone. */
const access = (id: string, recipientUserId: string): ClaimedEmail =>
  claimed({ id, kind: "account_access", recipientUserId });
const four = [access("r1", ADMIN), access("r2", MAYA), access("r3", DAN), access("r4", LEAD)];

type SendAnswer = (sendNumber: number, to: string) => Response | Promise<Response>;

/** A fake Microsoft Graph: `token` answers the token endpoint, `answer` each sendMail. */
function fakeGraph(
  answer: SendAnswer = () => new Response(null, { status: 202 }),
  token = () => new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 })),
) {
  const calls = { token: 0, send: 0 };
  const fetch = async (url: string, init: RequestInit = {}) => {
    if (url.includes("login.microsoftonline.com")) {
      calls.token += 1;
      return token();
    }
    calls.send += 1;
    const body = JSON.parse(String(init.body));
    return answer(calls.send, body.message.toRecipients[0].emailAddress.address);
  };
  const transport = createGraphTransport({
    tenantId: "tenant",
    clientId: "client",
    clientSecret: CLIENT_SECRET,
    fromAddress: "flowdesk@upcarrera.test",
    fromName: "Flowdesk",
    fetch,
  });
  return { calls, transport };
}

const graphError = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message: "nope" } }), { status, headers });

function tick(rpc: EmailRpc, transport: EmailTransport, now = FRIDAY_0830_DUBAI) {
  const log = memoryLog();
  const sleep = fakeSleep();
  const run = runEmailTick({ rpc, transport, now, appUrl: APP, log, sleep });
  return { log, sleep, run };
}

const failureLines = (lines: string[]) => lines.filter((line) => line.startsWith("error "));

describe("pacing", () => {
  test("Graph sends are 2.5 s apart: none before the first, none for suppressed rows", async () => {
    const graph = fakeGraph();
    const gone = claimed({ id: "gone", kind: "task_assigned", taskId: "missing" });
    const rows = [access("r1", ADMIN), gone, access("r2", MAYA), access("r3", DAN)];
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: rows });
    const { sleep, run } = tick(rpc, graph.transport);
    expect(await run).toMatchObject({ sent: 3, suppressed: 1 });
    expect(SEND_GAP_MS).toBe(2_500);
    expect(sleep.calls).toEqual([2_500, 2_500]);
  });

  test("a tick claims a small batch, about a minute of paced sending", async () => {
    let limit: number | undefined;
    const rpc = fakeRpc({ snapshots: [baseSnapshot()] });
    const claimSpy: EmailRpc = {
      ...rpc,
      claim: async (value) => {
        limit = value;
        return [];
      },
    };
    await tick(claimSpy, fakeGraph().transport).run;
    expect(limit).toBe(CLAIM_LIMIT);
    expect((CLAIM_LIMIT * SEND_GAP_MS) / 1000).toBeLessThanOrEqual(60);
  });

  test("the log transport is not slowed down", async () => {
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four });
    const { sleep, run } = tick(rpc, fakeTransport());
    expect((await run).sent).toBe(4);
    expect(sleep.calls).toEqual([]);
  });
});

describe("throttling and outages", () => {
  test("a 429 stops the batch at once and defers that row and every unsent one for Retry-After", async () => {
    const graph = fakeGraph((n) =>
      n === 1
        ? new Response(null, { status: 202 })
        : graphError(429, "ApplicationThrottled", { "Retry-After": "120" }),
    );
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four });
    const { log, run } = tick(rpc, graph.transport);
    const result = await run;
    expect(graph.calls.send).toBe(2);
    const reason =
      'paused 120s, Graph is throttling or unavailable: Graph sendMail 429: {"error":{"code":"ApplicationThrottled","message":"nope"}}';
    expect(rpc.completed).toEqual([
      [{ id: "r1", outcome: "sent" }],
      ["r2", "r3", "r4"].map((id) => ({
        id,
        outcome: "defer",
        error: reason,
        retryAfterSeconds: 120,
      })),
    ]);
    expect(result).toMatchObject({ claimed: 4, sent: 1, deferred: 3, retried: 0, failed: 0 });
    expect(failureLines(log.lines)).toEqual([`error [email] 3 x defer: ${reason}`]);
  });

  test("a 503 without Retry-After pauses for the default minute", async () => {
    const graph = fakeGraph(() => graphError(503, "ServiceUnavailable"));
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four.slice(0, 2) });
    const result = await tick(rpc, graph.transport).run;
    expect(graph.calls.send).toBe(1);
    expect(result.deferred).toBe(2);
    expect(rpc.completed[0].map((r) => r.outcome === "defer" && r.retryAfterSeconds)).toEqual([
      DEFAULT_PAUSE_SECONDS,
      DEFAULT_PAUSE_SECONDS,
    ]);
  });

  test("a token endpoint 5xx waits for Retry-After like a throttled send", async () => {
    const graph = fakeGraph(undefined, () =>
      graphError(500, "ServerError", { "Retry-After": "45" }),
    );
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four.slice(0, 2) });
    const result = await tick(rpc, graph.transport).run;
    expect(graph.calls).toEqual({ token: 1, send: 0 });
    expect(result).toMatchObject({ deferred: 2, retried: 0 });
    expect(rpc.completed[0][0]).toMatchObject({ outcome: "defer", retryAfterSeconds: 45 });
  });

  test("Retry-After as an HTTP date is honoured too, and capped at an hour", async () => {
    const soon = new Date(Date.now() + 90_000).toUTCString();
    const late = new Date(Date.now() + 86_400_000).toUTCString();
    for (const [header, expected] of [
      [soon, [89, 90, 91]],
      [late, [3_600]],
    ] as const) {
      const graph = fakeGraph(() => graphError(429, "TooManyRequests", { "Retry-After": header }));
      const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four.slice(0, 1) });
      await tick(rpc, graph.transport).run;
      const [row] = rpc.completed[0];
      expect(row.outcome).toBe("defer");
      expect(expected).toContain(row.outcome === "defer" ? row.retryAfterSeconds : -1);
    }
  });

  test("no answer to one sendMail: that row is retried (it may have gone out), the batch carries on", async () => {
    const graph = fakeGraph((n) => {
      if (n === 1) throw new TypeError("fetch failed");
      return new Response(null, { status: 202 });
    });
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four.slice(0, 3) });
    const result = await tick(rpc, graph.transport).run;
    expect(graph.calls.send).toBe(3);
    expect(rpc.completed).toEqual([
      [{ id: "r1", outcome: "retry", error: "Graph sendMail request failed: fetch failed" }],
      [{ id: "r2", outcome: "sent" }],
      [{ id: "r3", outcome: "sent" }],
    ]);
    expect(result).toMatchObject({ retried: 1, sent: 2, deferred: 0 });
  });
});

describe("a message Graph always refuses", () => {
  const poisonFor =
    (address: string, status: number) =>
    (_n: number, to: string): Response =>
      to === address
        ? graphError(status, "InternalServerError")
        : new Response(null, { status: 202 });

  test("a 500, 502 or 504 for one message retries that row only, and the batch carries on", async () => {
    for (const status of [500, 502, 504]) {
      const graph = fakeGraph(poisonFor("maya@upcarrera.test", status));
      const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four });
      const { log, run } = tick(rpc, graph.transport);
      const result = await run;
      expect(graph.calls.send).toBe(4);
      expect(rpc.completed.map((batch) => batch.map((r) => [r.id, r.outcome]))).toEqual([
        [["r1", "sent"]],
        [["r2", "retry"]],
        [["r3", "sent"]],
        [["r4", "sent"]],
      ]);
      expect(result).toMatchObject({ sent: 3, retried: 1, deferred: 0 });
      expect(failureLines(log.lines)).toEqual([
        `error [email] 1 x retry: Graph sendMail ${status}: {"error":{"code":"InternalServerError","message":"nope"}}`,
      ]);
    }
  });

  test("it uses an attempt a tick but never its last one, and never holds the rest of the queue", async () => {
    // What email_worker_claim / _complete do: claim adds an attempt, retry keeps it, defer refunds it.
    let attempts = 0;
    const outcomes: string[] = [];
    for (let tickNumber = 1; tickNumber <= 8; tickNumber += 1) {
      const poison = { ...access("poison", MAYA), attempts: attempts + 1 };
      const graph = fakeGraph(poisonFor("maya@upcarrera.test", 500));
      const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: [poison, access("r3", DAN)] });
      const result = await tick(rpc, graph.transport).run;
      expect(result).toMatchObject({ sent: 1 });
      const outcome = rpc.completed.flat().find((r) => r.id === "poison")!.outcome;
      outcomes.push(outcome);
      attempts = outcome === "defer" ? poison.attempts - 1 : poison.attempts;
    }
    expect(outcomes).toEqual([
      "retry",
      "retry",
      "retry",
      "retry",
      "defer",
      "defer",
      "defer",
      "defer",
    ]);
    // Still pending with four attempts used: it expires with its error rather than failing.
    expect(attempts).toBe(4);
  });

  test("a Graph outage cannot use up a row's last attempt", async () => {
    const last = { ...access("r1", MAYA), attempts: MAX_SEND_ATTEMPTS };
    const graph = fakeGraph(() => graphError(502, "BadGateway"));
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: [last] });
    await tick(rpc, graph.transport).run;
    expect(rpc.completed.flat()).toEqual([expect.objectContaining({ id: "r1", outcome: "defer" })]);
  });

  test("two outage-type failures in a row mean Graph is down: the rest wait without using attempts", async () => {
    const graph = fakeGraph((n) =>
      n <= 2 ? graphError(502, "BadGateway") : new Response(null, { status: 202 }),
    );
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four });
    const { log, run } = tick(rpc, graph.transport);
    const result = await run;
    expect(graph.calls.send).toBe(2);
    const reason =
      'paused 60s, Graph failed 2 sends in a row: Graph sendMail 502: {"error":{"code":"BadGateway","message":"nope"}}';
    expect(rpc.completed).toEqual([
      [{ id: "r1", outcome: "retry", error: expect.stringContaining("502") }],
      ["r2", "r3", "r4"].map((id) => ({
        id,
        outcome: "defer",
        error: reason,
        retryAfterSeconds: DEFAULT_PAUSE_SECONDS,
      })),
    ]);
    expect(result).toMatchObject({ retried: 1, deferred: 3, sent: 0 });
    expect(failureLines(log.lines)).toContain(`error [email] 3 x defer: ${reason}`);
  });

  test("a network outage costs one attempt a tick, not one per queued email", async () => {
    const graph = fakeGraph(() => {
      throw new TypeError("fetch failed");
    });
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four });
    const result = await tick(rpc, graph.transport).run;
    expect(graph.calls.send).toBe(2);
    expect(result).toMatchObject({ retried: 1, deferred: 3 });
  });

  test("a send Graph took, or a suppressed row, in between: the streak starts over", async () => {
    const gone = claimed({ id: "gone", kind: "task_assigned", taskId: "missing" });
    const rows = [
      access("r1", ADMIN),
      gone,
      access("r2", MAYA),
      access("r3", DAN),
      access("r4", LEAD),
    ];
    // ADMIN fails, the suppressed row is skipped, MAYA fails: two in a row, so DAN and LEAD wait.
    const failing = fakeGraph((_n, to) =>
      to === "dan@upcarrera.test" || to === "lead@tti.test"
        ? new Response(null, { status: 202 })
        : graphError(500, "InternalServerError"),
    );
    const held = fakeRpc({ snapshots: [baseSnapshot()], claim: rows });
    expect(await tick(held, failing.transport).run).toMatchObject({
      retried: 1,
      suppressed: 1,
      deferred: 3,
    });
    // ADMIN fails, DAN goes out, MAYA fails: never two in a row, so everything is tried.
    const alternating = fakeGraph((_n, to) =>
      to === "dan@upcarrera.test" ? new Response(null, { status: 202 }) : graphError(500, "Oops"),
    );
    const order = [access("r1", ADMIN), access("r3", DAN), access("r2", MAYA)];
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: order });
    expect(await tick(rpc, alternating.transport).run).toMatchObject({
      retried: 2,
      sent: 1,
      deferred: 0,
    });
  });

  test("other 4xx answers (413 too large) retry that row without counting towards an outage", async () => {
    const graph = fakeGraph(() => graphError(413, "RequestEntityTooLarge"));
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four.slice(0, 3) });
    const result = await tick(rpc, graph.transport).run;
    expect(graph.calls.send).toBe(3);
    expect(result).toMatchObject({ retried: 3, deferred: 0 });
  });
});

describe("sender and configuration problems", () => {
  test("an expired client secret (token endpoint 401) defers the whole batch for 15 minutes, logged once", async () => {
    const expired = () =>
      new Response(
        JSON.stringify({
          error: "invalid_client",
          error_description: "AADSTS7000222: The provided client secret keys are expired.",
        }),
        { status: 401 },
      );
    const graph = fakeGraph(undefined, expired);
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four });
    const { log, run } = tick(rpc, graph.transport);
    const result = await run;
    expect(graph.calls).toEqual({ token: 1, send: 0 });
    expect(result).toMatchObject({ sent: 0, deferred: 4, retried: 0, failed: 0 });
    expect(rpc.completed).toHaveLength(1);
    for (const row of rpc.completed[0]) {
      expect(row).toMatchObject({ outcome: "defer", retryAfterSeconds: CONFIG_PAUSE_SECONDS });
    }
    const lines = failureLines(log.lines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(
      "error [email] 4 x defer: paused 900s, check the Graph credentials and sender: Graph token endpoint 401:",
    );
    expect(lines[0]).toContain("AADSTS7000222");
    expect(log.lines.join("\n")).not.toContain(CLIENT_SECRET);
  });

  test("sendMail 403 (no permission) and 404 (no such mailbox) defer the batch the same way", async () => {
    for (const [status, code] of [
      [403, "ErrorAccessDenied"],
      [404, "ErrorInvalidUser"],
    ] as const) {
      const graph = fakeGraph(() => graphError(status, code));
      const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four.slice(0, 3) });
      const result = await tick(rpc, graph.transport).run;
      expect(graph.calls.send).toBe(1);
      expect(result.deferred).toBe(3);
      expect(rpc.completed[0][0]).toMatchObject({
        outcome: "defer",
        retryAfterSeconds: CONFIG_PAUSE_SECONDS,
      });
      expect(rpc.completed[0][0].outcome === "defer" && rpc.completed[0][0].error).toContain(code);
    }
  });

  test("a sendMail 400 for a bad recipient fails that row at once and the batch carries on", async () => {
    const graph = fakeGraph((_n, to) =>
      to === "maya@upcarrera.test"
        ? new Response(
            JSON.stringify({
              error: {
                code: "ErrorInvalidRecipients",
                message: `Recipient '${to}' isn't resolved.`,
              },
            }),
            { status: 400 },
          )
        : new Response(null, { status: 202 }),
    );
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four.slice(0, 3) });
    const { log, run } = tick(rpc, graph.transport);
    const result = await run;
    expect(graph.calls.send).toBe(3);
    expect(rpc.completed.map((batch) => batch.map((r) => [r.id, r.outcome]))).toEqual([
      [["r1", "sent"]],
      [["r2", "failed"]],
      [["r3", "sent"]],
    ]);
    expect(result).toMatchObject({ sent: 2, failed: 1, retried: 0, deferred: 0 });
    const lines = failureLines(log.lines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith("error [email] 1 x failed: Graph sendMail 400:");
    expect(lines[0]).toContain("Recipient '<address>' isn't resolved");
    expect(log.lines.join("\n")).not.toContain("maya@upcarrera.test");
  });

  test("one log line per distinct reason, whatever the addresses", async () => {
    const transport = fakeTransport((m) => new Error(`mailbox full for ${m.to}`));
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four.slice(0, 3) });
    const { log, run } = tick(rpc, transport);
    expect((await run).retried).toBe(3);
    expect(failureLines(log.lines)).toEqual([
      "error [email] 3 x retry: mailbox full for <address>",
    ]);
  });
});

describe("recording results", () => {
  test("each result is recorded as soon as its email is sent", async () => {
    const events: string[] = [];
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four.slice(0, 2) });
    const recording: EmailRpc = {
      ...rpc,
      complete: async (results) => {
        events.push(`complete ${results.map((r) => r.id).join(",")}`);
        return rpc.complete(results);
      },
    };
    const transport = fakeTransport((m) => {
      events.push(`send ${m.to}`);
      return undefined;
    });
    await tick(recording, transport).run;
    expect(events).toEqual([
      "send admin@upcarrera.test",
      "complete r1",
      "send maya@upcarrera.test",
      "complete r2",
    ]);
  });

  test("a failing complete call is retried after 1 s and then 5 s", async () => {
    const rpc = fakeRpc({
      snapshots: [baseSnapshot()],
      claim: four.slice(0, 1),
      completeFailures: 2,
    });
    const { sleep, run } = tick(rpc, fakeTransport());
    expect((await run).sent).toBe(1);
    expect(rpc.completed).toEqual([[{ id: "r1", outcome: "sent" }]]);
    expect(sleep.calls).toEqual([1_000, 5_000]);
  });

  test("if recording keeps failing the tick stops, so at most the email in flight is sent twice", async () => {
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four, completeFailures: 3 });
    const transport = fakeTransport();
    const { run } = tick(rpc, transport);
    await expect(run).rejects.toThrow(
      "could not record 1 result(s) after 3 attempts: email_worker_complete: network",
    );
    expect(transport.sent.map((m) => m.to)).toEqual(["admin@upcarrera.test"]);
  });
});

describe("shutting down", () => {
  test("once the server is stopping no new send starts; the rest goes back without an attempt", async () => {
    let stopping = false;
    const transport = fakeTransport(() => {
      stopping = true;
      return undefined;
    });
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four });
    const log = memoryLog();
    const result = await runEmailTick({
      rpc,
      transport,
      now: FRIDAY_0830_DUBAI,
      appUrl: APP,
      log,
      sleep: fakeSleep(),
      stopping: () => stopping,
    });
    expect(transport.sent.map((m) => m.to)).toEqual(["admin@upcarrera.test"]);
    expect(rpc.completed).toEqual([
      [{ id: "r1", outcome: "sent" }],
      ["r2", "r3", "r4"].map((id) => ({
        id,
        outcome: "defer",
        error: "the server was stopping",
        retryAfterSeconds: 30,
      })),
    ]);
    expect(result).toMatchObject({ claimed: 4, sent: 1, deferred: 3, failed: 0, retried: 0 });
    expect(log.lines).toEqual(["info [email] stopping: 3 email(s) put back for the next start"]);
  });

  test("a stop during the pause between Graph sends does not start the next one", async () => {
    let stopping = false;
    const graph = fakeGraph();
    const rpc = fakeRpc({ snapshots: [baseSnapshot()], claim: four.slice(0, 2) });
    const sleep = async () => {
      stopping = true;
    };
    const run = runEmailTick({
      rpc,
      transport: graph.transport,
      now: FRIDAY_0830_DUBAI,
      appUrl: APP,
      log: memoryLog(),
      sleep,
      stopping: () => stopping,
    });
    expect((await run).deferred).toBe(1);
    expect(graph.calls.send).toBe(1);
  });
});

describe("planning cannot block sending", () => {
  /** A 5-digit year, as a typo in a date input stores it (20266-09-02). */
  const typo = (overrides: Partial<SnapshotTask>) => task({ dueDate: "20266-09-02", ...overrides });

  test("a typo'd due year reads as no deadline; every summary still goes out on the weekly day", async () => {
    const snapshot = baseSnapshot({
      projects: [project({ dueDate: "20266-01-01" })],
      tasks: [
        typo({ title: "typo blocked", blocked: true, projectId: PROJECT }),
        typo({ title: "typo review", status: "review", assigneeId: MAYA }),
        typo({ title: "typo unassigned", assigneeId: null }),
        task({ title: "normal", dueDate: "2026-09-29", assigneeId: DAN }),
      ],
    });
    const weekly = claimed({
      id: "w1",
      kind: "weekly_management",
      recipientUserId: ADMIN,
      payload: { localDate: "2026-09-28", timezone: "Asia/Dubai" },
    });
    const rpc = fakeRpc({ snapshots: [snapshot], claim: [access("a1", MAYA), weekly] });
    const transport = fakeTransport();
    const { log, run } = tick(rpc, transport, MON_0830_DUBAI);
    const result = await run;
    const planned = rpc.enqueued[0].map((row) => row.dedupeKey.split(":").slice(0, 2).join(":"));
    expect(planned).toEqual(
      expect.arrayContaining([
        `weekly_management:${ADMIN}`,
        `daily_management:${ADMIN}`,
        `weekly_digest:${MAYA}`,
        `due_reminder:${snapshot.tasks[3].id}`,
      ]),
    );
    expect(result).toMatchObject({ claimed: 2, sent: 2 });
    const html = transport.sent[1].html;
    expect(html).toContain("typo blocked");
    expect(html).toContain("No deadline");
    expect(failureLines(log.lines)).toEqual([]);
  });

  test("a record that throws while planning is skipped and logged; the rest is planned and sent", async () => {
    const corrupt = task({ organizationId: KOLKATA, assigneeId: LEAD, dueDate: "2026-09-26" });
    Object.defineProperty(corrupt, "status", {
      get() {
        throw new Error("corrupt row");
      },
    });
    const fine = task({ assigneeId: MAYA, dueDate: "2026-09-28" });
    const snapshot = baseSnapshot({ tasks: [corrupt, fine] });
    const rpc = fakeRpc({ snapshots: [snapshot], claim: [access("a1", DAN)] });
    const { log, run } = tick(rpc, fakeTransport());
    expect(await run).toMatchObject({ sent: 1 });
    const keys = rpc.enqueued[0].map((row) => row.dedupeKey);
    expect(keys).toContain(`due_reminder:${fine.id}:2026-09-28`);
    expect(keys).toContain(`daily_digest:${MAYA}:2026-09-25`);
    const skipped = failureLines(log.lines);
    expect(skipped).toContain(`error [email] planning skipped task ${corrupt.id}: corrupt row`);
    expect(skipped).toContain(
      `error [email] planning skipped person ${LEAD} daily_digest: corrupt row`,
    );
    expect(skipped.every((line) => line.includes("planning skipped"))).toBe(true);
  });

  test("planning that throws outright is logged, and queued email still goes out", async () => {
    const broken = { ...baseSnapshot(), people: null } as unknown as ReturnType<
      typeof baseSnapshot
    >;
    const rpc = fakeRpc({ snapshots: [broken, baseSnapshot()], claim: [access("a1", MAYA)] });
    const { log, run } = tick(rpc, fakeTransport());
    expect(await run).toMatchObject({ planned: 0, enqueued: 0, claimed: 1, sent: 1 });
    expect(log.lines[0]).toStartWith("error [email] planning failed, sending what is queued:");
  });

  test("an enqueue failure is logged, and queued email still goes out", async () => {
    const rpc = fakeRpc({
      snapshots: [baseSnapshot({ tasks: [task({ dueDate: "2026-09-28" })] })],
      claim: [access("a1", MAYA)],
      enqueueFails: true,
    });
    const { log, run } = tick(rpc, fakeTransport());
    expect(await run).toMatchObject({ enqueued: 0, claimed: 1, sent: 1 });
    expect(log.lines).toContain(
      "error [email] enqueue failed, sending what is queued: email_worker_enqueue: bad row",
    );
  });

  test("the organization of a record that breaks is the only one skipped", async () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ assigneeId: MAYA, dueDate: "2026-09-28" }),
        task({ organizationId: KOLKATA, assigneeId: LEAD, dueDate: "2026-09-28" }),
      ],
    });
    const kolkata = snapshot.organizations.find((o) => o.id === KOLKATA)!;
    const brokenOrg = {
      ...kolkata,
      settings: { ...kolkata.settings, workingDays: null as unknown as number[] },
    };
    const organizations = snapshot.organizations.map((o) => (o.id === KOLKATA ? brokenOrg : o));
    const rpc = fakeRpc({ snapshots: [{ ...snapshot, organizations }] });
    const { log, run } = tick(rpc, fakeTransport());
    await run;
    const rows = rpc.enqueued[0];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.organizationId === DUBAI)).toBe(true);
    expect(failureLines(log.lines)[0]).toStartWith(
      `error [email] planning skipped organization ${KOLKATA}:`,
    );
  });
});
