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

/** Cancelled work is neither done nor outstanding, so it is left out of both. */
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
