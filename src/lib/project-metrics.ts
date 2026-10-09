/**
 * The single definition of a project's progress and health.
 *
 * QA FD-014 found three screens giving three answers for the same project —
 * Orbit Web read 62% on its card, 33% in its detail view and 43% on the
 * Dashboard — because each computed it its own way, one of them from mock data.
 * FD-056 found finished projects labelled "On track". Every screen now calls
 * these two functions, so they cannot disagree.
 */

export type ProjectHealth = "completed" | "on-track" | "at-risk" | "delayed" | "no-tasks";

export interface ProgressInput {
  status: string;
}

export interface ProjectProgress {
  /** Tasks that count: everything except cancelled. */
  total: number;
  done: number;
  open: number;
  /** 0–100, rounded. 0 when there are no tasks. */
  percent: number;
}

/**
 * Cancelled work is neither done nor outstanding, so it is left out of both. Counts what it is
 * given: pass workUnits(tasks), so a group task counts once and not once per person.
 */
export function projectProgress(tasks: ProgressInput[]): ProjectProgress {
  const counted = tasks.filter((t) => t.status !== "cancelled");
  const done = counted.filter((t) => t.status === "done").length;
  return {
    total: counted.length,
    done,
    open: counted.length - done,
    percent: counted.length ? Math.round((done / counted.length) * 100) : 0,
  };
}

/**
 * One unit of a project's work as project_task_units returns it (a group task once), with no
 * title or people: progress and lateness for the whole project, whoever looks.
 */
export interface ProjectUnit {
  project_id: string;
  status: string;
  due_date: string | null;
  due_at: string | null;
}

/** Still open and due before `today` (YYYY-MM-DD in the project's organization timezone). */
export function unitIsOverdue(
  unit: Pick<ProjectUnit, "status" | "due_date" | "due_at">,
  today: string,
): boolean {
  if (unit.status === "done" || unit.status === "cancelled") return false;
  const due = unit.due_date ?? unit.due_at?.slice(0, 10);
  return Boolean(due && due < today);
}

export interface HealthInput {
  progress: ProjectProgress;
  /** yyyy-mm-dd, or empty when the project has no deadline. */
  dueDate?: string | null;
  /** yyyy-mm-dd "today" in the organization's timezone. */
  today: string;
  /** Lifecycle status from the database, e.g. "completed" or "archived". */
  lifecycle?: string | null;
  /** Open tasks past their own due date. */
  overdueTasks?: number;
}

/**
 * Health, in priority order:
 *   completed — the project is marked completed, or every task is done
 *   no-tasks  — nothing to measure yet
 *   delayed   — past the deadline with work left, or has overdue tasks
 *   at-risk   — deadline within 14 days and under half done
 *   on-track  — everything else
 */
export function projectHealth({ progress, dueDate, today, lifecycle, overdueTasks = 0 }: HealthInput): ProjectHealth {
  if (lifecycle === "completed" || (progress.total > 0 && progress.open === 0)) return "completed";
  if (progress.total === 0) return "no-tasks";
  const due = dueDate ? dueDate.slice(0, 10) : "";
  if ((due && due < today) || overdueTasks > 0) return "delayed";
  if (due) {
    const daysLeft = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (daysLeft <= 14 && progress.percent < 50) return "at-risk";
  }
  return "on-track";
}

export const healthLabel: Record<ProjectHealth, string> = {
  completed: "Completed",
  "on-track": "On track",
  "at-risk": "At risk",
  delayed: "Delayed",
  "no-tasks": "No tasks yet",
};

/**
 * A task as any screen holds it: a database row (parent_task_id) or the app's and the email
 * snapshot's camelCase (parentTaskId). A group task (a task for several people) is a parent with
 * no assignee plus one child per person, each pointing at the parent.
 */
export interface GroupLink {
  id: string;
  parent_task_id?: string | null;
  parentTaskId?: string | null;
}

export const parentTaskIdOf = (task: GroupLink): string | null =>
  task.parent_task_id ?? task.parentTaskId ?? null;

/** The group parents among `tasks`: the ones another task in the list points at. */
export function groupParentIds(tasks: readonly GroupLink[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    const parentId = parentTaskIdOf(task);
    if (parentId) ids.add(parentId);
  }
  return ids;
}

/**
 * The units of work among `tasks`, for project progress and task totals: a group counts once, as
 * its parent, and its children are skipped. A child whose parent is not in the list still counts
 * (row-level security can show a manager their report's part without the group, and the boards
 * then show that part as a card of its own). Order is kept.
 */
export function workUnits<T extends GroupLink>(tasks: readonly T[]): T[] {
  const ids = new Set(tasks.map((task) => task.id));
  return tasks.filter((task) => {
    const parentId = parentTaskIdOf(task);
    return !parentId || !ids.has(parentId);
  });
}

/**
 * Person-level work (my tasks, workload, overdue per person): every task but the group parents,
 * which belong to no one. Each person's part of a group is their own child. Order is kept.
 */
export function personalWork<T extends GroupLink>(tasks: readonly T[]): T[] {
  const parents = groupParentIds(tasks);
  return tasks.filter((task) => !parents.has(task.id));
}
