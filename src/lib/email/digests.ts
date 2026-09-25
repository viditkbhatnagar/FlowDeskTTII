import {
  healthLabel,
  projectHealth,
  projectProgress,
  type ProjectHealth,
  type ProjectProgress,
} from "../project-metrics";
import {
  appUrls,
  colleagueName,
  contentOrgs,
  firstNameOf,
  isOpenTask,
  orgToday,
  plural,
  projectNameOf,
  statusLabel,
  type SnapshotIndex,
} from "./lookup";
import type {
  DailyDigestInput,
  DailyManagementInput,
  DetailItem,
  DigestTask,
  LabelledBadge,
  ManagementBadge,
  ManagementTask,
  SummarySection,
  WeeklyDigestInput,
  WeeklyManagementInput,
} from "./render";
import type { SnapshotOrganization, SnapshotProjectCount, SnapshotTask } from "./snapshot";
import {
  addDays,
  effectiveDue,
  formatDate,
  formatDateRange,
  localDay,
  prevWorkingDay,
  startOfLocalDay,
  toYmd,
} from "./time";

// What goes into the four scheduled summaries. Each builder returns null when the
// email would have nothing in it, which is how the planner and the composer both
// decide not to send one.

/** Rows passed per group; the templates show five and link to the rest. */
export const GROUP_LIMIT = 8;
const UPCOMING_DAYS = 7;
const PERIOD_DAYS = 7;

export type DigestArgs = { index: SnapshotIndex; userId: string; now: Date; appUrl: string };

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

type OrgDay = {
  org: SnapshotOrganization;
  today: string;
  due: (task: SnapshotTask) => string | null;
  completedDay: (task: SnapshotTask) => string | null;
};

function orgDay(org: SnapshotOrganization, now: Date): OrgDay {
  return {
    org,
    today: orgToday(org, now),
    due: (task) => effectiveDue(task, org.timezone),
    completedDay: (task) => localDay(new Date(task.completedAt ?? Number.NaN), org.timezone),
  };
}

function completedBetween(task: SnapshotTask, fromMs: number, toMs = Infinity): boolean {
  if (task.status !== "done" || !task.completedAt) return false;
  const at = Date.parse(task.completedAt);
  return at >= fromMs && at < toMs;
}

const isOverdue = (day: OrgDay, task: SnapshotTask) => {
  const due = day.due(task);
  return isOpenTask(task) && due !== null && due < day.today;
};

const dueWithin = (day: OrgDay, task: SnapshotTask, from: string, to: string) => {
  const due = day.due(task);
  return due !== null && due >= from && due <= to;
};

function byDue(day: OrgDay) {
  return (a: SnapshotTask, b: SnapshotTask) => {
    const dueA = day.due(a) ?? "9999-99-99";
    const dueB = day.due(b) ?? "9999-99-99";
    return (
      dueA.localeCompare(dueB) ||
      (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
      a.title.localeCompare(b.title)
    );
  };
}

const byCompletedDesc = (a: SnapshotTask, b: SnapshotTask) =>
  (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || a.title.localeCompare(b.title);

function dueLabel(day: OrgDay, task: SnapshotTask): string {
  const due = day.due(task);
  if (!due) return "No deadline";
  return due === day.today ? "Due today" : `Due ${formatDate(due)}`;
}

function completedLabel(day: OrgDay, task: SnapshotTask): string {
  const completed = day.completedDay(task);
  return completed ? `Completed ${formatDate(completed)}` : "Completed";
}

function recipientOf(index: SnapshotIndex, userId: string, now: Date) {
  const person = index.personById.get(userId);
  const primaryId = index.primaryOrgByUser.get(userId);
  const primary = primaryId ? index.orgById.get(primaryId) : undefined;
  if (!person || !primary) return null;
  return { firstName: firstNameOf(person), today: orgToday(primary, now) };
}

const nonEmpty = <G extends { tasks?: unknown[]; items?: unknown[] }>(groups: G[]) =>
  groups.filter((group) => (group.tasks ?? group.items ?? []).length > 0);

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function personalRow(args: DigestArgs, task: SnapshotTask, dateLabel: string): DigestTask {
  const projectName = projectNameOf(args.index, task.projectId);
  return {
    title: task.title,
    url: appUrls(args.appUrl).myTask(task.id),
    ...(projectName ? { projectName } : {}),
    dateLabel,
  };
}

// ── Personal: daily ────────────────────────────────────────────────────────

function dailyBuckets(args: DigestArgs, org: SnapshotOrganization) {
  const day = orgDay(org, args.now);
  const tasks = (args.index.tasksByAssignee.get(args.userId) ?? []).filter(
    (task) => task.organizationId === org.id,
  );
  const open = tasks.filter(isOpenTask);
  const since = startOfLocalDay(prevWorkingDay(day.today, org.settings.workingDays), org.timezone);
  return {
    day,
    overdue: open.filter((task) => isOverdue(day, task)).sort(byDue(day)),
    dueToday: open.filter((task) => day.due(task) === day.today).sort(byDue(day)),
    upcoming: open
      .filter((task) =>
        dueWithin(day, task, addDays(day.today, 1), addDays(day.today, UPCOMING_DAYS)),
      )
      .sort(byDue(day)),
    completed: tasks
      .filter((task) => completedBetween(task, since.getTime()))
      .sort(byCompletedDesc),
  };
}

export function dailyDigestContent(args: DigestArgs): DailyDigestInput | null {
  const recipient = recipientOf(args.index, args.userId, args.now);
  if (!recipient) return null;
  const urls = appUrls(args.appUrl);
  const buckets = contentOrgs(args.index, args.userId, "daily_digest", false).map((org) =>
    dailyBuckets(args, org),
  );
  const total = (pick: (b: (typeof buckets)[number]) => SnapshotTask[]) =>
    sum(buckets.map((b) => pick(b).length));
  const rows = (
    b: (typeof buckets)[number],
    tasks: SnapshotTask[],
    label: (t: SnapshotTask) => string,
  ) => tasks.slice(0, GROUP_LIMIT).map((task) => personalRow(args, task, label(task)));
  const organizations = buckets
    .map((b) => ({
      name: b.day.org.name,
      groups: nonEmpty([
        {
          label: "Overdue" as const,
          tasks: rows(b, b.overdue, (t) => dueLabel(b.day, t)),
          viewAllUrl: urls.myTasks,
        },
        {
          label: "Due Today" as const,
          tasks: rows(b, b.dueToday, (t) => dueLabel(b.day, t)),
          viewAllUrl: urls.myTasks,
        },
        {
          label: "Upcoming" as const,
          tasks: rows(b, b.upcoming, (t) => dueLabel(b.day, t)),
          viewAllUrl: urls.myTasks,
        },
        {
          label: "Recently Completed" as const,
          tasks: rows(b, b.completed, (t) => completedLabel(b.day, t)),
          viewAllUrl: urls.myTasks,
        },
      ]),
    }))
    .filter((org) => org.groups.length > 0);
  if (organizations.length === 0) return null;
  return {
    firstName: recipient.firstName,
    date: formatDate(recipient.today),
    overdueCount: String(total((b) => b.overdue)),
    dueTodayCount: String(total((b) => b.dueToday)),
    upcomingCount: String(total((b) => b.upcoming)),
    completedCount: String(total((b) => b.completed)),
    myTasksUrl: urls.myTasks,
    organizations,
  };
}

// ── Personal: weekly ───────────────────────────────────────────────────────

/** The seven days before today, as local-midnight instants [from, to). */
function periodOf(day: OrgDay) {
  const start = addDays(day.today, -PERIOD_DAYS);
  return {
    start,
    end: addDays(day.today, -1),
    fromMs: startOfLocalDay(start, day.org.timezone).getTime(),
    toMs: startOfLocalDay(day.today, day.org.timezone).getTime(),
  };
}

function weeklyBuckets(args: DigestArgs, org: SnapshotOrganization) {
  const day = orgDay(org, args.now);
  const period = periodOf(day);
  const tasks = (args.index.tasksByAssignee.get(args.userId) ?? []).filter(
    (task) => task.organizationId === org.id,
  );
  const open = tasks.filter(isOpenTask).sort(byDue(day));
  const nextWeekEnd = addDays(day.today, PERIOD_DAYS - 1);
  const overdue = open.filter((task) => isOverdue(day, task));
  const nextWeek = open.filter((task) => dueWithin(day, task, day.today, nextWeekEnd));
  return {
    day,
    open,
    completed: tasks
      .filter((task) => completedBetween(task, period.fromMs, period.toMs))
      .sort(byCompletedDesc),
    overdue,
    nextWeek,
    other: open.filter((task) => !overdue.includes(task) && !nextWeek.includes(task)),
  };
}

export function weeklyDigestContent(args: DigestArgs): WeeklyDigestInput | null {
  const recipient = recipientOf(args.index, args.userId, args.now);
  if (!recipient) return null;
  const urls = appUrls(args.appUrl);
  const buckets = contentOrgs(args.index, args.userId, "weekly_digest", false).map((org) =>
    weeklyBuckets(args, org),
  );
  const total = (pick: (b: (typeof buckets)[number]) => SnapshotTask[]) =>
    sum(buckets.map((b) => pick(b).length));
  const rows = (tasks: SnapshotTask[], label: (t: SnapshotTask) => string) =>
    tasks.slice(0, GROUP_LIMIT).map((task) => personalRow(args, task, label(task)));
  const organizations = buckets
    .map((b) => ({
      name: b.day.org.name,
      groups: nonEmpty([
        {
          label: "Completed" as const,
          tasks: rows(b.completed, (t) => completedLabel(b.day, t)),
          viewAllUrl: urls.myTasks,
        },
        {
          label: "Overdue" as const,
          tasks: rows(b.overdue, (t) => dueLabel(b.day, t)),
          viewAllUrl: urls.myTasks,
        },
        {
          label: "Due Next Week" as const,
          tasks: rows(b.nextWeek, (t) => dueLabel(b.day, t)),
          viewAllUrl: urls.myTasks,
        },
        {
          label: "Other Open Tasks" as const,
          tasks: rows(b.other, (t) => dueLabel(b.day, t)),
          viewAllUrl: urls.myTasks,
        },
      ]),
    }))
    .filter((org) => org.groups.length > 0);
  if (organizations.length === 0) return null;
  return {
    firstName: recipient.firstName,
    dateRange: formatDateRange(
      addDays(recipient.today, -PERIOD_DAYS),
      addDays(recipient.today, -1),
    ),
    completedCount: String(total((b) => b.completed)),
    openCount: String(total((b) => b.open)),
    overdueCount: String(total((b) => b.overdue)),
    nextWeekCount: String(total((b) => b.nextWeek)),
    myTasksUrl: urls.myTasks,
    organizations,
  };
}

// ── Management: daily ──────────────────────────────────────────────────────

type AttentionFlag = "Overdue" | "Blocked" | "Unassigned" | "Review";
const ATTENTION_ORDER: AttentionFlag[] = ["Overdue", "Blocked", "Unassigned", "Review"];

function attentionFlags(day: OrgDay, task: SnapshotTask): AttentionFlag[] {
  if (!isOpenTask(task)) return [];
  const flags: Record<AttentionFlag, boolean> = {
    Overdue: isOverdue(day, task),
    Blocked: task.blocked,
    Unassigned: !task.assigneeId,
    Review: task.status === "review",
  };
  return ATTENTION_ORDER.filter((flag) => flags[flag]);
}

function priorityBadges(task: SnapshotTask): ManagementBadge[] {
  if (task.priority === "critical") return ["Critical"];
  return task.priority === "high" ? ["High"] : [];
}

type Badge = ManagementBadge | LabelledBadge;

/** Review reads as the organization's own name for it, as everywhere in the app (FD-018). */
const attentionBadges = (day: OrgDay, task: SnapshotTask, reviewLabel: string): Badge[] =>
  attentionFlags(day, task).map((flag) =>
    flag === "Review" ? { tone: "Review", label: reviewLabel } : flag,
  );

/** Names the "awaiting review" tile when every organization in the email agrees on one name. */
function sharedReviewLabel(buckets: { reviewLabel: string }[]): { reviewLabel?: string } {
  const labels = [...new Set(buckets.map((b) => b.reviewLabel))];
  return labels.length === 1 ? { reviewLabel: labels[0] } : {};
}

function managementRow(
  args: DigestArgs,
  task: SnapshotTask,
  dateLabel: string,
  badges: Badge[],
): ManagementTask {
  const projectName = projectNameOf(args.index, task.projectId);
  return {
    title: task.title,
    url: appUrls(args.appUrl).teamTask(task.id),
    ...(task.assigneeId
      ? { assignee: colleagueName(args.index, args.userId, task.assigneeId) }
      : {}),
    ...(projectName ? { projectName } : {}),
    dateLabel,
    ...(badges.length ? { badges } : {}),
  };
}

function dailyManagementBuckets(args: DigestArgs, org: SnapshotOrganization) {
  const day = orgDay(org, args.now);
  const tasks = args.index.tasksByOrg.get(org.id) ?? [];
  const open = tasks.filter(isOpenTask);
  const since = startOfLocalDay(prevWorkingDay(day.today, org.settings.workingDays), org.timezone);
  const rank = (task: SnapshotTask) => ATTENTION_ORDER.indexOf(attentionFlags(day, task)[0]);
  const attention = open
    .filter((task) => attentionFlags(day, task).length > 0)
    .sort((a, b) => rank(a) - rank(b) || byDue(day)(a, b));
  return {
    day,
    reviewLabel: statusLabel(args.index, org.id, "review"),
    open,
    attention,
    // A task already under Needs Attention is not listed twice.
    dueTodayOnly: open
      .filter((task) => day.due(task) === day.today && !attention.includes(task))
      .sort(byDue(day)),
    dueToday: open.filter((task) => day.due(task) === day.today),
    overdue: open.filter((task) => isOverdue(day, task)),
    blocked: open.filter((task) => task.blocked),
    review: open.filter((task) => task.status === "review"),
    unassigned: open.filter((task) => !task.assigneeId),
    completed: tasks
      .filter((task) => completedBetween(task, since.getTime()))
      .sort(byCompletedDesc),
  };
}

export function dailyManagementContent(args: DigestArgs): DailyManagementInput | null {
  const recipient = recipientOf(args.index, args.userId, args.now);
  if (!recipient) return null;
  const urls = appUrls(args.appUrl);
  const buckets = contentOrgs(args.index, args.userId, "daily_management", true).map((org) =>
    dailyManagementBuckets(args, org),
  );
  const total = (pick: (b: (typeof buckets)[number]) => SnapshotTask[]) =>
    sum(buckets.map((b) => pick(b).length));
  const organizations = buckets
    .map((b) => {
      const row = (task: SnapshotTask, label: string, badges: Badge[]) =>
        managementRow(args, task, label, badges);
      return {
        name: b.day.org.name,
        summary: [
          plural(b.open.length, "open task", "open tasks"),
          plural(b.attention.length, "needs attention", "need attention"),
          `${b.completed.length} completed`,
        ].join(" · "),
        groups: nonEmpty([
          {
            label: "Needs Attention" as const,
            tasks: b.attention
              .slice(0, GROUP_LIMIT)
              .map((t) =>
                row(t, dueLabel(b.day, t), [
                  ...priorityBadges(t),
                  ...attentionBadges(b.day, t, b.reviewLabel),
                ]),
              ),
            viewAllUrl: urls.team,
          },
          {
            label: "Due Today" as const,
            tasks: b.dueTodayOnly
              .slice(0, GROUP_LIMIT)
              .map((t) => row(t, "Due today", priorityBadges(t))),
            viewAllUrl: urls.team,
          },
          {
            label: "Recently Completed" as const,
            tasks: b.completed
              .slice(0, GROUP_LIMIT)
              .map((t) => row(t, completedLabel(b.day, t), [])),
            viewAllUrl: urls.team,
          },
        ]),
      };
    })
    .filter((org) => org.groups.length > 0);
  if (organizations.length === 0) return null;
  return {
    firstName: recipient.firstName,
    date: formatDate(recipient.today),
    completedCount: String(total((b) => b.completed)),
    dueTodayCount: String(total((b) => b.dueToday)),
    overdueCount: String(total((b) => b.overdue)),
    blockedCount: String(total((b) => b.blocked)),
    reviewCount: String(total((b) => b.review)),
    ...sharedReviewLabel(buckets),
    unassignedCount: String(total((b) => b.unassigned)),
    dashboardUrl: urls.dashboard,
    organizations,
  };
}

// ── Management: weekly ─────────────────────────────────────────────────────

const HEALTH_ORDER: Record<ProjectHealth, number> = {
  delayed: 0,
  "at-risk": 1,
  "on-track": 2,
  "no-tasks": 3,
  completed: 4,
};
const LISTED_HEALTH: ReadonlySet<ProjectHealth> = new Set(["delayed", "at-risk", "on-track"]);
const CLOSED_PROJECT_STATUSES: ReadonlySet<string> = new Set(["cancelled", "archived"]);

const wholeCount = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
const COUNTED_DONE = { status: "done" };
const COUNTED_OPEN = { status: "todo" };

/**
 * projectProgress over the SQL-side counts (the snapshot no longer carries old closed tasks), fed
 * as stand-in tasks so project-metrics.ts stays the only definition of a project's progress.
 */
function progressOf(count: SnapshotProjectCount | undefined): ProjectProgress {
  const total = wholeCount(count?.total);
  const done = Math.min(total, wholeCount(count?.done));
  return projectProgress([
    ...Array.from({ length: done }, () => COUNTED_DONE),
    ...Array.from({ length: total - done }, () => COUNTED_OPEN),
  ]);
}

function projectHealthRows(args: DigestArgs, day: OrgDay, tasks: SnapshotTask[]) {
  return args.index.snapshot.projects
    .filter((project) => project.organizationId === day.org.id)
    .filter((project) => !CLOSED_PROJECT_STATUSES.has(project.status))
    .map((project) => {
      const progress = progressOf(args.index.projectCountById.get(project.id));
      const dueDate = toYmd(project.dueDate);
      const health = projectHealth({
        progress,
        dueDate,
        today: day.today,
        lifecycle: project.status,
        // Every open task is in the snapshot, so this count is complete.
        overdueTasks: tasks.filter((task) => task.projectId === project.id && isOverdue(day, task))
          .length,
      });
      return { project, progress, health, dueDate };
    })
    .sort(
      (a, b) =>
        HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] ||
        a.project.name.localeCompare(b.project.name),
    );
}

function taskMeta(args: DigestArgs, task: SnapshotTask, dateLabel: string): string {
  const assignee = task.assigneeId
    ? colleagueName(args.index, args.userId, task.assigneeId)
    : "Unassigned";
  return [assignee, projectNameOf(args.index, task.projectId), dateLabel]
    .filter(Boolean)
    .join(" · ");
}

function workloadItems(args: DigestArgs, day: OrgDay, open: SnapshotTask[]): DetailItem[] {
  const byAssignee = new Map<string, SnapshotTask[]>();
  for (const task of open) {
    if (task.assigneeId)
      byAssignee.set(task.assigneeId, [...(byAssignee.get(task.assigneeId) ?? []), task]);
  }
  return [...byAssignee]
    .map(([userId, assigned]) => ({
      name: colleagueName(args.index, args.userId, userId),
      open: assigned.length,
      overdue: assigned.filter((task) => isOverdue(day, task)).length,
    }))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))
    .map((person) => ({
      title: person.name,
      meta: `${plural(person.open, "open task", "open tasks")} · ${person.overdue} overdue`,
    }));
}

function weeklyManagementBuckets(args: DigestArgs, org: SnapshotOrganization) {
  const day = orgDay(org, args.now);
  const period = periodOf(day);
  const tasks = args.index.tasksByOrg.get(org.id) ?? [];
  const open = tasks.filter(isOpenTask).sort(byDue(day));
  const projects = projectHealthRows(args, day, tasks);
  const attentionOf = (task: SnapshotTask) =>
    isOverdue(day, task)
      ? "Overdue"
      : task.blocked
        ? "Blocked"
        : task.status === "review"
          ? "Review"
          : null;
  return {
    day,
    reviewLabel: statusLabel(args.index, org.id, "review"),
    open,
    completed: tasks
      .filter((task) => completedBetween(task, period.fromMs, period.toMs))
      .sort(byCompletedDesc),
    attention: open.filter((task) => attentionOf(task) !== null),
    attentionOf,
    overdue: open.filter((task) => isOverdue(day, task)),
    blocked: open.filter((task) => task.blocked),
    review: open.filter((task) => task.status === "review"),
    nextWeek: open.filter((task) =>
      dueWithin(day, task, day.today, addDays(day.today, PERIOD_DAYS - 1)),
    ),
    projects: projects.filter((row) => LISTED_HEALTH.has(row.health)),
    attentionProjects: projects.filter(
      (row) => row.health === "delayed" || row.health === "at-risk",
    ),
  };
}

type WeeklyManagementBuckets = ReturnType<typeof weeklyManagementBuckets>;

function weeklyManagementSections(args: DigestArgs, b: WeeklyManagementBuckets): SummarySection[] {
  const urls = appUrls(args.appUrl);
  // Coloured as review, read as the organization's name for it.
  const badgeOf = (tone: string | null) =>
    tone === "Review" ? { badge: b.reviewLabel, badgeTone: tone } : tone ? { badge: tone } : {};
  const taskItem = (task: SnapshotTask, dateLabel: string, tone: string | null): DetailItem => ({
    title: task.title,
    url: urls.teamTask(task.id),
    meta: taskMeta(args, task, dateLabel),
    ...badgeOf(tone),
  });
  const limit = <T>(items: T[]) => items.slice(0, GROUP_LIMIT);
  return nonEmpty<SummarySection>([
    {
      label: "Progress",
      items: limit(b.completed).map((t) => taskItem(t, completedLabel(b.day, t), "Completed")),
      viewAllUrl: urls.team,
    },
    {
      label: "Needs Attention",
      items: limit(b.attention).map((t) => taskItem(t, dueLabel(b.day, t), b.attentionOf(t))),
      viewAllUrl: urls.team,
    },
    {
      label: "Team Workload",
      items: limit(workloadItems(args, b.day, b.open)),
      viewAllUrl: urls.team,
    },
    {
      label: "Project Health",
      items: limit(b.projects).map(({ project, progress, health, dueDate }) => ({
        title: project.name,
        url: urls.project(project.id),
        meta: `${progress.percent}% complete · ${dueDate ? `Deadline ${formatDate(dueDate)}` : "No deadline"}`,
        badge: healthLabel[health],
      })),
      viewAllUrl: `${args.appUrl}/projects`,
    },
    {
      label: "Next Week",
      items: limit(b.nextWeek).map((t) => taskItem(t, dueLabel(b.day, t), null)),
      viewAllUrl: urls.team,
    },
  ]);
}

export function weeklyManagementContent(args: DigestArgs): WeeklyManagementInput | null {
  const recipient = recipientOf(args.index, args.userId, args.now);
  if (!recipient) return null;
  const buckets = contentOrgs(args.index, args.userId, "weekly_management", true).map((org) =>
    weeklyManagementBuckets(args, org),
  );
  const total = (pick: (b: WeeklyManagementBuckets) => unknown[]) =>
    sum(buckets.map((b) => pick(b).length));
  const organizations = buckets
    .map((b) => ({
      name: b.day.org.name,
      summary: [
        plural(b.open.length, "open task", "open tasks"),
        plural(b.attentionProjects.length, "project needs attention", "projects need attention"),
        `${b.completed.length} completed`,
      ].join(" · "),
      sections: weeklyManagementSections(args, b),
    }))
    .filter((org) => org.sections.length > 0);
  if (organizations.length === 0) return null;
  return {
    firstName: recipient.firstName,
    dateRange: formatDateRange(
      addDays(recipient.today, -PERIOD_DAYS),
      addDays(recipient.today, -1),
    ),
    completedCount: String(total((b) => b.completed)),
    overdueCount: String(total((b) => b.overdue)),
    blockedCount: String(total((b) => b.blocked)),
    reviewCount: String(total((b) => b.review)),
    ...sharedReviewLabel(buckets),
    attentionProjectCount: String(total((b) => b.attentionProjects)),
    nextWeekCount: String(total((b) => b.nextWeek)),
    dashboardUrl: appUrls(args.appUrl).dashboard,
    organizations,
  };
}
