// Test-only builders for worker snapshots and fakes (imported by the *.test.ts files, never by the app).
import { PREFERENCE_KINDS } from "./kinds";
import type { EmailRpc } from "./rpc";
import type {
  ClaimedEmail,
  EmailResult,
  EmailSnapshot,
  KindToggles,
  OrgEmailSettings,
  OutboxInsert,
  SnapshotMembership,
  SnapshotOrganization,
  SnapshotPerson,
  SnapshotProject,
  SnapshotProjectCount,
  SnapshotRole,
  SnapshotTask,
} from "./snapshot";
import type { EmailTransport, OutgoingEmail } from "./transport";
import type { EmailLog } from "./worker";

export const APP = "https://flowdesk.test";

export const DUBAI = "a0000000-0000-4000-8000-000000000001";
export const KOLKATA = "b0000000-0000-4000-8000-000000000002";

export const ADMIN = "10000000-0000-4000-8000-000000000001"; // admin in Dubai
export const MAYA = "20000000-0000-4000-8000-000000000002"; // employee in Dubai
export const DAN = "30000000-0000-4000-8000-000000000003"; // employee in Dubai
export const LEAD = "40000000-0000-4000-8000-000000000004"; // team_lead in Kolkata, employee in Dubai

export const PROJECT = "p0000000-0000-4000-8000-000000000001";

/** Fri 25 Sep 2026, 08:30 in Dubai (UTC+4) and 10:00 in Kolkata (UTC+5:30). */
export const FRIDAY_0830_DUBAI = new Date("2026-09-25T04:30:00.000Z");

export const allKinds = (on = true): KindToggles =>
  Object.fromEntries(PREFERENCE_KINDS.map((kind) => [kind, on])) as KindToggles;

export const settings = (overrides: Partial<OrgEmailSettings> = {}): OrgEmailSettings => ({
  ...allKinds(),
  enabled: true,
  sendHour: 8,
  workingDays: [1, 2, 3, 4, 5],
  weeklyDay: 1,
  ...overrides,
});

export const org = (
  id: string,
  name: string,
  timezone: string,
  overrides: Partial<OrgEmailSettings> = {},
): SnapshotOrganization => ({ id, name, timezone, settings: settings(overrides) });

export const person = (
  userId: string,
  fullName: string | null,
  email: string | null,
  status = "active",
  username: string | null = null,
): SnapshotPerson => ({ userId, fullName, username, email, status });

export const membership = (
  userId: string,
  organizationId: string,
  isPrimary = true,
  status = "active",
): SnapshotMembership => ({ userId, organizationId, isPrimary, status });

export const role = (
  userId: string,
  organizationId: string,
  value: SnapshotRole["role"],
): SnapshotRole => ({ userId, organizationId, role: value });

let taskCounter = 0;

export function task(overrides: Partial<SnapshotTask> = {}): SnapshotTask {
  taskCounter += 1;
  const id = `t${String(taskCounter).padStart(7, "0")}-0000-4000-8000-000000000000`;
  return {
    id,
    organizationId: DUBAI,
    projectId: null,
    title: `Task ${taskCounter}`,
    status: "todo",
    priority: "medium",
    assigneeId: MAYA,
    reviewerId: null,
    createdBy: ADMIN,
    dueDate: null,
    dueAt: null,
    blocked: false,
    progress: 0,
    completedAt: null,
    archivedAt: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

export const project = (overrides: Partial<SnapshotProject> = {}): SnapshotProject => ({
  id: PROJECT,
  organizationId: DUBAI,
  name: "October Admissions Drive",
  status: "active",
  startDate: "2026-09-01",
  dueDate: "2026-10-31",
  archivedAt: null,
  ...overrides,
});

/** What email_worker_snapshot's projectCounts reports for these projects and tasks. */
export function projectCountsFor(
  projects: SnapshotProject[],
  tasks: SnapshotTask[],
): SnapshotProjectCount[] {
  return projects.map((p) => {
    const counted = tasks.filter((t) => t.projectId === p.id && !t.archivedAt);
    return {
      projectId: p.id,
      total: counted.filter((t) => t.status !== "cancelled").length,
      done: counted.filter((t) => t.status === "done").length,
    };
  });
}

/**
 * Two organizations (upCarrera in Dubai, TTI in Kolkata) and four people. Maya and Dan are
 * Dubai employees; the admin runs Dubai; the lead's primary org is Kolkata, where they are
 * team_lead, and they are also a plain employee in Dubai. projectCounts follows the projects
 * and tasks given, unless it is overridden too.
 */
export function baseSnapshot(overrides: Partial<EmailSnapshot> = {}): EmailSnapshot {
  const snapshot = {
    generatedAt: FRIDAY_0830_DUBAI.toISOString(),
    organizations: [
      org(DUBAI, "upCarrera", "Asia/Dubai"),
      org(KOLKATA, "Teachers' Training Institute of India", "Asia/Kolkata"),
    ],
    people: [
      person(ADMIN, "Test Admin", "admin@upcarrera.test"),
      person(MAYA, "Maya Chen", "maya@upcarrera.test"),
      person(DAN, "Dan Okafor", "dan@upcarrera.test"),
      person(LEAD, "Lakshmi Iyer", "lead@tti.test"),
    ],
    preferences: [],
    memberships: [
      membership(ADMIN, DUBAI),
      membership(MAYA, DUBAI),
      membership(DAN, DUBAI),
      membership(LEAD, KOLKATA, true),
      membership(LEAD, DUBAI, false),
    ],
    roles: [
      role(ADMIN, DUBAI, "admin"),
      role(MAYA, DUBAI, "employee"),
      role(DAN, DUBAI, "employee"),
      role(LEAD, KOLKATA, "team_lead"),
      role(LEAD, DUBAI, "employee"),
    ],
    projects: [project()],
    projectMembers: [{ projectId: PROJECT, userId: MAYA, roleLabel: "Coordinator" }],
    tasks: [],
    priorityLabels: [],
    statusLabels: [],
    ...overrides,
  };
  return {
    ...snapshot,
    projectCounts: overrides.projectCounts ?? projectCountsFor(snapshot.projects, snapshot.tasks),
  };
}

export function claimed(overrides: Partial<ClaimedEmail> = {}): ClaimedEmail {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    kind: "task_assigned",
    dedupeKey: "test",
    recipientUserId: MAYA,
    recipientEmail: null,
    organizationId: DUBAI,
    taskId: null,
    projectId: null,
    actorId: ADMIN,
    payload: {},
    attempts: 1,
    createdAt: FRIDAY_0830_DUBAI.toISOString(),
    ...overrides,
  };
}

export type FakeRpc = EmailRpc & {
  enqueued: OutboxInsert[][];
  completed: EmailResult[][];
  snapshots: number;
  claims: number;
};

/** A worker RPC over fixed snapshots; complete can fail its first `completeFailures` calls. */
export function fakeRpc(options: {
  snapshots: EmailSnapshot[];
  claim?: ClaimedEmail[];
  completeFailures?: number;
  snapshotFailsAt?: number;
  enqueueFails?: boolean;
}): FakeRpc {
  let completeFailures = options.completeFailures ?? 0;
  const rpc: FakeRpc = {
    enqueued: [],
    completed: [],
    snapshots: 0,
    claims: 0,
    async snapshot() {
      rpc.snapshots += 1;
      if (rpc.snapshots === options.snapshotFailsAt) throw new Error("email_worker_snapshot: boom");
      return options.snapshots[Math.min(rpc.snapshots, options.snapshots.length) - 1];
    },
    async enqueue(rows) {
      if (options.enqueueFails) throw new Error("email_worker_enqueue: bad row");
      rpc.enqueued.push(rows);
      return rows.length;
    },
    async claim() {
      rpc.claims += 1;
      return options.claim ?? [];
    },
    async complete(results) {
      if (completeFailures > 0) {
        completeFailures -= 1;
        throw new Error("email_worker_complete: network");
      }
      rpc.completed.push(results);
      return results.length;
    },
  };
  return rpc;
}

export type FakeTransport = EmailTransport & { sent: OutgoingEmail[]; attempts: OutgoingEmail[] };

/** Records every message; `failWith` returns the error to throw for a message, if any. */
export function fakeTransport(
  failWith: (message: OutgoingEmail) => unknown = () => undefined,
  name: EmailTransport["name"] = "log",
): FakeTransport {
  const sent: OutgoingEmail[] = [];
  const attempts: OutgoingEmail[] = [];
  return {
    name,
    sent,
    attempts,
    async send(message) {
      attempts.push(message);
      const error = failWith(message);
      if (error) throw error;
      sent.push(message);
    },
  };
}

export function memoryLog(): EmailLog & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (line) => lines.push(`info ${line}`),
    error: (line) => lines.push(`error ${line}`),
  };
}

/** A sleep that returns at once and remembers what it was asked for. */
export function fakeSleep(): ((ms: number) => Promise<void>) & { calls: number[] } {
  const calls: number[] = [];
  const sleep = async (ms: number) => {
    calls.push(ms);
  };
  return Object.assign(sleep, { calls });
}
