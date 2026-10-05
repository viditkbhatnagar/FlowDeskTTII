// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { afterEach, describe, expect, test } from "bun:test";
import { memoryLog } from "./fixtures";
import {
  WAKE_GAP_MS,
  createTickLoop,
  startEmailWorker,
  stopEmailWorker,
  wakeEmailWorker,
  type LoopTimers,
  type TickLoop,
} from "./worker";

const FIRST = 30_000;
const INTERVAL = 300_000;

/** Lets the loop's promise callbacks run (a real macrotask; only the loop's timers are fake). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Timers on a clock that moves only when the test advances it. */
function fakeClock() {
  let now = 0;
  let lastId = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: LoopTimers = {
    now: () => now,
    setTimeout: (run, ms) => {
      lastId += 1;
      pending.set(lastId, { at: now + ms, run });
      return lastId;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
  };
  const earliest = () =>
    [...pending.entries()].sort(([a, x], [b, y]) => x.at - y.at || a - b)[0] as
      | [number, { at: number; run: () => void }]
      | undefined;
  return {
    timers,
    now: () => now,
    pending: () => pending.size,
    /** How long until the next timer fires; undefined when none is set. */
    next: () => {
      const first = earliest();
      return first ? first[1].at - now : undefined;
    },
    /** Moves the clock on by `ms`, firing each timer that comes due on the way, in order. */
    async advance(ms: number) {
      const end = now + ms;
      for (let first = earliest(); first && first[1].at <= end; first = earliest()) {
        pending.delete(first[0]);
        now = first[1].at;
        first[1].run();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

/** Ticks that stay in flight until the test ends them, remembering when each started. */
function manualTicks(clock: ReturnType<typeof fakeClock>) {
  const started: number[] = [];
  let finish: (() => void) | undefined;
  return {
    started,
    tick: () => {
      started.push(clock.now());
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    async end() {
      if (!finish) throw new Error("no tick in flight");
      const done = finish;
      finish = undefined;
      done();
      await settle();
    },
  };
}

function setup(intervalMs = INTERVAL) {
  const clock = fakeClock();
  const ticks = manualTicks(clock);
  const loop: TickLoop = createTickLoop({
    tick: ticks.tick,
    intervalMs,
    firstTickDelayMs: FIRST,
    timers: clock.timers,
  });
  /** Runs the first tick and ends it after `tookMs`. */
  const firstTick = async (tookMs = 0) => {
    await clock.advance(FIRST);
    await clock.advance(tookMs);
    await ticks.end();
  };
  return { clock, ticks, loop, firstTick };
}

describe("the tick loop without wakes", () => {
  test("first tick after the start-up delay, then the interval after each tick ends", async () => {
    const { clock, ticks } = setup();
    await clock.advance(FIRST - 1);
    expect(ticks.started).toEqual([]);
    await clock.advance(1);
    expect(ticks.started).toEqual([FIRST]);
    await clock.advance(10_000); // a slow tick: the next is counted from its end
    await ticks.end();
    expect(clock.next()).toBe(INTERVAL);
    await clock.advance(INTERVAL);
    expect(ticks.started).toEqual([FIRST, FIRST + 10_000 + INTERVAL]);
  });

  test("ticks never overlap: nothing starts while one is in flight", async () => {
    const { clock, ticks } = setup();
    await clock.advance(FIRST);
    await clock.advance(INTERVAL * 3);
    expect(ticks.started).toEqual([FIRST]);
    expect(clock.pending()).toBe(0);
  });
});

describe("wake", () => {
  test("when idle it runs a tick at once, and the schedule carries on from that tick", async () => {
    const { clock, ticks, loop, firstTick } = setup();
    await firstTick();
    await clock.advance(60_000);
    loop.wake();
    expect(clock.next()).toBe(0);
    await clock.advance(0);
    expect(ticks.started).toEqual([FIRST, FIRST + 60_000]);
    await ticks.end();
    expect(clock.next()).toBe(INTERVAL);
  });

  test("never sooner than WAKE_GAP_MS after the previous tick ended", async () => {
    const { clock, ticks, loop, firstTick } = setup();
    expect(WAKE_GAP_MS).toBe(3_000);
    await firstTick(500); // ended at FIRST + 500
    await clock.advance(1_000);
    loop.wake();
    expect(clock.next()).toBe(WAKE_GAP_MS - 1_000);
    await clock.advance(WAKE_GAP_MS - 1_001);
    expect(ticks.started).toEqual([FIRST]);
    await clock.advance(1);
    expect(ticks.started).toEqual([FIRST, FIRST + 500 + WAKE_GAP_MS]);
  });

  test("a burst of wakes costs one tick", async () => {
    const { clock, ticks, loop, firstTick } = setup();
    await firstTick();
    for (let i = 0; i < 50; i += 1) {
      loop.wake();
      await clock.advance(20); // spread over a second, all inside the gap
    }
    expect(clock.pending()).toBe(1);
    await clock.advance(WAKE_GAP_MS);
    expect(ticks.started).toEqual([FIRST, FIRST + WAKE_GAP_MS]);
    await ticks.end();
    // Answered: the loop is back on its schedule, with no second tick owed.
    expect(clock.next()).toBe(INTERVAL);
  });

  test("wakes during a tick earn exactly one more, WAKE_GAP_MS after it ends", async () => {
    const { clock, ticks, loop } = setup();
    await clock.advance(FIRST); // tick 1 in flight; its claim may predate the new email
    loop.wake();
    loop.wake();
    await clock.advance(20_000);
    loop.wake();
    expect(ticks.started).toEqual([FIRST]);
    await ticks.end(); // at FIRST + 20 s
    expect(clock.next()).toBe(WAKE_GAP_MS);
    await clock.advance(WAKE_GAP_MS);
    expect(ticks.started).toEqual([FIRST, FIRST + 20_000 + WAKE_GAP_MS]);
    await ticks.end();
    expect(clock.next()).toBe(INTERVAL);
  });

  test("before the first tick it changes nothing: the start-up delay holds", async () => {
    const { clock, ticks, loop } = setup();
    await clock.advance(5_000);
    loop.wake();
    expect(clock.next()).toBe(FIRST - 5_000);
    await clock.advance(FIRST - 5_001);
    expect(ticks.started).toEqual([]);
    await clock.advance(1);
    expect(ticks.started).toEqual([FIRST]);
  });

  test("never pushes back a tick already due sooner", async () => {
    // An interval shorter than the gap (not allowed by the env settings, but the loop copes).
    const { clock, ticks, loop, firstTick } = setup(2_000);
    await firstTick();
    await clock.advance(500);
    loop.wake();
    expect(clock.next()).toBe(1_500);
    await clock.advance(1_500);
    expect(ticks.started).toEqual([FIRST, FIRST + 2_000]);
    loop.wake(); // in flight: the follow-up is the interval, as it is the sooner
    await ticks.end();
    expect(clock.next()).toBe(2_000);
  });
});

describe("stop", () => {
  test("waits for the tick in flight, and nothing runs after it, not even an owed wake", async () => {
    const { clock, ticks, loop } = setup();
    await clock.advance(FIRST);
    loop.wake();
    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await settle();
    expect(stopped).toBe(false);
    await ticks.end();
    await stopping;
    expect(stopped).toBe(true);
    expect(clock.pending()).toBe(0);
    loop.wake();
    expect(clock.pending()).toBe(0);
    await clock.advance(INTERVAL * 2);
    expect(ticks.started).toEqual([FIRST]);
  });

  test("while idle it cancels the next tick at once", async () => {
    const { clock, ticks, loop, firstTick } = setup();
    await firstTick();
    loop.wake();
    await loop.stop();
    expect(clock.pending()).toBe(0);
    await clock.advance(INTERVAL);
    expect(ticks.started).toEqual([FIRST]);
  });
});

describe("wakeEmailWorker", () => {
  afterEach(() => stopEmailWorker());

  const KEY = Symbol.for("flowdesk.emailWorker");
  const scope = globalThis as unknown as Record<symbol, unknown>;
  const enabledEnv = {
    EMAIL_WORKER_ENABLED: "true",
    EMAIL_WORKER_SECRET: "k".repeat(40),
    // Nothing listens on port 9; with the first tick a minute away, nothing is called anyway.
    SUPABASE_URL: "http://127.0.0.1:9",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    EMAIL_TRANSPORT: "log",
    EMAIL_LOG_DIR: "/tmp/flowdesk-email-test-unused",
    EMAIL_WORKER_INTERVAL_MS: "60000",
  };

  test("false when no worker runs in this process", () => {
    expect(wakeEmailWorker()).toBe(false);
    expect(startEmailWorker({ env: {}, log: memoryLog() })).toBe(false); // switched off
    expect(wakeEmailWorker()).toBe(false);
  });

  test("true while the worker runs, false again once it has stopped", async () => {
    expect(startEmailWorker({ env: enabledEnv, log: memoryLog(), firstTickDelayMs: 60_000 })).toBe(
      true,
    );
    expect(wakeEmailWorker()).toBe(true);
    await stopEmailWorker();
    expect(wakeEmailWorker()).toBe(false);
  });

  test("reaches a worker that another copy of this module started", () => {
    let wakes = 0;
    scope[KEY] = { wake: () => (wakes += 1), stop: async () => {} };
    expect(wakeEmailWorker()).toBe(true);
    expect(wakes).toBe(1);
  });

  test("leaves alone a worker from a copy older than wake", () => {
    scope[KEY] = { stop: async () => {} };
    expect(wakeEmailWorker()).toBe(false);
  });
});

describe("isEmailWorkerRunning", () => {
  const KEY = Symbol.for("flowdesk.emailWorker");
  const scope = globalThis as unknown as Record<symbol, unknown>;

  test("true only while a worker is running in this process", async () => {
    const { isEmailWorkerRunning } = await import("./worker");
    const before = scope[KEY];
    try {
      delete scope[KEY];
      expect(isEmailWorkerRunning()).toBe(false);
      scope[KEY] = "disabled";
      expect(isEmailWorkerRunning()).toBe(false);
      scope[KEY] = { stop: () => Promise.resolve(), wake: () => {} };
      expect(isEmailWorkerRunning()).toBe(true);
    } finally {
      if (before === undefined) delete scope[KEY];
      else scope[KEY] = before;
    }
  });
});

