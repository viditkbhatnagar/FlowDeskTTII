import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json } from "@/integrations/supabase/types";

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
export type DashboardProject = { id: string; organization_id: string; name: string; status: string; start_date: string | null; due_date: string | null; taskCount: number; complete: number; progress: number; overdue: number; blocked: number; health: string };
export type DashboardMilestone = { id: string; organization_id: string; project_id: string; title: string; due_at: string | null; due_date: string | null; completed_at: string | null; projectName: string };
export type DashboardActivity = { id: string; organization_id: string; event_type: Database["public"]["Enums"]["activity_event_type"]; actor_id: string; task_id: string | null; project_id: string | null; milestone_id: string | null; details: Json; occurred_at: string; taskTitle: string | null; projectName: string | null; actorName: string };
export type DashboardWorkload = { userId: string; name: string; open: number; overdue: number; blocked: number; estimatedHours: number };
export type DashboardPayload = {
  userId: string; profileName: string; organizations: { id: string; name: string; code: string; timezone: string; isPrimary: boolean }[];
  organizationId: string | null; scope: "mine" | "team"; canViewTeam: boolean; range: { start: string; end: string };
  tasks: DashboardTask[]; projects: DashboardProject[]; milestones: DashboardMilestone[]; activity: DashboardActivity[]; workload: DashboardWorkload[];
};

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

  const organizations = (memberships ?? []).map((membership: any) => ({
    id: membership.organization_id as string,
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
      .filter((role: any) => ["admin", "manager", "team_lead"].includes(role.role))
      .map((role: any) => role.organization_id as string),
  );
  const canViewTeam = organizationId
    ? managementOrgIds.has(organizationId)
    : organizations.length > 0 && organizations.every((organization) => managementOrgIds.has(organization.id));
  const scope = input.scope === "team" && canViewTeam ? "team" : "mine";

  let tasksQuery = supabase
    .from("work_tasks")
    .select("id, organization_id, project_id, title, description, status, priority, assignee_id, reviewer_id, created_by, due_at, due_date, blocked, blocked_reason, progress, estimated_hours, tags, created_at, completed_at, updated_at, work_projects(name)")
    .is("archived_at", null);
  let projectsQuery = supabase
    .from("work_projects")
    .select("id, organization_id, name, status, start_date, due_date")
    .is("archived_at", null);
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
  if (scope === "mine") tasksQuery = tasksQuery.eq("assignee_id", userId);

  const [tasksResult, projectsResult, milestonesResult, activityResult, profileResult] = await Promise.all([
    tasksQuery,
    projectsQuery,
    milestonesQuery,
    activityQuery,
    supabase.from("profiles").select("full_name, username").eq("user_id", userId).maybeSingle(),
  ]);
  for (const result of [tasksResult, projectsResult, milestonesResult, activityResult]) {
    if (result.error) throw result.error;
  }

  const tasks = (tasksResult.data ?? []).map((task: any) => ({
    ...task,
    projectName: task.work_projects?.name ?? "No project",
  }));
  const peopleIds = [...new Set([
    userId,
    ...tasks.map((task: DashboardTask) => task.assignee_id).filter((id): id is string => Boolean(id)),
    ...(activityResult.data ?? []).map((item) => item.actor_id),
  ])];
  const { data: people, error: peopleError } = await supabase
    .from("profiles")
    .select("user_id, full_name, username")
    .in("user_id", peopleIds);
  if (peopleError) throw peopleError;
  const names = new Map((people ?? []).map((person) => [person.user_id, person.full_name || person.username || "Team member"]));
  const projectRows = projectsResult.data ?? [];
  const projects = projectRows.map((project: any) => {
    const projectTasks = tasks.filter((task: any) => task.project_id === project.id);
    const complete = projectTasks.filter((task: any) => task.status === "done").length;
    const progress = projectTasks.length ? Math.round((complete / projectTasks.length) * 100) : 0;
    const overdue = projectTasks.filter((task: any) => task.status !== "done" && task.due_date && task.due_date < isoDate(new Date())).length;
    const blocked = projectTasks.filter((task: any) => task.blocked).length;
    const health = overdue > 0 ? "Delayed" : blocked > 0 ? "At risk" : project.due_date ? "On track" : "No schedule";
    return { ...project, taskCount: projectTasks.length, complete, progress, overdue, blocked, health };
  });

  const range = periodRange(input.period, input.customStart, input.customEnd);
  return {
    userId,
    profileName: profileResult.data?.full_name || profileResult.data?.username || "there",
    organizations,
    organizationId,
    scope,
    canViewTeam,
    range,
    tasks,
    projects,
    milestones: (milestonesResult.data ?? []).map((milestone: any) => ({
      ...milestone,
      projectName: milestone.work_projects?.name ?? "Project",
    })),
    activity: (activityResult.data ?? []).map((item: any) => ({
      ...item,
      taskTitle: item.work_tasks?.title ?? null,
      projectName: item.work_projects?.name ?? null,
      actorName: names.get(item.actor_id) ?? "Team member",
    })),
    workload: [...new Set(tasks.map((task: DashboardTask) => task.assignee_id).filter((id): id is string => Boolean(id)))].map((assigneeId) => {
      const assigned = tasks.filter((task: DashboardTask) => task.assignee_id === assigneeId && !["done", "cancelled"].includes(task.status));
      return {
        userId: assigneeId,
        name: names.get(assigneeId) ?? "Team member",
        open: assigned.length,
        overdue: assigned.filter((task: DashboardTask) => Boolean(task.due_date && task.due_date < isoDate(new Date()))).length,
        blocked: assigned.filter((task: DashboardTask) => task.blocked).length,
        estimatedHours: assigned.reduce((sum: number, task: DashboardTask) => sum + Number(task.estimated_hours ?? 0), 0),
      };
    }).sort((a, b) => b.open - a.open),
  };
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function periodRange(period: "week" | "month" | "quarter" | "custom", customStart: string | null, customEnd: string | null) {
  const now = new Date();
  if (period === "custom" && customStart && customEnd) return { start: customStart, end: customEnd };
  const start = new Date(now);
  if (period === "week") start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  if (period === "month") start.setDate(1);
  if (period === "quarter") start.setMonth(Math.floor(now.getMonth() / 3) * 3, 1);
  return { start: isoDate(start), end: isoDate(now) };
}