import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";
import { projectHealth, projectProgress, type ProjectHealth } from "@/lib/project-metrics";
import { todayIn } from "@/lib/today";

const inputSchema = z.object({
  organizationId: z.string().uuid().nullable(),
  scope: z.enum(["mine", "team"]),
  period: z.enum(["week", "month", "quarter", "custom"]),
  customStart: z.string().nullable(),
  customEnd: z.string().nullable(),
});

export type DashboardTask = {
  id: string; organization_id: string; project_id: string | null; title: string; description: string | null;
  status: "todo" | "progress" | "review" | "done" | "cancelled"; priority: "low" | "medium" | "high" | "critical";
  assignee_id: string | null; reviewer_id: string | null; created_by: string; due_at: string | null; due_date: string | null;
  blocked: boolean; blocked_reason: string | null; progress: number; estimated_hours: number | null; tags: string[];
  created_at: string; completed_at: string | null; updated_at: string; projectName: string;
};
export type DashboardProject = { id: string; organization_id: string; name: string; status: string; start_date: string | null; due_date: string | null; taskCount: number; complete: number; progress: number; overdue: number; blocked: number; health: ProjectHealth };
export type DashboardMilestone = { id: string; organization_id: string; project_id: string; title: string; due_at: string | null; due_date: string | null; completed_at: string | null; projectName: string };
export type DashboardActivity = { id: string; organization_id: string; event_type: Database["public"]["Enums"]["activity_event_type"]; actor_id: string; task_id: string | null; project_id: string | null; milestone_id: string | null; details: Json; occurred_at: string; taskTitle: string | null; projectName: string | null; actorName: string };
export type DashboardWorkload = { userId: string; name: string; open: number; overdue: number; blocked: number; estimatedHours: number };
export type DashboardOrganization = { id: string; name: string; code: string; timezone: string; isPrimary: boolean };
export type DashboardPayload = {
  userId: string; profileName: string; organizations: DashboardOrganization[];
  organizationId: string | null; scope: "mine" | "team"; canViewTeam: boolean; range: { start: string; end: string };
  tasks: DashboardTask[]; projects: DashboardProject[]; milestones: DashboardMilestone[]; activity: DashboardActivity[]; workload: DashboardWorkload[];
};

type TaskRow = Omit<DashboardTask, "projectName"> & { work_projects: { name: string } | null };

/**
 * The timezone the dashboard reads "today" in: the selected organization's, else
 * the primary one's. Shared by the server (period range) and the page (due today,
 * overdue, trend buckets) so both count the same calendar day.
 */
export function dashboardTimezone(organizations: DashboardOrganization[], organizationId: string | null): string | undefined {
  return (
    organizations.find((organization) => organization.id === organizationId)?.timezone ??
    organizations.find((organization) => organization.isPrimary)?.timezone ??
    organizations[0]?.timezone
  );
}

/** A task's due day (yyyy-mm-dd): the date column, else the date part of the timestamp. */
export function taskDueDate(task: Pick<DashboardTask, "due_date" | "due_at">): string | null {
  return task.due_date || task.due_at?.slice(0, 10) || null;
}

const isOpen = (task: Pick<DashboardTask, "status">) => task.status !== "done" && task.status !== "cancelled";

/** Worst first, so the six rows the dashboard has room for are the ones that need a look. */
const healthOrder: Record<ProjectHealth, number> = { delayed: 0, "at-risk": 1, "on-track": 2, "no-tasks": 3, completed: 4 };

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => loadDashboard(data, context));

async function loadDashboard(
  input: z.infer<typeof inputSchema>,
  context: { supabase: SupabaseClient<Database>; userId: string },
): Promise<DashboardPayload> {
  const { supabase, userId } = context;
  const [{ data: memberships, error: membershipError }, { data: roles, error: roleError }] =
    await Promise.all([
      supabase
        .from("organization_memberships")
        .select("organization_id, is_primary, organizations(id, name, code, timezone)")
        .eq("user_id", userId)
        .eq("status", "active"),
      supabase.from("user_roles").select("organization_id, role").eq("user_id", userId),
    ]);
  if (membershipError) throw membershipError;
  if (roleError) throw roleError;

  const organizations: DashboardOrganization[] = (memberships ?? []).map((membership) => ({
    id: membership.organization_id,
    name: membership.organizations?.name ?? "Organization",
    code: membership.organizations?.code ?? "ORG",
    timezone: membership.organizations?.timezone ?? "UTC",
    isPrimary: Boolean(membership.is_primary),
  }));
  const allowedIds = new Set(organizations.map((organization) => organization.id));
  const organizationId = input.organizationId && allowedIds.has(input.organizationId)
    ? input.organizationId
    : null;
  const managementOrgIds = new Set(
    (roles ?? [])
      .filter((role) => ["admin", "manager", "team_lead"].includes(role.role))
      .map((role) => role.organization_id),
  );
  const canViewTeam = organizationId
    ? managementOrgIds.has(organizationId)
    : organizations.length > 0 && organizations.every((organization) => managementOrgIds.has(organization.id));
  const scope = input.scope === "team" && canViewTeam ? "team" : "mine";

  // Every task the user can see; row-level security decides which. "My Overview"
  // narrows this to their own work in memory below instead of in the query: the
  // query used to filter on assignee_id, so Project Health was computed from the
  // user's own tasks only and a project read "0 of 1 tasks completed" while its
  // real figure was 3 of 7 (FD-014).
  let tasksQuery = supabase
    .from("work_tasks")
    .select("id, organization_id, project_id, title, description, status, priority, assignee_id, reviewer_id, created_by, due_at, due_date, blocked, blocked_reason, progress, estimated_hours, tags, created_at, completed_at, updated_at, work_projects(name)")
    .is("archived_at", null);
  // Cancelled and archived projects have no health to report.
  let projectsQuery = supabase
    .from("work_projects")
    .select("id, organization_id, name, status, start_date, due_date")
    .is("archived_at", null)
    .not("status", "in", "(cancelled,archived)");
  let milestonesQuery = supabase
    .from("project_milestones")
    .select("id, organization_id, project_id, title, due_at, due_date, completed_at, work_projects(name)")
    .is("completed_at", null);
  let activityQuery = supabase
    .from("work_activity")
    .select("id, organization_id, event_type, actor_id, task_id, project_id, milestone_id, details, occurred_at, work_tasks(title), work_projects(name)")
    .order("occurred_at", { ascending: false })
    .limit(30);
  if (organizationId) {
    tasksQuery = tasksQuery.eq("organization_id", organizationId);
    projectsQuery = projectsQuery.eq("organization_id", organizationId);
    milestonesQuery = milestonesQuery.eq("organization_id", organizationId);
    activityQuery = activityQuery.eq("organization_id", organizationId);
  }

  // Everyone's names are loaded alongside the rest rather than in a third round
  // trip after the tasks arrive — part of why the dashboard took 2-3 s (FD-042).
  const [tasksResult, projectsResult, milestonesResult, activityResult, peopleResult] = await Promise.all([
    tasksQuery,
    projectsQuery,
    milestonesQuery,
    activityQuery,
    supabase.from("profiles").select("user_id, full_name, username"),
  ]);
  for (const result of [tasksResult, projectsResult, milestonesResult, activityResult, peopleResult]) {
    if (result.error) throw result.error;
  }

  // Same fallback as the task lists, so a person reads the same everywhere (FD-021).
  const names = new Map((peopleResult.data ?? []).flatMap((person) => {
    const name = person.full_name?.trim() || person.username?.trim();
    return name ? [[person.user_id, name] as const] : [];
  }));
  const nameOf = (id: string) => names.get(id) ?? "Unknown";

  // "Today" per organization, not UTC's (see src/lib/today.ts).
  const todayByOrg = new Map(organizations.map((organization) => [organization.id, todayIn(organization.timezone)]));
  const todayFor = (orgId: string) => todayByOrg.get(orgId) ?? todayIn();
  const isOverdue = (task: DashboardTask) => {
    const due = taskDueDate(task);
    return isOpen(task) && Boolean(due && due < todayFor(task.organization_id));
  };

  const visibleTasks: DashboardTask[] = ((tasksResult.data ?? []) as unknown as TaskRow[]).map(({ work_projects, ...task }) => ({
    ...task,
    projectName: work_projects?.name ?? "No project",
  }));
  const tasks = scope === "mine" ? visibleTasks.filter((task) => task.assignee_id === userId) : visibleTasks;

  // projectProgress/projectHealth are the only progress and health rules, so the
  // Projects screen and this widget cannot disagree (FD-014), and a project with
  // every task done reads "Completed", not "On track" (FD-056).
  const projects: DashboardProject[] = (projectsResult.data ?? [])
    .map((project) => {
      const projectTasks = visibleTasks.filter((task) => task.project_id === project.id);
      const progress = projectProgress(projectTasks);
      const overdue = projectTasks.filter(isOverdue).length;
      const health = projectHealth({
        progress,
        dueDate: project.due_date,
        today: todayFor(project.organization_id),
        lifecycle: project.status,
        overdueTasks: overdue,
      });
      return {
        ...project,
        taskCount: progress.total,
        complete: progress.done,
        progress: progress.percent,
        overdue,
        blocked: projectTasks.filter((task) => isOpen(task) && task.blocked).length,
        health,
      };
    })
    .sort((a, b) => healthOrder[a.health] - healthOrder[b.health] || a.name.localeCompare(b.name));

  const organizationToday = todayIn(dashboardTimezone(organizations, organizationId));
  const range = periodRange(input.period, input.customStart, input.customEnd, organizationToday);
  return {
    userId,
    profileName: names.get(userId) ?? "there",
    organizations,
    organizationId,
    scope,
    canViewTeam,
    range,
    tasks,
    projects,
    milestones: (milestonesResult.data ?? []).map(({ work_projects, ...milestone }) => ({
      ...milestone,
      projectName: work_projects?.name ?? "Project",
    })),
    activity: (activityResult.data ?? []).map(({ work_tasks, work_projects, ...item }) => ({
      ...item,
      taskTitle: work_tasks?.title ?? null,
      projectName: work_projects?.name ?? null,
      actorName: nameOf(item.actor_id),
    })),
    workload: [...new Set(tasks.map((task) => task.assignee_id).filter((id): id is string => Boolean(id)))].map((assigneeId) => {
      const assigned = tasks.filter((task) => task.assignee_id === assigneeId && isOpen(task));
      return {
        userId: assigneeId,
        name: nameOf(assigneeId),
        open: assigned.length,
        overdue: assigned.filter(isOverdue).length,
        blocked: assigned.filter((task) => task.blocked).length,
        estimatedHours: assigned.reduce((sum, task) => sum + Number(task.estimated_hours ?? 0), 0),
      };
    }).sort((a, b) => b.open - a.open),
  };
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * The reporting period, ending on the organization's today. Was built from the
 * server clock's local date, which is not the organization's calendar day.
 */
function periodRange(period: "week" | "month" | "quarter" | "custom", customStart: string | null, customEnd: string | null, today: string) {
  if (period === "custom" && customStart && customEnd) return { start: customStart, end: customEnd };
  const [year, month, day] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  if (period === "week") start.setUTCDate(day - ((start.getUTCDay() + 6) % 7));
  if (period === "month") start.setUTCDate(1);
  if (period === "quarter") start.setUTCMonth(Math.floor((month - 1) / 3) * 3, 1);
  return { start: isoDate(start), end: today };
}
