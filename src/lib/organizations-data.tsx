import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  assignRoleRow,
  createDepartmentRow,
  createRoleRow,
  createTeamRow,
  loadAdminSnapshot,
  removeMembershipRow,
  resolveUserId,
  setUserTeam,
  updateDepartmentRow,
  updateOrganizationRow,
  updateProfileRow,
  updateRoleRow,
  updateTeamRow,
  upsertMembershipRow,
  type BaseRole,
} from "@/lib/admin-api";

export type OrgStatus = "active" | "inactive";

export interface Organization {
  id: string;
  name: string;
  code: string;
  logoUrl?: string;
  email?: string;
  phone?: string;
  website?: string;
  country: string;
  timezone: string;
  status: OrgStatus;
}

export interface Department {
  id: string;
  orgId: string;
  name: string;
  head: string;
  code?: string;
  description?: string;
  status: OrgStatus;
}

export interface Team {
  id: string;
  orgId: string;
  departmentId: string;
  name: string;
  /** User id of the team lead. */
  lead?: string;
  memberIds: string[];
  status: OrgStatus;
}

export type NewDepartmentInput = Omit<Department, "id">;
export type NewTeamInput = Omit<Team, "id">;

export interface Membership {
  orgId: string;
  departmentId?: string;
  teamId?: string;
  /** The role's name in this organization, e.g. "Employee". */
  role: string;
  status: OrgStatus;
  reportingManagerId?: string;
}

export interface OrgUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  employeeId?: string;
  designation: string;
  joiningDate?: string;
  status: OrgStatus;
  primaryOrgId: string;
  memberships: Membership[];
}

export type UserActivityType =
  | "created"
  | "role-changed"
  | "department-changed"
  | "team-changed"
  | "organization-added"
  | "organization-removed"
  | "activated"
  | "deactivated"
  | "updated";

export interface UserActivity {
  id: string;
  userId: string;
  type: UserActivityType;
  message: string;
  at: string;
}

export interface OrgProject {
  id: string;
  name: string;
  orgId: string;
  /** Not completed, cancelled or archived. */
  active: boolean;
  categoryId?: string;
}

export interface OrgCounts {
  departments: number;
  teams: number;
  users: number;
  activeProjects: number;
}

/* ------------------------------------------------------------------ */
/* Phone numbers                                                       */
/* ------------------------------------------------------------------ */

/** Digits only, not counting the separators. E.164 allows at most 15. */
export const PHONE_RULES = { minDigits: 7, maxDigits: 15, maxLength: 20 } as const;

/**
 * Validate a phone number typed by hand. Empty is valid (the field is optional).
 * Accepts digits, spaces, + - ( ) only (FD-050: "abcxyz" used to be accepted).
 */
export function validatePhone(value: string): string | null {
  const phone = value.trim();
  if (!phone) return null;
  if (/[^0-9+\-() ]/.test(phone)) return "Use digits, spaces and + - ( ) only.";
  if (phone.lastIndexOf("+") > 0) return "A + can only appear once, at the start.";
  if (phone.length > PHONE_RULES.maxLength) return `Keep it to ${PHONE_RULES.maxLength} characters.`;
  const digits = phone.replace(/\D/g, "").length;
  if (digits < PHONE_RULES.minDigits || digits > PHONE_RULES.maxDigits) {
    return `Enter ${PHONE_RULES.minDigits} to ${PHONE_RULES.maxDigits} digits.`;
  }
  return null;
}

/** "1 team", "2 teams". */
export const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/* ------------------------------------------------------------------ */
/* Roles & permissions                                                 */
/* ------------------------------------------------------------------ */

export type DataScope = "own" | "team" | "department" | "organization" | "all";
export type SettingsAccess = "none" | "view" | "manage";

export const scopeOptions: { value: DataScope; label: string; hint: string }[] = [
  { value: "own", label: "Own", hint: "Only their own tasks and records" },
  { value: "team", label: "Team", hint: "Everything in their teams" },
  { value: "department", label: "Department", hint: "Everything in their department" },
  { value: "organization", label: "Organization", hint: "Everything in their organization" },
  { value: "all", label: "All Organizations", hint: "Everything across every organization" },
];

// Only features the app actually has. Calendar, Reports and an organization-wide
// dashboard were listed here although no such screen exists (FD-068). Task and
// project delete do exist (tasks soft-delete, projects archive).
export const permissionModules: { key: string; label: string; items: { key: string; label: string }[] }[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    items: [
      { key: "dashboard.personal", label: "View Personal Dashboard" },
      { key: "dashboard.team", label: "View Team Dashboard" },
    ],
  },
  {
    key: "my-tasks",
    label: "My Tasks",
    items: [
      { key: "mytasks.view", label: "View" },
      { key: "mytasks.create", label: "Create" },
      { key: "mytasks.edit", label: "Edit" },
      { key: "mytasks.delete", label: "Delete" },
    ],
  },
  {
    key: "team-tasks",
    label: "Team Tasks",
    items: [
      { key: "teamtasks.view", label: "View" },
      { key: "teamtasks.create", label: "Create" },
      { key: "teamtasks.assign", label: "Assign" },
      { key: "teamtasks.edit", label: "Edit" },
      { key: "teamtasks.delete", label: "Delete" },
    ],
  },
  {
    key: "projects",
    label: "Projects",
    items: [
      { key: "projects.view", label: "View" },
      { key: "projects.create", label: "Create" },
      { key: "projects.manage", label: "Manage" },
      { key: "projects.delete", label: "Delete" },
    ],
  },
];

// One entry per settings screen in the sidebar. "Holidays & Working Days" was
// listed but has no screen (FD-068).
export const settingsModules: { key: string; label: string }[] = [
  { key: "settings.organizations", label: "Organizations" },
  { key: "settings.users", label: "Users" },
  { key: "settings.structure", label: "Teams & Departments" },
  { key: "settings.roles", label: "Roles & Permissions" },
  { key: "settings.taskProject", label: "Task & Project Settings" },
];

const knownPermissionKeys = new Set(permissionModules.flatMap((m) => m.items.map((i) => i.key)));
const knownSettingsKeys = new Set(settingsModules.map((s) => s.key));

export interface Role {
  id: string;
  name: string;
  description: string;
  status: OrgStatus;
  scope: DataScope;
  /** Permission keys that are granted. */
  permissions: string[];
  settings: Record<string, SettingsAccess>;
  /** Membership role labels already stored on users that map to this role. */
  aliases: string[];
  /** Built-in roles cannot be renamed, deactivated or deleted (the database refuses). */
  system?: boolean;
  /** Roles belong to one organization; each organization has its own "Admin". */
  orgId?: string;
  /** The privilege row-level security enforces for people holding this role. */
  baseRole?: BaseRole;
}

export type NewRoleInput = Omit<Role, "id">;

const settingsAll = (access: SettingsAccess) =>
  Object.fromEntries(settingsModules.map((s) => [s.key, access])) as Record<string, SettingsAccess>;

export const emptyRole: NewRoleInput = {
  name: "",
  description: "",
  status: "active",
  scope: "own",
  permissions: ["dashboard.personal", "mytasks.view"],
  settings: settingsAll("none"),
  aliases: [],
};

type OrganizationsContextValue = {
  /** Whether the admin data has loaded. Screens show a loading row, not "nothing here". */
  status: "loading" | "ready" | "error";
  organizations: Organization[];
  departments: Department[];
  teams: Team[];
  users: OrgUser[];
  projects: OrgProject[];
  /** Organizations the signed-in user may access. */
  accessibleOrganizations: Organization[];
  activeOrgId: string | "all";
  setActiveOrgId: (id: string | "all") => void;
  countsFor: (orgId: string) => OrgCounts;
  /**
   * THE department list (FD-036): the departments on Teams & Departments, active
   * only, for one organization or all of them. Every department picker uses this.
   */
  activeDepartmentsFor: (orgId: string | "all") => Department[];
  reloadProjects: () => Promise<void>;
  updateOrganization: (id: string, updates: Partial<Organization>) => void;
  setOrganizationStatus: (id: string, status: OrgStatus) => void;
  addDepartment: (orgId: string, name: string, head: string) => void;
  addUserToOrganization: (
    userId: string,
    orgId: string,
    membership: Omit<Membership, "orgId" | "status">,
  ) => void;
  isNameTaken: (name: string, exceptId?: string) => boolean;
  isCodeTaken: (code: string, exceptId?: string) => boolean;
  // Users
  userActivity: UserActivity[];
  currentUser: OrgUser | null;
  canManageUsers: boolean;
  updateUser: (id: string, updates: Partial<OrgUser>) => void;
  setUserStatus: (id: string, status: OrgStatus) => void;
  upsertMembership: (userId: string, membership: Membership) => void;
  removeMembership: (userId: string, orgId: string) => void;
  isEmailTaken: (email: string, exceptId?: string) => boolean;
  logUserActivity: (userId: string, type: UserActivityType, message: string) => void;
  // Departments & teams
  createDepartment: (input: NewDepartmentInput) => Department;
  updateDepartment: (id: string, updates: Partial<Department>) => void;
  setDepartmentStatus: (id: string, status: OrgStatus) => void;
  createTeam: (input: NewTeamInput) => Team;
  updateTeam: (id: string, updates: Partial<Team>) => void;
  setTeamStatus: (id: string, status: OrgStatus) => void;
  addTeamMember: (teamId: string, userId: string) => void;
  removeTeamMember: (teamId: string, userId: string) => void;
  moveTeamMember: (fromTeamId: string, toTeamId: string, userId: string) => void;
  isDepartmentNameTaken: (orgId: string, name: string, exceptId?: string) => boolean;
  isTeamNameTaken: (departmentId: string, name: string, exceptId?: string) => boolean;
  // Roles & permissions
  roles: Role[];
  /** The roles of one organization. */
  rolesFor: (orgId: string) => Role[];
  /** The people holding this role in its organization — the same rule the Users page uses. */
  roleMembers: (role: Role) => OrgUser[];
  roleUserCount: (role: Role) => number;
  /** The role new people get in an organization ("Employee"). */
  defaultRoleName: (orgId: string) => string;
  /** Active users holding an admin-level role anywhere. */
  activeAdminCount: number;
  activeAdminCountIn: (orgId: string) => number;
  isAdminIn: (user: OrgUser, orgId: string) => boolean;
  createRole: (input: NewRoleInput) => Role;
  updateRole: (id: string, updates: Partial<Role>) => void;
  /** Returns false when refused (built-in roles cannot be deactivated). */
  setRoleStatus: (id: string, status: OrgStatus) => boolean;
  duplicateRole: (id: string) => void;
  isRoleNameTaken: (name: string, exceptId?: string, orgId?: string) => boolean;
  /** Give the user this role in the role's organization — label and privilege. */
  assignRole: (userId: string, roleId: string) => void;
};

const OrganizationsContext = createContext<OrganizationsContextValue | null>(null);

const normalize = (v: string) => v.trim().toLowerCase();

const saveFailed = (what: string) =>
  toast.error(`${what} could not be saved. You may not have permission, or the connection dropped.`);

/** Toast when a write reports failure. The cause is already in the console from admin-api. */
const reportIfFailed = (what: string) => (ok: boolean) => {
  if (!ok) saveFailed(what);
  return ok;
};

async function loadOrgProjects(): Promise<OrgProject[] | null> {
  const { data, error } = await supabase
    .from("work_projects")
    .select("id, name, organization_id, status, category_id")
    .is("archived_at", null);
  if (error) {
    console.error("[flowdesk] loadOrgProjects failed", error);
    return null;
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    orgId: row.organization_id,
    active: !["completed", "cancelled", "archived"].includes(row.status),
    categoryId: row.category_id ?? undefined,
  }));
}

export function OrganizationsProvider({ children }: { children: ReactNode }) {
  // Everything starts empty and is loaded from Supabase. These lists used to be
  // seeded from hardcoded arrays of invented people and employee ids,
  // which meant the admin screens showed convincing data that did not exist and
  // silently discarded every edit.
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  // Was five invented projects with ids no real project has, so
  // every organization showed 0 active projects and the Projects org filter never
  // matched anything.
  const [projects, setProjects] = useState<OrgProject[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | "all">("all");
  const [roles, setRoles] = useState<Role[]>([]);
  const [userActivity, setUserActivity] = useState<UserActivity[]>([]);
  const [adminStatus, setAdminStatus] = useState<"loading" | "ready" | "error">("loading");
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null>(null);
  const [accessibleOrgIds, setAccessibleOrgIds] = useState<string[]>([]);
  const [authenticatedRoles, setAuthenticatedRoles] = useState<string[]>([]);

  const reloadProjects = useCallback(async () => {
    const loaded = await loadOrgProjects();
    if (loaded) setProjects(loaded);
  }, []);

  useEffect(() => {
    let active = true;
    const loadAccess = async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user || !active) return;
      const [{ data: memberships }, { data: assignedRoles }] = await Promise.all([
        supabase
          .from("organization_memberships")
          .select("organization_id, is_primary")
          .eq("user_id", authData.user.id)
          .eq("status", "active"),
        supabase.from("user_roles").select("role").eq("user_id", authData.user.id),
      ]);
      if (!active) return;
      setAuthenticatedUserId(authData.user.id);
      setAccessibleOrgIds((memberships ?? []).map((membership) => membership.organization_id));
      setAuthenticatedRoles((assignedRoles ?? []).map((assignedRole) => assignedRole.role));
      // Load the admin surfaces from the database. RLS already narrows every
      // table to this user's organizations, so no client-side scoping is needed.
      const [snapshot, roleMeta, loadedProjects] = await Promise.all([
        loadAdminSnapshot(),
        // Which organization each role belongs to, and its real privilege. Roles
        // are per organization, so with two organizations there are two "Admin"
        // rows; without this the Roles page listed both and counted everyone's
        // memberships against each (FD-037, FD-067).
        supabase.from("roles").select("id, organization_id, base_role"),
        loadOrgProjects(),
      ]);
      if (!active) return;
      if (loadedProjects) setProjects(loadedProjects);
      if (snapshot) {
        const metaById = new Map((roleMeta.data ?? []).map((row) => [row.id, row]));
        setOrganizations(snapshot.organizations);
        setDepartments(snapshot.departments);
        // admin-api maps a team lead to a display name, but every screen (and
        // the Team type) works with the user id, so leads never showed or saved.
        setTeams(
          snapshot.teams.map((team) => ({
            ...team,
            lead:
              team.lead && !snapshot.users.some((u) => u.id === team.lead)
                ? snapshot.users.find((u) => u.name === team.lead)?.id
                : team.lead,
          })),
        );
        setUsers(snapshot.users);
        setRoles(
          snapshot.roles.map((role) => {
            const meta = metaById.get(role.id);
            return {
              ...role,
              orgId: meta?.organization_id,
              baseRole: meta?.base_role,
              // Keys for features that do not exist are dropped, so saving a role
              // no longer writes them back (FD-068).
              permissions: role.permissions.filter((key) => knownPermissionKeys.has(key)),
              settings: Object.fromEntries(
                Object.entries(role.settings ?? {}).filter(([key]) => knownSettingsKeys.has(key)),
              ) as Record<string, SettingsAccess>,
            };
          }),
        );
        setAdminStatus("ready");
      } else {
        setAdminStatus("error");
      }

      const primary = memberships?.find((membership) => membership.is_primary)?.organization_id;
      if (primary) setActiveOrgId(primary);
    };
    void loadAccess();
    return () => {
      active = false;
    };
  }, []);

  /**
   * The screens call create* synchronously and use the returned object straight
   * away, so a row is added locally with a provisional id while the insert is in
   * flight. This swaps in the id the database actually assigned.
   *
   * If the insert failed (RLS refused it, or the network dropped) realId is null:
   * the row is removed again rather than left behind looking saved, and the
   * person is told — the screen had already said "created".
   */
  const reconcileId = useCallback(
    <T extends { id: string }>(
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      tempId: string,
      realId: string | null,
      what: string,
    ) => {
      if (!realId) saveFailed(what);
      setter((current) =>
        realId
          ? current.map((row) => (row.id === tempId ? { ...row, id: realId } : row))
          : current.filter((row) => row.id !== tempId),
      );
    },
    [],
  );

  const pushActivity = useCallback((userId: string, type: UserActivityType, message: string) => {
    setUserActivity((current) => [
      { id: `UA-${current.length + 1}-${Date.now()}`, userId, type, message, at: new Date().toISOString() },
      ...current,
    ]);
  }, []);

  const countsFor = useCallback(
    (orgId: string): OrgCounts => ({
      departments: departments.filter((d) => d.orgId === orgId).length,
      teams: teams.filter((t) => t.orgId === orgId).length,
      // The same rule as the Users page (filtered to this organization) and the
      // sum of the Roles page for this organization, so the three agree (FD-037).
      users: users.filter((u) => u.memberships.some((m) => m.orgId === orgId)).length,
      activeProjects: projects.filter((p) => p.orgId === orgId && p.active).length,
    }),
    [departments, teams, users, projects],
  );

  const value = useMemo<OrganizationsContextValue>(() => {
    // The privilege a role actually carries. Everything else on a role is
    // presentation; this is the single value row-level security consults, so a
    // new role must declare one or it would grant nothing.
    const baseRoleFor = (scope: DataScope): BaseRole =>
      scope === "all" ? "admin"
      : scope === "organization" ? "viewer"
      : scope === "department" ? "manager"
      : scope === "team" ? "team_lead"
      : "employee";

    const inOrg = (role: Role, orgId: string) => !role.orgId || role.orgId === orgId;
    const rolesFor = (orgId: string) => roles.filter((r) => inOrg(r, orgId));
    const roleIn = (orgId: string, name: string) =>
      roles.find((r) => inOrg(r, orgId) && normalize(r.name) === normalize(name));
    // A system role's privilege is fixed in the database; a custom one follows its scope.
    const privilegeOf = (role: Role): BaseRole => role.baseRole ?? baseRoleFor(role.scope);
    const isAdminRole = (orgId: string, name: string) => {
      const role = roleIn(orgId, name);
      return role ? privilegeOf(role) === "admin" : normalize(name) === "admin";
    };
    const isAdminIn = (user: OrgUser, orgId: string) =>
      user.memberships.some((m) => m.orgId === orgId && isAdminRole(m.orgId, m.role));
    const roleMembers = (role: Role) =>
      users.filter((u) =>
        u.memberships.some((m) => inOrg(role, m.orgId) && normalize(m.role) === normalize(role.name)),
      );
    const defaultRoleName = (orgId: string) =>
      rolesFor(orgId).find((r) => r.system && r.baseRole === "employee")?.name ?? "Employee";
    const fallbackOrgId = () =>
      activeOrgId !== "all" ? activeOrgId : (accessibleOrgIds[0] ?? organizations[0]?.id);

    const leadIdOf = (lead?: string) =>
      lead ? (users.some((u) => u.id === lead) ? lead : resolveUserId(users, lead)) : null;

    /**
     * Write one membership: department, team, manager, role label — and, when the
     * role changed, the privilege too. Without the privilege write a role change
     * on the Users page only relabelled the person (FD-067).
     *
     * is_primary and designation are passed explicitly: the upsert otherwise
     * writes false / null, which cleared them on every assignment edit.
     */
    const persistMembership = async (
      userId: string,
      membership: Membership,
      options: { isPrimary: boolean; designation?: string; roleChanged: boolean },
    ): Promise<boolean> => {
      const role = roleIn(membership.orgId, membership.role);
      const saved = await upsertMembershipRow(userId, {
        orgId: membership.orgId,
        departmentId: membership.departmentId,
        teamId: membership.teamId,
        roleId: role?.id ?? null,
        reportingManagerId: membership.reportingManagerId ?? null,
        status: membership.status,
        designation: options.designation,
        isPrimary: options.isPrimary,
      });
      if (!saved) {
        saveFailed("The organization assignment");
        return false;
      }
      if (options.roleChanged && role) {
        return reportIfFailed("The role change")(
          await assignRoleRow(userId, membership.orgId, { id: role.id, baseRole: privilegeOf(role) }),
        );
      }
      return true;
    };

    const sameMembership = (a: Membership, b: Membership) =>
      a.departmentId === b.departmentId &&
      a.teamId === b.teamId &&
      normalize(a.role) === normalize(b.role) &&
      a.reportingManagerId === b.reportingManagerId &&
      a.status === b.status;

    const replaceMembership = (userId: string, membership: Membership) =>
      setUsers((current) =>
        current.map((u) => {
          if (u.id !== userId) return u;
          const exists = u.memberships.some((m) => m.orgId === membership.orgId);
          return {
            ...u,
            primaryOrgId: u.primaryOrgId || membership.orgId,
            memberships: exists
              ? u.memberships.map((m) => (m.orgId === membership.orgId ? { ...m, ...membership } : m))
              : [...u.memberships, membership],
          };
        }),
      );

    const upsertMembership = (userId: string, membership: Membership) => {
      const user = users.find((u) => u.id === userId);
      const before = user?.memberships.find((m) => m.orgId === membership.orgId);
      replaceMembership(userId, membership);
      void persistMembership(userId, membership, {
        isPrimary: user?.primaryOrgId ? user.primaryOrgId === membership.orgId : true,
        designation: user?.designation,
        roleChanged: !before || normalize(before.role) !== normalize(membership.role),
      });
    };

    const adminCountIn = (orgId?: string) =>
      users.filter(
        (u) =>
          u.status === "active" &&
          u.memberships.some((m) => (!orgId || m.orgId === orgId) && isAdminRole(m.orgId, m.role)),
      ).length;

    return {
      status: adminStatus,
      organizations,
      departments,
      teams,
      users,
      projects,
      accessibleOrganizations: organizations.filter((organization) => accessibleOrgIds.includes(organization.id)),
      activeOrgId,
      setActiveOrgId,
      countsFor,
      activeDepartmentsFor: (orgId) =>
        departments
          .filter((d) => d.status === "active" && (orgId === "all" || d.orgId === orgId))
          .sort((a, b) => a.name.localeCompare(b.name)),
      reloadProjects,
      isNameTaken: (name, exceptId) =>
        organizations.some((o) => o.id !== exceptId && normalize(o.name) === normalize(name)),
      isCodeTaken: (code, exceptId) =>
        organizations.some((o) => o.id !== exceptId && normalize(o.code) === normalize(code)),
      updateOrganization: (id, updates) => {
        setOrganizations((current) => current.map((o) => (o.id === id ? { ...o, ...updates } : o)));
        void updateOrganizationRow(id, updates).then(reportIfFailed("The organization"));
      },
      setOrganizationStatus: (id, status) => {
        setOrganizations((current) => current.map((o) => (o.id === id ? { ...o, status } : o)));
        void updateOrganizationRow(id, { status }).then(reportIfFailed("The organization status"));
      },
      addDepartment: (orgId, name, head) => {
        const tempId = `D-pending-${Date.now()}`;
        setDepartments((current) => [...current, { id: tempId, orgId, name, head, status: "active" }]);
        void createDepartmentRow({ orgId, name, headUserId: resolveUserId(users, head) }).then((realId) =>
          reconcileId(setDepartments, tempId, realId, "The department"),
        );
      },
      addUserToOrganization: (userId, orgId, membership) =>
        upsertMembership(userId, { ...membership, orgId, status: "active" }),
      userActivity,
      currentUser: users.find((u) => u.id === authenticatedUserId) ?? null,
      canManageUsers: authenticatedRoles.includes("admin"),
      logUserActivity: pushActivity,
      isEmailTaken: (email, exceptId) =>
        users.some((u) => u.id !== exceptId && normalize(u.email) === normalize(email)),
      updateUser: (id, updates) => {
        const before = users.find((u) => u.id === id);
        setUsers((current) => current.map((u) => (u.id === id ? { ...u, ...updates } : u)));
        void updateProfileRow(id, {
          name: updates.name,
          phone: updates.phone,
          employeeId: updates.employeeId,
          joiningDate: updates.joiningDate,
          status: updates.status,
        }).then(reportIfFailed("The user's details"));
        if (!before) return;

        // Department, team, manager, role and designation live on the membership
        // rows. This used to update the screen only, so those edits vanished on
        // reload and the Users and Roles pages disagreed (FD-067).
        const primaryOrgId = before.primaryOrgId;
        const designation = updates.designation ?? before.designation;
        const designationChanged = designation !== before.designation;
        for (const next of updates.memberships ?? []) {
          const previous = before.memberships.find((m) => m.orgId === next.orgId);
          const isPrimary = next.orgId === primaryOrgId;
          if (previous && sameMembership(previous, next) && !(isPrimary && designationChanged)) continue;
          void persistMembership(id, next, {
            isPrimary,
            designation,
            roleChanged: !previous || normalize(previous.role) !== normalize(next.role),
          });
        }
        if (updates.memberships) {
          // Additional access removed in the drawer. The primary is never removed here.
          for (const previous of before.memberships) {
            if (previous.orgId === primaryOrgId) continue;
            if (updates.memberships.some((m) => m.orgId === previous.orgId)) continue;
            void removeMembershipRow(id, previous.orgId).then(reportIfFailed("Removing organization access"));
          }
        }
      },
      setUserStatus: (id, status) => {
        setUsers((current) => current.map((u) => (u.id === id ? { ...u, status } : u)));
        void updateProfileRow(id, { status }).then(reportIfFailed("The account status"));
        pushActivity(
          id,
          status === "active" ? "activated" : "deactivated",
          status === "active" ? "Account activated" : "Account deactivated",
        );
      },
      upsertMembership,
      removeMembership: (userId, orgId) => {
        // The primary organization is never removed; that would leave the account
        // with no route into any workspace.
        const user = users.find((u) => u.id === userId);
        if (!user || user.primaryOrgId === orgId) return;
        setUsers((current) =>
          current.map((u) =>
            u.id === userId
              ? { ...u, memberships: u.memberships.filter((m) => m.orgId !== orgId) }
              : u,
          ),
        );
        void removeMembershipRow(userId, orgId).then(reportIfFailed("Removing organization access"));
      },
      createDepartment: (input) => {
        const tempId = `D-pending-${Date.now()}`;
        const dept: Department = { ...input, id: tempId };
        setDepartments((current) => [...current, dept]);
        void createDepartmentRow({
          orgId: input.orgId,
          name: input.name,
          code: input.code,
          description: input.description,
          headUserId: resolveUserId(users, input.head),
        }).then((realId) => reconcileId(setDepartments, tempId, realId, "The department"));
        return dept;
      },
      updateDepartment: (id, updates) => {
        setDepartments((current) => current.map((d) => (d.id === id ? { ...d, ...updates } : d)));
        void updateDepartmentRow(id, {
          name: updates.name,
          code: updates.code,
          description: updates.description,
          status: updates.status,
          ...(updates.head !== undefined ? { headUserId: resolveUserId(users, updates.head) } : {}),
        }).then(reportIfFailed("The department"));
      },
      setDepartmentStatus: (id, status) => {
        setDepartments((current) => current.map((d) => (d.id === id ? { ...d, status } : d)));
        void updateDepartmentRow(id, { status }).then(reportIfFailed("The department status"));
      },
      createTeam: (input) => {
        const tempId = `TM-pending-${Date.now()}`;
        const team: Team = { ...input, id: tempId };
        setTeams((current) => [...current, team]);
        void createTeamRow({
          orgId: input.orgId,
          departmentId: input.departmentId,
          name: input.name,
          leadUserId: leadIdOf(input.lead),
        }).then((realId) => {
          reconcileId(setTeams, tempId, realId, "The team");
          // Members are a column on the membership row, so they can only be
          // written once the team has a real id.
          if (realId) {
            for (const userId of input.memberIds ?? []) {
              void setUserTeam(userId, input.orgId, realId).then(reportIfFailed("A team member"));
            }
          }
        });
        return team;
      },
      updateTeam: (id, updates) => {
        const before = teams.find((t) => t.id === id);
        setTeams((current) => current.map((t) => (t.id === id ? { ...t, ...updates } : t)));
        void updateTeamRow(id, {
          name: updates.name,
          departmentId: updates.departmentId,
          status: updates.status,
          // "lead" present but empty means "no lead"; it used to be skipped, so a
          // lead could never be cleared.
          ...("lead" in updates ? { leadUserId: leadIdOf(updates.lead) } : {}),
        }).then(reportIfFailed("The team"));
        // Members added or removed in the edit drawer were never written.
        if (before && updates.memberIds) {
          for (const userId of updates.memberIds) {
            if (!before.memberIds.includes(userId)) {
              void setUserTeam(userId, before.orgId, id).then(reportIfFailed("A team member"));
            }
          }
          for (const userId of before.memberIds) {
            if (!updates.memberIds.includes(userId)) {
              void setUserTeam(userId, before.orgId, null).then(reportIfFailed("A team member"));
            }
          }
        }
      },
      setTeamStatus: (id, status) => {
        setTeams((current) => current.map((t) => (t.id === id ? { ...t, status } : t)));
        void updateTeamRow(id, { status }).then(reportIfFailed("The team status"));
      },
      addTeamMember: (teamId, userId) => {
        setTeams((current) =>
          current.map((t) =>
            t.id === teamId && !t.memberIds.includes(userId)
              ? { ...t, memberIds: [...t.memberIds, userId] }
              : t,
          ),
        );
        const orgId = teams.find((t) => t.id === teamId)?.orgId;
        if (orgId) void setUserTeam(userId, orgId, teamId).then(reportIfFailed("The team member"));
      },
      removeTeamMember: (teamId, userId) => {
        setTeams((current) =>
          current.map((t) =>
            t.id === teamId
              ? {
                  ...t,
                  memberIds: t.memberIds.filter((id) => id !== userId),
                  lead: t.lead === userId ? undefined : t.lead,
                }
              : t,
          ),
        );
        const orgId = teams.find((t) => t.id === teamId)?.orgId;
        if (orgId) void setUserTeam(userId, orgId, null).then(reportIfFailed("The team member"));
      },
      moveTeamMember: (fromTeamId, toTeamId, userId) => {
        setTeams((current) =>
          current.map((t) => {
            if (t.id === fromTeamId) {
              return {
                ...t,
                memberIds: t.memberIds.filter((id) => id !== userId),
                lead: t.lead === userId ? undefined : t.lead,
              };
            }
            if (t.id === toTeamId && !t.memberIds.includes(userId)) {
              return { ...t, memberIds: [...t.memberIds, userId] };
            }
            return t;
          }),
        );
        const orgId = teams.find((t) => t.id === toTeamId)?.orgId ?? teams.find((t) => t.id === fromTeamId)?.orgId;
        if (orgId) void setUserTeam(userId, orgId, toTeamId).then(reportIfFailed("The team move"));
      },
      isDepartmentNameTaken: (orgId, name, exceptId) =>
        departments.some(
          (d) => d.orgId === orgId && d.id !== exceptId && normalize(d.name) === normalize(name),
        ),
      isTeamNameTaken: (departmentId, name, exceptId) =>
        teams.some(
          (t) => t.departmentId === departmentId && t.id !== exceptId && normalize(t.name) === normalize(name),
        ),
      roles,
      rolesFor,
      roleMembers,
      // Was a match on the role's name OR its base privilege across every
      // organization, so each "Admin" row counted both organizations' admins and a
      // custom employee-level role counted every Employee too (FD-037, FD-067).
      roleUserCount: (role) => roleMembers(role).length,
      defaultRoleName,
      activeAdminCount: adminCountIn(),
      activeAdminCountIn: (orgId) => adminCountIn(orgId),
      isAdminIn,
      isRoleNameTaken: (name, exceptId, orgId) =>
        roles.some(
          (r) =>
            r.id !== exceptId &&
            (!orgId || inOrg(r, orgId)) &&
            normalize(r.name) === normalize(name),
        ),
      createRole: (input) => {
        const tempId = `R-pending-${Date.now()}`;
        const orgId = input.orgId ?? fallbackOrgId();
        const role: Role = { ...input, id: tempId, orgId, baseRole: baseRoleFor(input.scope), system: false };
        setRoles((current) => [...current, role]);
        if (orgId) {
          void createRoleRow({
            orgId,
            name: input.name,
            description: input.description,
            baseRole: baseRoleFor(input.scope),
            scope: input.scope,
            permissions: input.permissions,
            settings: input.settings,
          }).then((realId) => reconcileId(setRoles, tempId, realId, "The role"));
        }
        return role;
      },
      updateRole: (id, updates) => {
        const before = roles.find((r) => r.id === id);
        if (!before) return;
        // A built-in role stays active whatever the form says (FD-062).
        const safe: Partial<Role> = before.system ? { ...updates, status: "active" } : updates;
        const nextBase = !before.system && safe.scope !== undefined ? baseRoleFor(safe.scope) : undefined;
        setRoles((current) =>
          current.map((r) => (r.id === id ? { ...r, ...safe, ...(nextBase ? { baseRole: nextBase } : {}) } : r)),
        );
        void updateRoleRow(id, {
          name: safe.name,
          description: safe.description,
          scope: safe.scope,
          permissions: safe.permissions,
          settings: safe.settings,
          status: safe.status,
          // A system role refuses this at the database; a custom role follows its scope.
          ...(nextBase ? { baseRole: nextBase } : {}),
        }).then((ok) => {
          if (ok) return;
          setRoles((current) => current.map((r) => (r.id === id ? before : r)));
          saveFailed(`${before.name}`);
        });
      },
      setRoleStatus: (id, status) => {
        const role = roles.find((r) => r.id === id);
        if (!role) return false;
        // The database trigger refuses this for the five built-in roles; refuse it
        // here too rather than show "deactivated" and have it silently bounce (FD-062).
        if (role.system && status !== "active") {
          toast.error(`${role.name} is a built-in role and can't be deactivated.`);
          return false;
        }
        setRoles((current) => current.map((r) => (r.id === id ? { ...r, status } : r)));
        void updateRoleRow(id, { status }).then((ok) => {
          if (ok) return;
          setRoles((current) => current.map((r) => (r.id === id ? { ...r, status: role.status } : r)));
          saveFailed(`${role.name}'s status`);
        });
        return true;
      },
      duplicateRole: (id) => {
        const source = roles.find((r) => r.id === id);
        if (!source) return;
        const orgId = source.orgId ?? fallbackOrgId();
        const taken = (candidate: string) =>
          roles.some((r) => (!orgId || inOrg(r, orgId)) && normalize(r.name) === normalize(candidate));
        let name = `${source.name} (Copy)`;
        let n = 2;
        while (taken(name)) name = `${source.name} (Copy ${n++})`;
        const tempId = `R-pending-${Date.now()}`;
        // The insert used to run inside the setRoles updater, which React may call
        // twice; it now runs once, outside it.
        setRoles((current) => [
          ...current,
          { ...source, id: tempId, name, aliases: [], system: false, orgId, baseRole: baseRoleFor(source.scope) },
        ]);
        if (orgId) {
          void createRoleRow({
            orgId,
            name,
            description: source.description,
            baseRole: baseRoleFor(source.scope),
            scope: source.scope,
            permissions: source.permissions,
            settings: source.settings,
          }).then((realId) => reconcileId(setRoles, tempId, realId, "The copied role"));
        }
      },
      assignRole: (userId, roleId) => {
        const role = roles.find((r) => r.id === roleId);
        const user = users.find((u) => u.id === userId);
        if (!role || !user) return;
        // Only the membership in the role's own organization: the other
        // organization has its own role rows, and used to be handed this one's id.
        const targets = user.memberships.filter((m) => inOrg(role, m.orgId));
        setUsers((current) =>
          current.map((u) =>
            u.id === userId
              ? {
                  ...u,
                  memberships: u.memberships.map((m) =>
                    targets.some((t) => t.orgId === m.orgId) ? { ...m, role: role.name } : m,
                  ),
                }
              : u,
          ),
        );
        // Writes the label AND the privilege. Without the second, the screen
        // would report a permission change that granted nothing.
        for (const membership of targets) {
          void assignRoleRow(userId, membership.orgId, { id: role.id, baseRole: privilegeOf(role) }).then(
            reportIfFailed("The role change"),
          );
        }
        pushActivity(userId, "role-changed", `Role changed to ${role.name}`);
      },
    };
  }, [organizations, departments, teams, users, projects, activeOrgId, countsFor, userActivity, pushActivity, roles, accessibleOrgIds, authenticatedUserId, authenticatedRoles, adminStatus, reconcileId, reloadProjects]);

  return <OrganizationsContext.Provider value={value}>{children}</OrganizationsContext.Provider>;
}

export function useOrganizations() {
  const context = useContext(OrganizationsContext);
  if (!context) throw new Error("useOrganizations must be used inside OrganizationsProvider");
  return context;
}

export const countryOptions = [
  "United Arab Emirates",
  "India",
  "United States",
  "United Kingdom",
  "Singapore",
  "Australia",
  "Canada",
  "Germany",
];

export const timezoneOptions = [
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
];
