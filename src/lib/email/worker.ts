import { composeEmail, type ComposeResult } from "./compose";
import { describeConfig, readEmailEnv, type EmailWorkerConfig } from "./env";
import { createEmailRpc, type EmailRpc } from "./rpc";
import { planScheduledEmails, planningDue, type PlanningSkip } from "./schedule";
import type {
  ClaimedEmail,
  EmailResult,
  EmailSnapshot,
  OutboxInsert,
  SnapshotOrganization,
} from "./snapshot";
import {
  EmailTransportError,
  createGraphTransport,
  createLogTransport,
  type EmailTransport,
} from "./transport";

export type EmailLog = { info(line: string): void; error(line: string): void };

export type TickDeps = {
  rpc: EmailRpc;
  transport: EmailTransport;
  now: Date;
  appUrl: string;
  log: EmailLog;
  claimLimit?: number;
  /** Pause between two messages handed to the transport. */
  sendGapMs?: number;
  /** Replaces the real timer (pacing and complete retries), for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** True once the server is shutting down: no new send starts, the rest goes back to the queue. */
  stopping?: () => boolean;
  /** Skips the planning snapshot outside every send window; without one, every tick plans. */
  gate?: PlanningGate;
};

export type TickResult = {
  planned: number;
  enqueued: number;
  claimed: number;
  sent: number;
  suppressed: number;
  retried: number;
  failed: number;
  deferred: number;
};

export const FIRST_TICK_DELAY_MS = 30_000;
/** At most ~24 a minute: under Exchange Online's 30 messages a minute per sending mailbox. */
export const SEND_GAP_MS = 2_500;
/** About a minute of paced sending per tick; a morning burst drains over the next ticks. */
export const CLAIM_LIMIT = 20;
/** Throttled or unreachable, and Graph did not say for how long. */
export const DEFAULT_PAUSE_SECONDS = 60;
/** Credentials or mailbox problem: it needs a person, so only look again every quarter hour. */
export const CONFIG_PAUSE_SECONDS = 900;
/** email_worker_complete clamps a deferral to an hour as well. */
const MAX_PAUSE_SECONDS = 3_600;
/** Cached organization settings decide whether a tick needs a planning snapshot for this long. */
export const ORG_CACHE_MAX_AGE_MS = 60 * 60_000;
/** Failures that say nothing about the message, this many in a row, mean Graph itself is down. */
export const OUTAGE_STREAK = 2;
/** email_worker_complete fails a retried row once its attempts reach this (the literal 5 there). */
export const MAX_SEND_ATTEMPTS = 5;
/** Waits before the second and third attempt to record a result. */
const COMPLETE_BACKOFF_MS = [1_000, 5_000];
const ERROR_CHARS = 500;

const consoleLog: EmailLog = {
  info: (line) => console.info(line),
  error: (line) => console.error(line),
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, ERROR_CHARS);

/** Log lines carry no addresses; Graph error bodies can quote the recipient. */
const redact = (text: string) => text.replace(/[^\s"'<>(),;:]+@[^\s"'<>(),;:]+/g, "<address>");

type Pause = { reason: string; retryAfterSeconds: number };
/**
 * A row's result, and whether the rest of the batch must wait. `outage` is the pause to take
 * instead if this failure turns out to be one of OUTAGE_STREAK in a row.
 */
type RowOutcome = { result: EmailResult; pause?: Pause; outage?: Pause };

const deferred = (row: ClaimedEmail, pause: Pause): EmailResult => ({
  id: row.id,
  outcome: "defer",
  error: pause.reason,
  retryAfterSeconds: pause.retryAfterSeconds,
});

const pauseFor = (seconds: number, why: string, text: string): Pause => ({
  reason: `paused ${seconds}s, ${why}: ${text}`,
  retryAfterSeconds: seconds,
});

/** A restart puts the unsent rest of a batch back, rather than PM2's kill cutting a send off. */
const STOPPING: Pause = { reason: "the server was stopping", retryAfterSeconds: 30 };

const holdBatch = (row: ClaimedEmail, pause: Pause): RowOutcome => ({
  result: deferred(row, pause),
  pause,
});

function throttled(row: ClaimedEmail, error: EmailTransportError, text: string): RowOutcome {
  const asked = Math.ceil(error.retryAfterSeconds || DEFAULT_PAUSE_SECONDS);
  const wait = Math.min(MAX_PAUSE_SECONDS, Math.max(1, asked));
  return holdBatch(row, pauseFor(wait, "Graph is throttling or unavailable", text));
}

const checkSender = (text: string) =>
  pauseFor(CONFIG_PAUSE_SECONDS, "check the Graph credentials and sender", text);

/**
 * What a failed send means for this row and for the rest of the batch.
 * - 429 and 503 (throttled, unavailable): the batch waits as long as Graph asks.
 * - Any token endpoint failure, or sendMail 401/403/404: the sender or its credentials need a
 *   person, so the batch waits a quarter of an hour. Neither of these uses up an attempt.
 * - 400: Graph refused this message (in practice its recipient); sending it again cannot help.
 * - Anything else, another 5xx or no answer included: this row is retried, which uses an attempt,
 *   so a message Graph always refuses fails after five, and the batch carries on. A 5xx or no
 *   answer is also marked as a possible outage (see OUTAGE_STREAK).
 */
export function sendFailure(row: ClaimedEmail, error: unknown): RowOutcome {
  const text = errorText(error);
  const retry: EmailResult = { id: row.id, outcome: "retry", error: text };
  if (!(error instanceof EmailTransportError)) return { result: retry };
  const { stage, status } = error;
  if (status === 429 || status === 503) return throttled(row, error, text);
  if (stage === "token") {
    if (status === undefined) {
      return holdBatch(row, pauseFor(DEFAULT_PAUSE_SECONDS, "Graph did not answer", text));
    }
    return status >= 500 ? throttled(row, error, text) : holdBatch(row, checkSender(text));
  }
  if (status === 401 || status === 403 || status === 404) return holdBatch(row, checkSender(text));
  if (status === 400) return { result: { id: row.id, outcome: "failed", error: text } };
  if (status !== undefined && status < 500) return { result: retry };
  const why = `Graph failed ${OUTAGE_STREAK} sends in a row`;
  const outage = pauseFor(DEFAULT_PAUSE_SECONDS, why, text);
  // A long outage costs the first row of each tick an attempt; it must never cost a row its last,
  // or Graph being down for a few hours would fail email that had days to live. A message Graph
  // itself keeps refusing therefore ends as expired rather than failed.
  if (row.attempts >= MAX_SEND_ATTEMPTS) return { result: deferred(row, outage), outage };
  return { result: retry, outage };
}

/** Sleeps between messages handed to the transport, never before the first. */
function pacer(deps: TickDeps): () => Promise<void> {
  // The gap protects the Graph mailbox's rate limit; writing files needs none.
  const gap = deps.sendGapMs ?? (deps.transport.name === "graph" ? SEND_GAP_MS : 0);
  let first = true;
  return async () => {
    if (!first && gap > 0) await (deps.sleep ?? realSleep)(gap);
    first = false;
  };
}

/** The tick could not get a snapshot to compose with; the rows it has not settled are put back. */
class SnapshotUnavailable extends Error {
  readonly original: unknown;

  constructor(original: unknown) {
    super(`snapshot before send: ${errorText(original)}`);
    this.original = original;
  }
}

type SnapshotSource = { compose(row: ClaimedEmail): Promise<ComposeResult> };

/**
 * What claimed rows are composed against: this tick's planning snapshot, fetched a few seconds
 * before the claim, or one fetched now when the tick did not plan. A row it would suppress is
 * composed again against a snapshot taken after the claim (fetched at most once a tick), because
 * suppression is final and an event row that committed after the planning snapshot (say
 * task_assigned for a task created a moment ago) must see its own task. A send decided on the
 * planning snapshot is no staler than one decided at the end of a paced batch.
 */
function snapshotSource(deps: TickDeps, planned: EmailSnapshot | undefined): SnapshotSource {
  let current = planned;
  let fresh = false;
  const refresh = async (): Promise<EmailSnapshot> => {
    let snapshot: EmailSnapshot;
    try {
      snapshot = await deps.rpc.snapshot();
    } catch (error) {
      throw new SnapshotUnavailable(error);
    }
    deps.gate?.remember(snapshot, deps.now);
    current = snapshot;
    fresh = true;
    return snapshot;
  };
  const composeWith = (row: ClaimedEmail, snapshot: EmailSnapshot) =>
    composeEmail(row, snapshot, { appUrl: deps.appUrl, now: deps.now });
  return {
    async compose(row) {
      const first = composeWith(row, current ?? (await refresh()));
      return first.outcome === "send" || fresh ? first : composeWith(row, await refresh());
    },
  };
}

async function processRow(
  row: ClaimedEmail,
  source: SnapshotSource,
  deps: TickDeps,
  pace: () => Promise<void>,
): Promise<RowOutcome> {
  let composed: ComposeResult;
  try {
    composed = await source.compose(row);
  } catch (error) {
    if (error instanceof SnapshotUnavailable) throw error;
    // A composer bug fails the same way on every attempt, so it is not retried.
    deps.log.error(`[email] compose failed for ${row.kind} ${row.id}: ${redact(errorText(error))}`);
    return { result: { id: row.id, outcome: "failed", error: `compose: ${errorText(error)}` } };
  }
  if (composed.outcome === "suppress") {
    return { result: { id: row.id, outcome: "suppressed", error: composed.reason } };
  }
  await pace();
  // Checked after the pause, so a shutdown never starts a send it may not live to record.
  if (deps.stopping?.()) return { result: deferred(row, STOPPING), pause: STOPPING };
  try {
    await deps.transport.send({
      to: composed.to,
      toName: composed.toName || undefined,
      subject: composed.subject,
      html: composed.html,
    });
    return { result: { id: row.id, outcome: "sent" } };
  } catch (error) {
    return sendFailure(row, error);
  }
}

/** Rows left 'sending' are reclaimed after 15 minutes and sent again, so this tries hard. */
async function record(deps: TickDeps, results: EmailResult[]): Promise<void> {
  const sleep = deps.sleep ?? realSleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.rpc.complete(results);
      return;
    } catch (error) {
      const wait = COMPLETE_BACKOFF_MS[attempt];
      if (wait === undefined) {
        throw new Error(
          `could not record ${results.length} result(s) after ${attempt + 1} attempts: ${errorText(error)}`,
        );
      }
      await sleep(wait);
    }
  }
}

/** One line per distinct failure reason, so a broken sender is visible in the process log. */
function logFailures(log: EmailLog, results: EmailResult[]) {
  const counts = new Map<string, number>();
  for (const result of results) {
    if (result.outcome === "sent" || result.outcome === "suppressed") continue;
    if (result.error === STOPPING.reason) continue;
    const key = `${result.outcome}: ${redact(result.error)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, n] of counts) log.error(`[email] ${n} x ${key}`);
}

/** `ok` is false when planning threw outright, so the snapshot is not trusted to compose with. */
function planRows(snapshot: EmailSnapshot, deps: TickDeps): { rows: OutboxInsert[]; ok: boolean } {
  const skipped: PlanningSkip[] = [];
  let planned = { rows: [] as OutboxInsert[], ok: false };
  try {
    planned = {
      rows: planScheduledEmails(snapshot, deps.now, (skip) => skipped.push(skip)),
      ok: true,
    };
  } catch (error) {
    deps.log.error(`[email] planning failed, sending what is queued: ${redact(errorText(error))}`);
  }
  for (const skip of skipped) {
    deps.log.error(
      `[email] planning skipped ${skip.scope} ${skip.id}: ${redact(errorText(skip.error))}`,
    );
  }
  return planned;
}

async function enqueueRows(rows: OutboxInsert[], deps: TickDeps): Promise<number> {
  try {
    return await deps.rpc.enqueue(rows);
  } catch (error) {
    deps.log.error(`[email] enqueue failed, sending what is queued: ${errorText(error)}`);
    return 0;
  }
}

/** No snapshot to compose with: the rows not yet settled go back as retries, and the tick fails. */
async function putBack(
  unsettled: ClaimedEmail[],
  failure: SnapshotUnavailable,
  deps: TickDeps,
  results: EmailResult[],
): Promise<never> {
  const batch = unsettled.map(
    (row): EmailResult => ({ id: row.id, outcome: "retry", error: failure.message }),
  );
  results.push(...batch);
  await record(deps, batch);
  throw failure.original;
}

/**
 * A second possible outage in a row (a 5xx or no answer, with nothing in between that Graph
 * accepted or rejected) holds this row and the rest back without using attempts: one message that
 * Graph always refuses costs only its own attempt, but a Graph that is down cannot burn the queue.
 */
function streakOutcome(row: ClaimedEmail, outcome: RowOutcome, streak: number): RowOutcome {
  return outcome.outage && streak >= OUTAGE_STREAK ? holdBatch(row, outcome.outage) : outcome;
}

/** A suppressed row never reached Graph, so it leaves the streak alone; anything else ends it. */
const nextStreak = (streak: number, outcome: RowOutcome) =>
  outcome.outage ? streak + 1 : outcome.result.outcome === "suppressed" ? streak : 0;

/** processRow, except that a missing snapshot puts this row and every later one back. */
async function settleRow(
  claimed: ClaimedEmail[],
  position: number,
  source: SnapshotSource,
  deps: TickDeps,
  pace: () => Promise<void>,
  results: EmailResult[],
): Promise<RowOutcome> {
  try {
    return await processRow(claimed[position], source, deps, pace);
  } catch (error) {
    if (!(error instanceof SnapshotUnavailable)) throw error;
    return putBack(claimed.slice(position), error, deps, results);
  }
}

async function sendClaimed(
  claimed: ClaimedEmail[],
  source: SnapshotSource,
  deps: TickDeps,
): Promise<EmailResult[]> {
  const results: EmailResult[] = [];
  const pace = pacer(deps);
  let streak = 0;
  try {
    for (const [position, row] of claimed.entries()) {
      const raw = await settleRow(claimed, position, source, deps, pace, results);
      streak = nextStreak(streak, raw);
      const { result, pause } = streakOutcome(row, raw, streak);
      const batch = pause
        ? [result, ...claimed.slice(position + 1).map((rest) => deferred(rest, pause))]
        : [result];
      results.push(...batch);
      // Recorded row by row: a crash or restart mid-batch re-sends at most the one email in flight.
      await record(deps, batch);
      if (pause === STOPPING) {
        deps.log.info(`[email] stopping: ${batch.length} email(s) put back for the next start`);
      }
      if (pause) break;
    }
  } finally {
    logFailures(deps.log, results);
  }
  return results;
}

const count = (results: EmailResult[], outcome: EmailResult["outcome"]) =>
  results.filter((result) => result.outcome === outcome).length;

/**
 * Remembers each organization's timezone and email settings from the latest snapshot, so a tick
 * outside every send window skips the planning snapshot. The cache counts as stale after
 * ORG_CACHE_MAX_AGE_MS, so a settings change (an earlier send hour, a new working day, a new
 * organization) takes effect within the hour. An empty cache, as after a restart, always plans.
 */
export type PlanningGate = {
  shouldPlan(now: Date): boolean;
  remember(snapshot: EmailSnapshot, now: Date): void;
};

export function createPlanningGate(maxAgeMs = ORG_CACHE_MAX_AGE_MS): PlanningGate {
  let cached: { organizations: readonly SnapshotOrganization[]; at: number } | undefined;
  return {
    shouldPlan(now) {
      if (!cached) return true;
      const age = now.getTime() - cached.at;
      // A negative age is a clock that went back: trust nothing cached.
      return age < 0 || age >= maxAgeMs || planningDue(cached.organizations, now);
    },
    remember(snapshot, now) {
      cached = Array.isArray(snapshot.organizations)
        ? { organizations: snapshot.organizations, at: now.getTime() }
        : undefined;
    },
  };
}

type Planning = { planned: number; enqueued: number; snapshot?: EmailSnapshot };

async function planAndEnqueue(deps: TickDeps): Promise<Planning> {
  if (deps.gate && !deps.gate.shouldPlan(deps.now)) return { planned: 0, enqueued: 0 };
  const snapshot = await deps.rpc.snapshot();
  deps.gate?.remember(snapshot, deps.now);
  const { rows, ok } = planRows(snapshot, deps);
  const enqueued = await enqueueRows(rows, deps);
  return { planned: rows.length, enqueued, snapshot: ok ? snapshot : undefined };
}

/**
 * One pass: plan scheduled email and queue it (skipped when the gate says no organization is in
 * its send window), then claim and send whatever is due, composed with the same snapshot where
 * it can. The outbox's dedupe keys make every step safe to repeat. A planning or enqueue problem
 * is logged and the queue is still sent; the tick throws only when the snapshot, claim or
 * complete RPC fails (the loop logs it).
 */
export async function runEmailTick(deps: TickDeps): Promise<TickResult> {
  const planning = await planAndEnqueue(deps);
  const claimed = await deps.rpc.claim(deps.claimLimit ?? CLAIM_LIMIT);
  const empty = {
    planned: planning.planned,
    enqueued: planning.enqueued,
    claimed: 0,
    sent: 0,
    suppressed: 0,
    retried: 0,
    failed: 0,
    deferred: 0,
  };
  if (claimed.length === 0) return empty;

  const results = await sendClaimed(claimed, snapshotSource(deps, planning.snapshot), deps);
  return {
    ...empty,
    claimed: claimed.length,
    sent: count(results, "sent"),
    suppressed: count(results, "suppressed"),
    retried: count(results, "retry"),
    failed: count(results, "failed"),
    deferred: count(results, "defer"),
  };
}

const summarize = (result: TickResult) =>
  Object.entries(result)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

export function createTransport(config: EmailWorkerConfig, log: EmailLog): EmailTransport {
  if (config.transport.kind === "log") {
    return createLogTransport(config.transport.dir, (line) => log.info(line));
  }
  return createGraphTransport(config.transport);
}

type WorkerState = { stop: () => Promise<void> };

const WORKER_KEY = Symbol.for("flowdesk.emailWorker");
type WorkerGlobal = typeof globalThis & { [WORKER_KEY]?: WorkerState | "disabled" };

export type StartOptions = {
  env?: Record<string, string | undefined>;
  log?: EmailLog;
  firstTickDelayMs?: number;
  /** Replaces the real clock, for a manual run. */
  now?: () => Date;
};

function scheduleLoop(config: EmailWorkerConfig, options: Required<Omit<StartOptions, "env">>) {
  const { log } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let inFlight: Promise<void> | undefined;
  let ticks = 0;
  const deps = {
    rpc: createEmailRpc({
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.supabasePublishableKey,
      secret: config.secret,
    }),
    transport: createTransport(config, log),
    appUrl: config.appUrl,
    log,
    stopping: () => stopped,
    // One per process: a restart starts with an empty cache, so its first tick plans.
    gate: createPlanningGate(),
  };

  const tick = async () => {
    ticks += 1;
    try {
      const result = await runEmailTick({ ...deps, now: options.now() });
      const busy = Object.values(result).some((value) => value > 0);
      if (busy || ticks === 1) log.info(`[email] tick ${ticks}: ${summarize(result)}`);
    } catch (error) {
      log.error(`[email] tick ${ticks} failed: ${errorText(error)}`);
    } finally {
      // Chained rather than setInterval, so a slow tick can never overlap the next one.
      if (!stopped) timer = setTimeout(run, config.intervalMs);
      timer?.unref?.();
    }
  };
  const run = () => {
    inFlight = tick().finally(() => {
      inFlight = undefined;
    });
  };

  timer = setTimeout(run, options.firstTickDelayMs);
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      return inFlight ?? Promise.resolve();
    },
  };
}

/**
 * Start the background email worker, at most once per process: the nitro plugin starts it at
 * boot and src/server.ts calls it again, and both may run from separate bundles, so the guard
 * lives on globalThis. Returns whether this call started it. Never throws.
 */
export function startEmailWorker(options: StartOptions = {}): boolean {
  const scope = globalThis as WorkerGlobal;
  if (scope[WORKER_KEY]) return false;
  const log = options.log ?? consoleLog;
  try {
    const env = readEmailEnv(options.env ?? process.env);
    if (!env.ok) {
      scope[WORKER_KEY] = "disabled";
      const line = `[email] worker not started: ${env.reason}`;
      if (env.misconfigured) log.error(line);
      else log.info(line);
      return false;
    }
    const delay = options.firstTickDelayMs ?? FIRST_TICK_DELAY_MS;
    scope[WORKER_KEY] = scheduleLoop(env.config, {
      log,
      firstTickDelayMs: delay,
      now: options.now ?? (() => new Date()),
    });
    log.info(
      `[email] worker started (${describeConfig(env.config)}, first tick in ${Math.round(delay / 1000)}s)`,
    );
    return true;
  } catch (error) {
    scope[WORKER_KEY] = "disabled";
    log.error(`[email] worker not started: ${errorText(error)}`);
    return false;
  }
}

/**
 * Test and shutdown hook: stops the loop and lets startEmailWorker run again. Resolves once a
 * tick in flight has recorded its last send and put the rest of its batch back.
 */
export function stopEmailWorker(): Promise<void> {
  const scope = globalThis as WorkerGlobal;
  const state = scope[WORKER_KEY];
  delete scope[WORKER_KEY];
  return state && state !== "disabled" ? state.stop() : Promise.resolve();
}
