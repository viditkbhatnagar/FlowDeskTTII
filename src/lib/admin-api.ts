/**
 * Supabase reads and writes for the admin surfaces — organizations, departments,
 * teams, people and roles.
 *
 * These screens used to render hardcoded arrays and throw every edit away on
 * refresh. This module is the persistence layer behind them. It maps between the
 * database rows and the domain types the screens already use, so the components
 * themselves did not have to change.
 *
 * Two conventions worth knowing:
 *
 *  - The UI models a department head and a team lead as a *name*, while the
 *    database stores a user id. `resolveUserId` / the `nameById` map translate,
 *    and an unmatched name is stored as NULL rather than guessed at.
 *
 *  - A role carries `base_role`, which is the privilege row-level security
 *    actually enforces. Everything else on a role (scope, permission keys) is
 *    presentation. Writing a role never changes what the database permits.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type {
  Department,
  Membership,
  OrgStatus,
  OrgUser,
  Organization,
  Role,
  Team,
} from "@/lib/organizations-data";
import { projectHealth, projectProgress, type ProjectHealth } from "@/lib/project-metrics";
import { personRef, type PersonRef } from "@/lib/task-api";
import { todayIn } from "@/lib/today";

/** app_role — the enum row-level security reads. Order matters: most to least privileged. */
export type BaseRole = "admin" | "manager" | "team_lead" | "employee" | "viewer";

export const BASE_ROLES: BaseRole[] = ["admin", "manager", "team_lead", "employee", "viewer"];

/** Update payloads, typed from the generated schema so a typo is a build error. */
type Upd<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];

/** Log and swallow: an admin screen should surface the failure, never crash the app. */
function fail(operation: string, error: unknown): null {
  console.error(`[flowdesk] ${operation} failed`, error);
  return null;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export interface AdminSnapshot {
  organizations: Organization[];
  departments: Department[];
  teams: Team[];
  users: OrgUser[];
  roles: Role[];
}

const mapOrganization = (row: Record<string, unknown>): Organization => ({
  id: row.id as string,
  name: row.name as string,
  code: row.code as string,
  logoUrl: (row.logo_url as string) ?? undefined,
  email: (row.official_email as string) ?? undefined,
  phone: (row.phone as string) ?? undefined,
  website: (row.website as string) ?? undefined,
  country: row.country as string,
  timezone: row.timezone as string,
  status: row.status as OrgStatus,
});

/**
 * Load everything the admin screens render, in one pass.
 *
 * RLS already limits each table to the caller's organizations, so there is no
 * organization filter here — asking for everything returns exactly what this
 * user is allowed to see.
 */
export async function loadAdminSnapshot(): Promise<AdminSnapshot | null> {
  const [orgs, depts, teamRows, profiles, memberships, userRoles, roleRows] = await Promise.all([
    supabase.from("organizations").select("*"),
    supabase.from("departments").select("*").order("name"),
    supabase.from("teams").select("*").order("name"),
    supabase.from("profiles").select("*"),
    supabase.from("organization_memberships").select("*"),
    supabase.from("user_roles").select("*"),
    supabase.from("roles").select("*").order("name"),
  ]);

  const firstError = [orgs, depts, teamRows, profiles, memberships, userRoles, roleRows].find((r) => r.error);
  if (firstError?.error) return fail("loadAdminSnapshot", firstError.error);

  const profileRows = profiles.data ?? [];
  const nameById = new Map<string, string>(
    profileRows.map((p) => [p.user_id as string, (p.full_name as string) || (p.username as string) || "Unknown"]),
  );
  const roleNameById = new Map<string, string>((roleRows.data ?? []).map((r) => [r.id as string, r.name as string]));
  const roleByBase = new Map<string, string>(
    (roleRows.data ?? []).filter((r) => r.is_system).map((r) => [r.base_role as string, r.name as string]),
  );

  const departments: Department[] = (depts.data ?? []).map((d) => ({
    id: d.id as string,
    orgId: d.organization_id as string,
    name: d.name as string,
    code: (d.code as string) ?? undefined,
    description: (d.description as string) ?? undefined,
    head: d.head_user_id ? (nameById.get(d.head_user_id as string) ?? "") : "",
    status: d.status as OrgStatus,
  }));

  const membershipRows = memberships.data ?? [];

  const teams: Team[] = (teamRows.data ?? []).map((t) => ({
    id: t.id as string,
    orgId: t.organization_id as string,
    departmentId: (t.department_id as string) ?? "",
    name: t.name as string,
    lead: t.lead_user_id ? nameById.get(t.lead_user_id as string) : undefined,
    // Team membership lives on organization_memberships.team_id — there is no
    // separate join table, and adding one would duplicate the source of truth.
    memberIds: membershipRows.filter((m) => m.team_id === t.id).map((m) => m.user_id as string),
    status: t.status as OrgStatus,
  }));

  const roleFor = (userId: string, orgId: string): string => {
    const membership = membershipRows.find((m) => m.user_id === userId && m.organization_id === orgId);
    if (membership?.role_id) return roleNameById.get(membership.role_id as string) ?? "Employee";
    const assigned = (userRoles.data ?? []).find((r) => r.user_id === userId && r.organization_id === orgId);
    return roleByBase.get((assigned?.role as string) ?? "employee") ?? "Employee";
  };

  const users: OrgUser[] = profileRows.map((p) => {
    const userId = p.user_id as string;
    const mine = membershipRows.filter((m) => m.user_id === userId);
    const primary = mine.find((m) => m.is_primary) ?? mine[0];
    return {
      id: userId,
      name: (p.full_name as string) || (p.username as string) || "Unnamed",
      email: (p.email as string) ?? "",
      phone: (p.phone as string) ?? undefined,
      avatarUrl: (p.avatar_url as string) ?? undefined,
      employeeId: (p.employee_id as string) ?? undefined,
      designation: (primary?.designation as string) ?? "",
      joiningDate: (p.joining_date as string) ?? undefined,
      status: (p.status as OrgStatus) ?? "active",
      primaryOrgId: (primary?.organization_id as string) ?? "",
      memberships: mine.map<Membership>((m) => ({
        orgId: m.organization_id as string,
        departmentId: (m.department_id as string) ?? undefined,
        teamId: (m.team_id as string) ?? undefined,
        role: roleFor(userId, m.organization_id as string),
        status: m.status as OrgStatus,
        reportingManagerId: (m.reporting_manager_id as string) ?? undefined,
      })),
    };
  });

  const roles: Role[] = (roleRows.data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    status: r.status as OrgStatus,
    scope: r.scope as Role["scope"],
    permissions: (r.permissions as string[]) ?? [],
    settings: (r.settings as Role["settings"]) ?? {},
    aliases: [r.name as string, r.base_role as string],
    system: Boolean(r.is_system),
  }));

  return {
    organizations: (orgs.data ?? []).map(mapOrganization),
    departments,
    teams,
    users,
    roles,
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/*                                                                     */
/* Each returns the created/updated row, or null when the write failed  */
/* — usually because RLS refused it, which is the correct outcome for a */
/* user without the privilege.                                         */
/* ------------------------------------------------------------------ */

/** Resolve a display name back to a user id. Unmatched names become NULL. */
export function resolveUserId(users: OrgUser[], name?: string): string | null {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  return users.find((u) => u.name.trim().toLowerCase() === wanted)?.id ?? null;
}

export async function createDepartmentRow(
  input: { orgId: string; name: string; code?: string; description?: string; headUserId?: string | null },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("departments")
    .insert({
      organization_id: input.orgId,
      name: input.name,
      code: input.code ?? null,
      description: input.description ?? null,
      head_user_id: input.headUserId ?? null,
    })
    .select("id")
    .single();
  if (error) return fail("createDepartment", error);
  return data.id as string;
}

export async function updateDepartmentRow(
  id: string,
  updates: { name?: string; code?: string; description?: string; headUserId?: string | null; status?: OrgStatus },
): Promise<boolean> {
  const payload: Upd<"departments"> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.code !== undefined) payload.code = updates.code;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.headUserId !== undefined) payload.head_user_id = updates.headUserId;
  if (updates.status !== undefined) payload.status = updates.status;
  if (!Object.keys(payload).length) return true;
  const { error } = await supabase.from("departments").update(payload).eq("id", id);
  return error ? Boolean(fail("updateDepartment", error)) : true;
}

export async function createTeamRow(
  input: { orgId: string; departmentId?: string; name: string; leadUserId?: string | null },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("teams")
    .insert({
      organization_id: input.orgId,
      department_id: input.departmentId || null,
      name: input.name,
      lead_user_id: input.leadUserId ?? null,
    })
    .select("id")
    .single();
  if (error) return fail("createTeam", error);
  return data.id as string;
}

export async function updateTeamRow(
  id: string,
  updates: { name?: string; departmentId?: string; leadUserId?: string | null; status?: OrgStatus },
): Promise<boolean> {
  const payload: Upd<"teams"> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.departmentId !== undefined) payload.department_id = updates.departmentId || null;
  if (updates.leadUserId !== undefined) payload.lead_user_id = updates.leadUserId;
  if (updates.status !== undefined) payload.status = updates.status;
  if (!Object.keys(payload).length) return true;
  const { error } = await supabase.from("teams").update(payload).eq("id", id);
  return error ? Boolean(fail("updateTeam", error)) : true;
}

/** Team membership is a column on organization_memberships, not a join table. */
export async function setUserTeam(userId: string, orgId: string, teamId: string | null): Promise<boolean> {
  const { error } = await supabase
    .from("organization_memberships")
    .update({ team_id: teamId })
    .eq("user_id", userId)
    .eq("organization_id", orgId);
  return error ? Boolean(fail("setUserTeam", error)) : true;
}

export async function createRoleRow(
  input: { orgId: string; name: string; description?: string; baseRole: BaseRole; scope: string; permissions: string[]; settings: Database["public"]["Tables"]["roles"]["Insert"]["settings"] },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("roles")
    .insert({
      organization_id: input.orgId,
      name: input.name,
      description: input.description ?? null,
      base_role: input.baseRole,
      scope: input.scope,
      permissions: input.permissions,
      settings: input.settings ?? {},
      is_system: false,
    })
    .select("id")
    .single();
  if (error) return fail("createRole", error);
  return data.id as string;
}

export async function updateRoleRow(
  id: string,
  updates: { name?: string; description?: string; scope?: string; permissions?: string[]; settings?: Database["public"]["Tables"]["roles"]["Update"]["settings"]; status?: OrgStatus; baseRole?: BaseRole },
): Promise<boolean> {
  const payload: Upd<"roles"> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.scope !== undefined) payload.scope = updates.scope;
  if (updates.permissions !== undefined) payload.permissions = updates.permissions;
  if (updates.settings !== undefined) payload.settings = updates.settings;
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.baseRole !== undefined) payload.base_role = updates.baseRole;
  if (!Object.keys(payload).length) return true;
  const { error } = await supabase.from("roles").update(payload).eq("id", id);
  // A system role refuses base_role and status changes via a database trigger.
  return error ? Boolean(fail("updateRole", error)) : true;
}

export async function deleteRoleRow(id: string): Promise<boolean> {
  const { error } = await supabase.from("roles").delete().eq("id", id);
  return error ? Boolean(fail("deleteRole", error)) : true;
}

export async function updateProfileRow(
  userId: string,
  updates: { name?: string; phone?: string; employeeId?: string; joiningDate?: string; status?: OrgStatus },
): Promise<boolean> {
  const payload: Upd<"profiles"> = {};
  if (updates.name !== undefined) payload.full_name = updates.name;
  if (updates.phone !== undefined) payload.phone = updates.phone;
  if (updates.employeeId !== undefined) payload.employee_id = updates.employeeId;
  if (updates.joiningDate !== undefined) payload.joining_date = updates.joiningDate || null;
  if (updates.status !== undefined) payload.status = updates.status;
  if (!Object.keys(payload).length) return true;
  const { error } = await supabase.from("profiles").update(payload).eq("user_id", userId);
  return error ? Boolean(fail("updateProfile", error)) : true;
}

export async function upsertMembershipRow(
  userId: string,
  membership: { orgId: string; departmentId?: string; teamId?: string; roleId?: string | null; designation?: string; reportingManagerId?: string | null; status?: OrgStatus; isPrimary?: boolean },
): Promise<boolean> {
  const { error } = await supabase.from("organization_memberships").upsert(
    {
      user_id: userId,
      organization_id: membership.orgId,
      department_id: membership.departmentId || null,
      team_id: membership.teamId || null,
      role_id: membership.roleId ?? null,
      designation: membership.designation ?? null,
      reporting_manager_id: membership.reportingManagerId ?? null,
      status: membership.status ?? "active",
      is_primary: membership.isPrimary ?? false,
    },
    { onConflict: "user_id,organization_id" },
  );
  return error ? Boolean(fail("upsertMembership", error)) : true;
}

export async function removeMembershipRow(userId: string, orgId: string): Promise<boolean> {
  const { error } = await supabase
    .from("organization_memberships")
    .delete()
    .eq("user_id", userId)
    .eq("organization_id", orgId);
  return error ? Boolean(fail("removeMembership", error)) : true;
}

/**
 * Assign a role.
 *
 * Writes BOTH the label (organization_memberships.role_id) and the privilege
 * (user_roles.role). The second is the one that matters: it is the only thing
 * row-level security consults, so a label change without it would look like a
 * permission change while granting nothing.
 */
export async function assignRoleRow(
  userId: string,
  orgId: string,
  role: { id: string; baseRole: BaseRole },
): Promise<boolean> {
  const [membership, privilege] = await Promise.all([
    supabase
      .from("organization_memberships")
      .update({ role_id: role.id })
      .eq("user_id", userId)
      .eq("organization_id", orgId),
    supabase
      .from("user_roles")
      .upsert({ user_id: userId, organization_id: orgId, role: role.baseRole, role_id: role.id }, { onConflict: "user_id,organization_id" }),
  ]);
  if (membership.error) return Boolean(fail("assignRole (label)", membership.error));
  if (privilege.error) return Boolean(fail("assignRole (privilege)", privilege.error));
  return true;
}

export async function updateOrganizationRow(
  id: string,
  updates: Partial<Organization>,
): Promise<boolean> {
  const payload: Upd<"organizations"> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.code !== undefined) payload.code = updates.code;
  if (updates.email !== undefined) payload.official_email = updates.email;
  if (updates.phone !== undefined) payload.phone = updates.phone;
  if (updates.website !== undefined) payload.website = updates.website;
  if (updates.country !== undefined) payload.country = updates.country;
  if (updates.timezone !== undefined) payload.timezone = updates.timezone;
  if (updates.logoUrl !== undefined) payload.logo_url = updates.logoUrl;
  if (updates.status !== undefined) payload.status = updates.status;
  if (!Object.keys(payload).length) return true;
  const { error } = await supabase.from("organizations").update(payload).eq("id", id);
  return error ? Boolean(fail("updateOrganization", error)) : true;
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/*                                                                     */
/* The Projects screen rendered five hardcoded projects from            */
/* mock-data.ts while work_projects held five real ones it never read,  */
/* and "Create Project" persisted nothing. These map between the table  */
/* and the shape that screen already uses.                              */
/* ------------------------------------------------------------------ */

/** Stable colour per project, so a project keeps its colour between loads. */
export function projectColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hues = [265, 30, 155, 300, 80, 200, 340, 120];
  return `oklch(0.7 0.15 ${hues[hash % hues.length]})`;
}

/** The project lifecycle as the Projects screen spells it. */
export type ProjectLifecycle = "planning" | "active" | "on-hold" | "completed" | "cancelled" | "archived";

const lifecycleFromRow = (status: string): ProjectLifecycle =>
  status === "on_hold" ? "on-hold"
  : status === "active" || status === "completed" || status === "cancelled" || status === "archived" ? status
  : "planning";

const lifecycleToRow = (status: string): Upd<"work_projects">["status"] =>
  status === "on-hold" ? "on_hold"
  : status === "active" || status === "completed" || status === "cancelled" || status === "archived" ? status
  : "planning";

export interface LoadedProject {
  id: string;
  name: string;
  description?: string;
  color: string;
  /** projectProgress(...).percent — the one progress figure (FD-014). */
  progress: number;
  /** Counted tasks (everything but cancelled) and how many are done. */
  taskCount: number;
  doneCount: number;
  members: number;
  deadline: string;
  startDate: string;
  /** projectHealth(...) — the one health figure (FD-014, FD-056). */
  health: ProjectHealth;
  organizationId: string;
  manager: PersonRef;
  managerId: string | null;
  team: PersonRef[];
  teamIds: string[];
  pendingTasks: number;
  overdueTasks: number;
  risk: "low" | "medium" | "high";
  /** Empty when the project has no category — never an invented one. */
  category: string;
  /** Department or team name, when the project has one. */
  department?: string;
  departmentId: string | null;
  teamId: string | null;
  priority: "low" | "medium" | "high" | "critical";
  projectType: "internal" | "client";
  client: string;
  creationStatus: ProjectLifecycle;
  createdAt: string;
  updatedAt: string;
}

/**
 * Risk follows health. It used to be read off the project's priority, so a
 * card could say "On track" and "high" side by side — a second, contradictory
 * health signal (FD-014).
 */
export const riskFor = (health: ProjectHealth): LoadedProject["risk"] =>
  health === "delayed" ? "high" : health === "at-risk" ? "medium" : "low";

/**
 * Load projects with their real progress.
 *
 * Progress, health and pendingTasks are derived from work_tasks rather than
 * stored, so they cannot drift from the board the way a cached column would.
 * Both go through project-metrics.ts, the same functions every other screen
 * uses, with "today" in the project's organization timezone (FD-014, FD-056).
 */
export async function loadProjects(): Promise<LoadedProject[] | null> {
  const [projectRows, taskRows, profileRows, categoryRows, memberRows, orgRows, departmentRows, teamRows] =
    await Promise.all([
      supabase.from("work_projects").select("*").is("archived_at", null).order("created_at"),
      supabase.from("work_tasks").select("id, project_id, status, due_date, due_at").is("archived_at", null),
      supabase.from("profiles").select("user_id, full_name, username"),
      supabase.from("project_categories").select("id, name"),
      supabase.from("project_members").select("project_id, user_id"),
      supabase.from("organizations").select("id, timezone"),
      supabase.from("departments").select("id, name"),
      supabase.from("teams").select("id, name"),
    ]);

  const firstError = [projectRows, taskRows, profileRows, categoryRows, memberRows, orgRows, departmentRows, teamRows]
    .find((r) => r.error);
  if (firstError?.error) return fail("loadProjects", firstError.error);

  const nameByUser = new Map(
    (profileRows.data ?? []).map((p) => [p.user_id, p.full_name || p.username || null]),
  );
  // personRef is what useWorkspace().people is built from, so a manager here
  // has the same id, initials and colour as in every picker.
  const personFor = (userId: string | null) => personRef(userId, userId ? nameByUser.get(userId) : null);
  const categoryName = new Map((categoryRows.data ?? []).map((c) => [c.id, c.name]));
  const departmentName = new Map((departmentRows.data ?? []).map((d) => [d.id, d.name]));
  const teamName = new Map((teamRows.data ?? []).map((t) => [t.id, t.name]));
  const timezoneByOrg = new Map((orgRows.data ?? []).map((o) => [o.id, o.timezone]));
  const todayByOrg = new Map<string, string>();
  const todayFor = (orgId: string) => {
    if (!todayByOrg.has(orgId)) todayByOrg.set(orgId, todayIn(timezoneByOrg.get(orgId) ?? undefined));
    return todayByOrg.get(orgId) as string;
  };

  return (projectRows.data ?? []).map((row) => {
    const today = todayFor(row.organization_id);
    const mine = (taskRows.data ?? []).filter((t) => t.project_id === row.id);
    const progress = projectProgress(mine);
    const overdueTasks = mine.filter((t) => {
      if (t.status === "done" || t.status === "cancelled") return false;
      const due = t.due_date ?? t.due_at?.slice(0, 10);
      return Boolean(due && due < today);
    }).length;
    const due = row.due_date ?? "";
    const health = projectHealth({
      progress,
      dueDate: due,
      today,
      lifecycle: row.status,
      overdueTasks,
    });

    const teamIds = (memberRows.data ?? [])
      .filter((m) => m.project_id === row.id)
      .map((m) => m.user_id);
    const managerId = row.manager_id ?? row.owner_id;

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      color: projectColor(row.name),
      progress: progress.percent,
      taskCount: progress.total,
      doneCount: progress.done,
      members: teamIds.length,
      deadline: due ? `${due}T23:59:59` : "",
      startDate: row.start_date ? `${row.start_date}T00:00:00` : "",
      health,
      organizationId: row.organization_id,
      manager: personFor(managerId),
      managerId,
      team: teamIds.map(personFor),
      teamIds,
      pendingTasks: progress.open,
      overdueTasks,
      risk: riskFor(health),
      // Was `?? "Internal"`: a project with no category was shown as having
      // one it never had (FD-014).
      category: (row.category_id ? categoryName.get(row.category_id) : undefined) ?? "",
      department:
        (row.team_id ? teamName.get(row.team_id) : undefined) ??
        (row.department_id ? departmentName.get(row.department_id) : undefined),
      departmentId: row.department_id,
      teamId: row.team_id,
      priority: row.priority,
      projectType: row.project_type === "client" ? "client" : "internal",
      client: row.client_name ?? "",
      creationStatus: lifecycleFromRow(row.status),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/** Resolve a category name to its row in the project's organization. */
async function categoryIdFor(orgId: string, name: string): Promise<string | null> {
  const { data } = await supabase
    .from("project_categories")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", name)
    .maybeSingle();
  return data?.id ?? null;
}

export async function createProjectRow(input: {
  orgId: string;
  name: string;
  description?: string;
  startDate?: string;
  dueDate?: string;
  categoryName?: string;
  priority?: "low" | "medium" | "high" | "critical";
  projectType?: "internal" | "client";
  clientName?: string;
  status?: ProjectLifecycle;
  managerId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
}): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("createProject", new Error("not signed in"));

  const categoryId = input.categoryName ? await categoryIdFor(input.orgId, input.categoryName) : null;

  const { data, error } = await supabase
    .from("work_projects")
    .insert({
      organization_id: input.orgId,
      name: input.name,
      description: input.description || null,
      // RLS requires owner_id = auth.uid() on insert, so this is not optional.
      owner_id: auth.user.id,
      manager_id: input.managerId ?? auth.user.id,
      start_date: input.startDate ? input.startDate.slice(0, 10) : null,
      due_date: input.dueDate ? input.dueDate.slice(0, 10) : null,
      category_id: categoryId,
      department_id: input.departmentId ?? null,
      team_id: input.teamId ?? null,
      priority: input.priority ?? "medium",
      project_type: input.projectType ?? "internal",
      client_name: input.clientName || null,
      status: lifecycleToRow(input.status ?? "planning"),
    })
    .select("id")
    .single();
  if (error) return fail("createProject", error);
  return data.id;
}

export async function updateProjectRow(
  id: string,
  updates: {
    name?: string;
    description?: string;
    startDate?: string;
    dueDate?: string;
    priority?: "low" | "medium" | "high" | "critical";
    status?: string;
    clientName?: string;
    projectType?: "internal" | "client";
    /** Resolved within the project's own organization; an unknown name clears it. */
    categoryName?: string;
    managerId?: string | null;
    departmentId?: string | null;
    teamId?: string | null;
  },
): Promise<boolean> {
  const payload: Upd<"work_projects"> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description || null;
  if (updates.startDate !== undefined) payload.start_date = updates.startDate ? updates.startDate.slice(0, 10) : null;
  if (updates.dueDate !== undefined) payload.due_date = updates.dueDate ? updates.dueDate.slice(0, 10) : null;
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.clientName !== undefined) payload.client_name = updates.clientName || null;
  if (updates.projectType !== undefined) payload.project_type = updates.projectType;
  if (updates.managerId !== undefined) payload.manager_id = updates.managerId;
  if (updates.departmentId !== undefined) payload.department_id = updates.departmentId;
  if (updates.teamId !== undefined) payload.team_id = updates.teamId;
  if (updates.status !== undefined) payload.status = lifecycleToRow(updates.status);
  if (updates.categoryName !== undefined) {
    if (!updates.categoryName) {
      payload.category_id = null;
    } else {
      const { data: project, error } = await supabase
        .from("work_projects")
        .select("organization_id")
        .eq("id", id)
        .maybeSingle();
      if (error || !project) return Boolean(fail("updateProject (category)", error ?? new Error("project not found")));
      payload.category_id = await categoryIdFor(project.organization_id, updates.categoryName);
    }
  }
  if (!Object.keys(payload).length) return true;
  const { error } = await supabase.from("work_projects").update(payload).eq("id", id);
  return error ? Boolean(fail("updateProject", error)) : true;
}

/**
 * Make project_members exactly `userIds`: add the new ones, remove the rest.
 *
 * The Team Members picker used to collect names that were never written
 * anywhere, so a project's team vanished on refresh (FD-034).
 */
export async function setProjectMembers(projectId: string, userIds: string[]): Promise<boolean> {
  const wanted = [...new Set(userIds.filter(Boolean))];
  const { data: current, error: readError } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId);
  if (readError) return Boolean(fail("setProjectMembers (read)", readError));

  const existing = new Set((current ?? []).map((m) => m.user_id));
  const toAdd = wanted.filter((userId) => !existing.has(userId));
  const toRemove = [...existing].filter((userId) => !wanted.includes(userId));

  if (toAdd.length) {
    const { error } = await supabase
      .from("project_members")
      .upsert(toAdd.map((userId) => ({ project_id: projectId, user_id: userId })), {
        onConflict: "project_id,user_id",
        ignoreDuplicates: true,
      });
    if (error) return Boolean(fail("setProjectMembers (add)", error));
  }
  if (toRemove.length) {
    const { error } = await supabase
      .from("project_members")
      .delete()
      .eq("project_id", projectId)
      .in("user_id", toRemove);
    if (error) return Boolean(fail("setProjectMembers (remove)", error));
  }
  return true;
}

/** Archive rather than delete, so the tasks that reference it keep their history. */
export async function archiveProjectRow(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("work_projects")
    .update({ archived_at: new Date().toISOString(), status: "archived" })
    .eq("id", id);
  return error ? Boolean(fail("archiveProject", error)) : true;
}

/* ------------------------------------------------------------------ */
/* Task & Project settings                                             */
/*                                                                     */
/* Categories and tags are free-form and get real rows. Statuses and    */
/* priorities are backed by Postgres enums that the board and the       */
/* dashboard key off, so only their PRESENTATION is stored — see the    */
/* note at the top of 20260922000000_admin_persistence.sql.             */
/* ------------------------------------------------------------------ */

export interface LoadedSettings {
  statuses: { id: string; value: string; label: string; order: number; isDefault: boolean; isCompleted: boolean; active: boolean }[];
  categories: { id: string; name: string; orgId: string; active: boolean }[];
  tags: { id: string; name: string; orgId: string; active: boolean }[];
}

export async function loadSettings(): Promise<LoadedSettings | null> {
  const [statusRows, categoryRows, tagRows] = await Promise.all([
    supabase.from("task_status_settings").select("*").order("sort_order"),
    supabase.from("project_categories").select("*").order("sort_order"),
    supabase.from("task_tags").select("*").order("name"),
  ]);
  const firstError = [statusRows, categoryRows, tagRows].find((r) => r.error);
  if (firstError?.error) return fail("loadSettings", firstError.error);

  return {
    statuses: (statusRows.data ?? []).map((r) => ({
      id: r.id,
      value: r.value,
      label: r.label,
      order: r.sort_order,
      isDefault: r.is_default,
      isCompleted: r.is_completed,
      active: r.status === "active",
    })),
    categories: (categoryRows.data ?? []).map((r) => ({
      id: r.id, name: r.name, orgId: r.organization_id, active: r.status === "active",
    })),
    tags: (tagRows.data ?? []).map((r) => ({
      id: r.id, name: r.name, orgId: r.organization_id, active: r.status === "active",
    })),
  };
}

export async function updateStatusSettingRow(
  id: string,
  updates: { label?: string; order?: number; isDefault?: boolean; isCompleted?: boolean; active?: boolean },
): Promise<boolean> {
  const payload: Upd<"task_status_settings"> = {};
  if (updates.label !== undefined) payload.label = updates.label;
  if (updates.order !== undefined) payload.sort_order = updates.order;
  if (updates.isDefault !== undefined) payload.is_default = updates.isDefault;
  if (updates.isCompleted !== undefined) payload.is_completed = updates.isCompleted;
  if (updates.active !== undefined) payload.status = updates.active ? "active" : "inactive";
  if (!Object.keys(payload).length) return true;
  const { error } = await supabase.from("task_status_settings").update(payload).eq("id", id);
  return error ? Boolean(fail("updateStatusSetting", error)) : true;
}

/** Exactly one status may be the default, and one the completed state. */
export async function setExclusiveStatusFlag(
  orgId: string, id: string, flag: "is_default" | "is_completed",
): Promise<boolean> {
  // Built explicitly rather than with a computed key, so the generated types
  // still check the column name.
  const off: Upd<"task_status_settings"> = flag === "is_default" ? { is_default: false } : { is_completed: false };
  const on: Upd<"task_status_settings"> = flag === "is_default" ? { is_default: true } : { is_completed: true };
  const clear = await supabase.from("task_status_settings").update(off).eq("organization_id", orgId);
  if (clear.error) return Boolean(fail("setExclusiveStatusFlag (clear)", clear.error));
  const set = await supabase.from("task_status_settings").update(on).eq("id", id);
  return set.error ? Boolean(fail("setExclusiveStatusFlag (set)", set.error)) : true;
}

export async function createCategoryRow(orgId: string, name: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("project_categories").insert({ organization_id: orgId, name }).select("id").single();
  if (error) return fail("createCategory", error);
  return data.id;
}

export async function updateCategoryRow(
  id: string, updates: { name?: string; active?: boolean },
): Promise<boolean> {
  const payload: Upd<"project_categories"> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.active !== undefined) payload.status = updates.active ? "active" : "inactive";
  if (!Object.keys(payload).length) return true;
  const { error } = await supabase.from("project_categories").update(payload).eq("id", id);
  return error ? Boolean(fail("updateCategory", error)) : true;
}

export async function createTagRow(orgId: string, name: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("task_tags").insert({ organization_id: orgId, name }).select("id").single();
  if (error) return fail("createTag", error);
  return data.id;
}

export async function updateTagRow(
  id: string, updates: { name?: string; active?: boolean },
): Promise<boolean> {
  const payload: Upd<"task_tags"> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.active !== undefined) payload.status = updates.active ? "active" : "inactive";
  if (!Object.keys(payload).length) return true;
  const { error } = await supabase.from("task_tags").update(payload).eq("id", id);
  return error ? Boolean(fail("updateTag", error)) : true;
}
