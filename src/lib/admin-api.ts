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
function projectColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hues = [265, 30, 155, 300, 80, 200, 340, 120];
  return `oklch(0.7 0.15 ${hues[hash % hues.length]})`;
}

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";

export interface LoadedProject {
  id: string;
  name: string;
  description?: string;
  color: string;
  progress: number;
  members: number;
  deadline: string;
  startDate: string;
  status: "on-track" | "at-risk" | "delayed";
  organizationId: string;
  manager: { name: string; initials: string; color: string };
  team: { name: string; initials: string; color: string }[];
  pendingTasks: number;
  risk: "low" | "medium" | "high";
  category: string;
  priority: "low" | "medium" | "high" | "critical";
  projectType: "internal" | "client";
  client: string;
  creationStatus: "planning" | "active" | "on-hold";
}

/**
 * Load projects with their real progress.
 *
 * Progress and pendingTasks are derived from work_tasks rather than stored, so
 * they cannot drift from the board the way a cached column would.
 */
export async function loadProjects(): Promise<LoadedProject[] | null> {
  const [projectRows, taskRows, profileRows, categoryRows, memberRows] = await Promise.all([
    supabase.from("work_projects").select("*").is("archived_at", null).order("created_at"),
    supabase.from("work_tasks").select("id, project_id, status").is("archived_at", null),
    supabase.from("profiles").select("user_id, full_name, username"),
    supabase.from("project_categories").select("id, name"),
    supabase.from("project_members").select("project_id, user_id"),
  ]);

  const firstError = [projectRows, taskRows, profileRows, categoryRows, memberRows].find((r) => r.error);
  if (firstError?.error) return fail("loadProjects", firstError.error);

  const personFor = (userId: string | null) => {
    const row = (profileRows.data ?? []).find((p) => p.user_id === userId);
    const name = row?.full_name || row?.username || "Unassigned";
    return { name, initials: initialsOf(name), color: projectColor(name) };
  };
  const categoryName = new Map((categoryRows.data ?? []).map((c) => [c.id, c.name]));
  const today = new Date().toISOString().slice(0, 10);

  return (projectRows.data ?? []).map((row) => {
    const mine = (taskRows.data ?? []).filter((t) => t.project_id === row.id);
    const done = mine.filter((t) => t.status === "done").length;
    const pending = mine.filter((t) => t.status !== "done" && t.status !== "cancelled").length;
    const progress = mine.length ? Math.round((done / mine.length) * 100) : 0;
    const due = row.due_date ?? "";

    // Overdue and unfinished is delayed; due within a fortnight and under
    // halfway is at risk. Everything else is on track.
    const daysLeft = due ? Math.round((Date.parse(due) - Date.parse(today)) / 86400000) : Infinity;
    const status: LoadedProject["status"] =
      progress < 100 && daysLeft < 0 ? "delayed"
      : progress < 50 && daysLeft <= 14 ? "at-risk"
      : "on-track";

    const team = (memberRows.data ?? [])
      .filter((m) => m.project_id === row.id)
      .map((m) => personFor(m.user_id));

    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      color: projectColor(row.name),
      progress,
      members: team.length,
      deadline: due ? `${due}T23:59:59` : "",
      startDate: row.start_date ? `${row.start_date}T00:00:00` : "",
      status,
      organizationId: row.organization_id,
      manager: personFor(row.manager_id ?? row.owner_id),
      team,
      pendingTasks: pending,
      risk: row.priority === "critical" || row.priority === "high" ? "high" : row.priority === "medium" ? "medium" : "low",
      category: (row.category_id ? categoryName.get(row.category_id) : undefined) ?? "Internal",
      priority: row.priority,
      projectType: (row.project_type === "client" ? "client" : "internal"),
      client: row.client_name ?? "",
      creationStatus: row.status === "on_hold" ? "on-hold" : row.status === "active" ? "active" : "planning",
    };
  });
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
  status?: "planning" | "active" | "on-hold";
  managerId?: string | null;
}): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("createProject", new Error("not signed in"));

  let categoryId: string | null = null;
  if (input.categoryName) {
    const { data } = await supabase
      .from("project_categories")
      .select("id")
      .eq("organization_id", input.orgId)
      .eq("name", input.categoryName)
      .maybeSingle();
    categoryId = data?.id ?? null;
  }

  const { data, error } = await supabase
    .from("work_projects")
    .insert({
      organization_id: input.orgId,
      name: input.name,
      description: input.description ?? null,
      // RLS requires owner_id = auth.uid() on insert, so this is not optional.
      owner_id: auth.user.id,
      manager_id: input.managerId ?? auth.user.id,
      start_date: input.startDate ? input.startDate.slice(0, 10) : null,
      due_date: input.dueDate ? input.dueDate.slice(0, 10) : null,
      category_id: categoryId,
      priority: input.priority ?? "medium",
      project_type: input.projectType ?? "internal",
      client_name: input.clientName ?? null,
      status: input.status === "on-hold" ? "on_hold" : (input.status ?? "planning"),
    })
    .select("id")
    .single();
  if (error) return fail("createProject", error);
  return data.id;
}

export async function updateProjectRow(
  id: string,
  updates: { name?: string; description?: string; startDate?: string; dueDate?: string; priority?: "low" | "medium" | "high" | "critical"; status?: string; clientName?: string },
): Promise<boolean> {
  const payload: Upd<"work_projects"> = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.startDate !== undefined) payload.start_date = updates.startDate ? updates.startDate.slice(0, 10) : null;
  if (updates.dueDate !== undefined) payload.due_date = updates.dueDate ? updates.dueDate.slice(0, 10) : null;
  if (updates.priority !== undefined) payload.priority = updates.priority;
  if (updates.clientName !== undefined) payload.client_name = updates.clientName;
  if (updates.status !== undefined) {
    const map: Record<string, Upd<"work_projects">["status"]> = {
      "on-hold": "on_hold", planning: "planning", active: "active",
      completed: "completed", cancelled: "cancelled", archived: "archived",
    };
    payload.status = map[updates.status] ?? "planning";
  }
  if (!Object.keys(payload).length) return true;
  const { error } = await supabase.from("work_projects").update(payload).eq("id", id);
  return error ? Boolean(fail("updateProject", error)) : true;
}

/** Archive rather than delete, so the tasks that reference it keep their history. */
export async function archiveProjectRow(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("work_projects")
    .update({ archived_at: new Date().toISOString(), status: "archived" })
    .eq("id", id);
  return error ? Boolean(fail("archiveProject", error)) : true;
}
