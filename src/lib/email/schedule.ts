import {
  dailyDigestContent,
  dailyManagementContent,
  weeklyDigestContent,
  weeklyManagementContent,
  type DigestArgs,
} from "./digests";
import type { ScheduledKind } from "./kinds";
import {
  groupBy,
  indexSnapshot,
  isActiveMember,
  isEligiblePerson,
  isOpenTask,
  kindEnabledForOrg,
  preferenceOn,
  type SnapshotIndex,
} from "./lookup";
import type { EmailSnapshot, OutboxInsert, SnapshotOrganization, SnapshotTask } from "./snapshot";
import {
  addDays,
  effectiveDue,
  localParts,
  nextWorkingDay,
  prevWorkingDay,
  startOfLocalDay,
  zonedTimeToUtc,
} from "./time";

/** Scheduled email goes out in the first three hours from the organization's send hour. */
export const SEND_WINDOW_HOURS = 3;

export type OrgClock = {
  org: SnapshotOrganization;
  today: string;
  hour: number;
  isoDow: number;
  inWindow: boolean;
  workingDay: boolean;
  weeklyDay: boolean;
  /**
   * When a row planned in today's window stops being worth sending: the window's end, but never
   * past local midnight, where the composer would fill today's email with tomorrow's tasks.
   */
  expiresAt: string;
};

export function orgClock(org: SnapshotOrganization, now: Date): OrgClock {
  const local = localParts(now, org.timezone);
  const { sendHour, workingDays, weeklyDay } = org.settings;
  const windowEnd = zonedTimeToUtc(local.date, sendHour + SEND_WINDOW_HOURS, org.timezone);
  const midnight = startOfLocalDay(addDays(local.date, 1), org.timezone);
  return {
    org,
    today: local.date,
    hour: local.hour,
    isoDow: local.isoDow,
    inWindow: local.hour >= sendHour && local.hour < sendHour + SEND_WINDOW_HOURS,
    workingDay: workingDays.includes(local.isoDow),
    weeklyDay: local.isoDow === weeklyDay,
    expiresAt: new Date(Math.min(windowEnd.getTime(), midnight.getTime())).toISOString(),
  };
}

/**
 * Whether planning at `now` can queue anything for these organizations: one of them is inside its
 * send window on a working day or its weekly day. Every scheduled email needs that, so the worker
 * asks this of its cached organizations before paying for a snapshot. An organization whose clock
 * throws counts as closed; the planner reports it whenever it does run.
 */
export function planningDue(organizations: readonly SnapshotOrganization[], now: Date): boolean {
  return organizations.some((org) => {
    try {
      const clock = orgClock(org, now);
      return clock.inWindow && (clock.workingDay || clock.weeklyDay);
    } catch {
      return false;
    }
  });
}

type RowFields = {
  kind: ScheduledKind;
  dedupeKey: string;
  recipientUserId: string;
  clock: OrgClock;
  now: Date;
  taskId?: string | null;
  projectId?: string | null;
  payload?: Record<string, unknown>;
};

function outboxRow(fields: RowFields): OutboxInsert {
  return {
    kind: fields.kind,
    dedupeKey: fields.dedupeKey,
    recipientUserId: fields.recipientUserId,
    organizationId: fields.clock.org.id,
    taskId: fields.taskId ?? null,
    projectId: fields.projectId ?? null,
    payload: {
      localDate: fields.clock.today,
      timezone: fields.clock.org.timezone,
      ...fields.payload,
    },
    notBefore: fields.now.toISOString(),
    expiresAt: fields.clock.expiresAt,
  };
}

/** Kinds sent about one task: the reminder before it is due, and one alert after. */
type TaskKind = Extract<ScheduledKind, "due_reminder" | "overdue_alert">;

export function taskKindFor(due: string, clock: OrgClock): TaskKind | null {
  const { today } = clock;
  const { workingDays } = clock.org.settings;
  // Everything due up to the next working day, so Friday covers the weekend.
  if (due > today && due <= nextWorkingDay(today, workingDays)) return "due_reminder";
  // Only what fell due since the previous working day: an older overdue task already had
  // its alert (or predates email entirely), and the digest keeps listing it.
  if (due >= prevWorkingDay(today, workingDays) && due <= addDays(today, -1)) {
    return "overdue_alert";
  }
  return null;
}

/** What the planner skipped because planning it threw. */
export type PlanningSkip = {
  scope: "organization" | "task" | "person";
  id: string;
  error: unknown;
};

/** One bad record must cost only its own email, never everyone else's. */
function isolated<T>(
  scope: PlanningSkip["scope"],
  id: string,
  onSkip: (skip: PlanningSkip) => void,
  plan: () => T[],
): T[] {
  try {
    return plan();
  } catch (error) {
    onSkip({ scope, id, error });
    return [];
  }
}

/** A task email the day calls for, whether or not its organization's window is open right now. */
type TaskCandidate = { row: OutboxInsert; task: SnapshotTask; due: string; inWindow: boolean };

function taskCandidate(
  index: SnapshotIndex,
  clocks: ReadonlyMap<string, OrgClock>,
  task: SnapshotTask,
  now: Date,
): TaskCandidate | null {
  const clock = clocks.get(task.organizationId);
  const assigneeId = task.assigneeId;
  if (!clock?.workingDay || !assigneeId || !isOpenTask(task)) return null;
  if (!isEligiblePerson(index.personById.get(assigneeId))) return null;
  if (!isActiveMember(index, assigneeId, task.organizationId)) return null;
  const due = effectiveDue(task, clock.org.timezone);
  const kind = due ? taskKindFor(due, clock) : null;
  if (!due || !kind) return null;
  if (!kindEnabledForOrg(clock.org, kind) || !preferenceOn(index, assigneeId, kind)) return null;
  const row = outboxRow({
    kind,
    dedupeKey: `${kind}:${task.id}:${due}`,
    recipientUserId: assigneeId,
    clock,
    now,
    taskId: task.id,
    projectId: task.projectId,
    payload: { due },
  });
  return { row, task, due, inWindow: clock.inWindow };
}

/**
 * At most this many due reminders, and as many overdue alerts, per person and local day. Two
 * thousand tasks due tomorrow must not become two thousand emails that crowd everyone's digests
 * out of the send window; the digest still lists every one of them.
 */
export const TASK_EMAILS_PER_DAY = 10;

const PRIORITY_RANK: ReadonlyMap<string, number> = new Map([
  ["critical", 0],
  ["high", 1],
  ["medium", 2],
  ["low", 3],
]);

const priorityRank = (task: SnapshotTask) => PRIORITY_RANK.get(task.priority) ?? PRIORITY_RANK.size;
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Most urgent first; title and id make every tick pick the same tasks. */
const byUrgency = (a: TaskCandidate, b: TaskCandidate) =>
  priorityRank(a.task) - priorityRank(b.task) ||
  compareText(a.due, b.due) ||
  compareText(a.task.title, b.task.title) ||
  compareText(a.task.id, b.task.id);

/**
 * The most urgent TASK_EMAILS_PER_DAY of each person's reminders (and alerts) for the day, most
 * urgent first. Ranked across every organization before any window is applied, so a person in
 * two organizations whose windows open at different times still gets at most the cap in total.
 * This limits one planning pass; email_worker_enqueue enforces the same 10 across the day's ticks,
 * filling a person's remaining places in the order given here.
 */
function withinDailyCap(
  candidates: TaskCandidate[],
  onSkip: (skip: PlanningSkip) => void,
): TaskCandidate[] {
  const groups = groupBy(
    candidates,
    ({ row }) => `${row.recipientUserId} ${row.kind} ${String(row.payload.localDate)}`,
  );
  return [...groups.values()].flatMap((group) =>
    group.length <= TASK_EMAILS_PER_DAY
      ? urgentFirst(group)
      : isolated("person", `${group[0].row.recipientUserId} ${group[0].row.kind}`, onSkip, () =>
          [...group].sort(byUrgency).slice(0, TASK_EMAILS_PER_DAY),
        ),
  );
}

/**
 * Order only matters when earlier ticks already used some of the day's places, so an unreadable
 * record here costs nobody an email: the group keeps its snapshot order, and the digest planner,
 * which does read every field, reports the record.
 */
function urgentFirst(group: TaskCandidate[]): TaskCandidate[] {
  try {
    return [...group].sort(byUrgency);
  } catch {
    return group;
  }
}

type PersonKind = Exclude<ScheduledKind, TaskKind>;

// Links never decide whether a summary is empty, so the planner's content check needs no real origin.
const PLANNING_APP_URL = "https://planning.invalid";

const PERSON_KINDS: {
  kind: PersonKind;
  cadence: "daily" | "weekly";
  content: (args: DigestArgs) => unknown;
}[] = [
  { kind: "daily_digest", cadence: "daily", content: dailyDigestContent },
  { kind: "weekly_digest", cadence: "weekly", content: weeklyDigestContent },
  { kind: "daily_management", cadence: "daily", content: dailyManagementContent },
  { kind: "weekly_management", cadence: "weekly", content: weeklyManagementContent },
];

function planPersonEmails(
  index: SnapshotIndex,
  clocks: ReadonlyMap<string, OrgClock>,
  userId: string,
  now: Date,
  onSkip: (skip: PlanningSkip) => void,
): OutboxInsert[] {
  const primaryId = index.primaryOrgByUser.get(userId);
  const clock = primaryId ? clocks.get(primaryId) : undefined;
  if (!clock?.inWindow || !isEligiblePerson(index.personById.get(userId))) return [];
  const args: DigestArgs = { index, userId, now, appUrl: PLANNING_APP_URL };
  return PERSON_KINDS.filter(({ cadence }) =>
    cadence === "daily" ? clock.workingDay : clock.weeklyDay,
  ).flatMap(({ kind, content }) =>
    // Per kind, so a broken management summary still lets the person's own digest through.
    isolated("person", `${userId} ${kind}`, onSkip, () =>
      preferenceOn(index, userId, kind) && content(args) !== null
        ? [
            outboxRow({
              kind,
              dedupeKey: `${kind}:${userId}:${clock.today}`,
              recipientUserId: userId,
              clock,
              now,
            }),
          ]
        : [],
    ),
  );
}

/**
 * Every scheduled email due at `now`. Pure and idempotent: dedupe keys depend only on ids and
 * local dates, so re-planning on every tick of the window inserts nothing new.
 *
 * Per-person timing follows the primary organization even when that organization has switched
 * email off: its calendar still decides when the person's day starts, and the content filter
 * already leaves the disabled organization's tasks out.
 *
 * An organization, task or person that throws is skipped and reported through `onSkip`.
 */
export function planScheduledEmails(
  snapshot: EmailSnapshot,
  now: Date,
  onSkip: (skip: PlanningSkip) => void = () => {},
): OutboxInsert[] {
  const index = indexSnapshot(snapshot);
  const clocks = new Map(
    snapshot.organizations.flatMap((org) =>
      isolated("organization", org.id, onSkip, () => [[org.id, orgClock(org, now)] as const]),
    ),
  );
  const candidates = snapshot.tasks.flatMap((task) =>
    isolated("task", task.id, onSkip, () => {
      const candidate = taskCandidate(index, clocks, task, now);
      return candidate ? [candidate] : [];
    }),
  );
  const taskRows = withinDailyCap(candidates, onSkip)
    .filter((candidate) => candidate.inWindow)
    .map((candidate) => candidate.row);
  const personRows = snapshot.people.flatMap((person) =>
    isolated("person", person.userId, onSkip, () =>
      planPersonEmails(index, clocks, person.userId, now, onSkip),
    ),
  );
  return [...taskRows, ...personRows];
}
