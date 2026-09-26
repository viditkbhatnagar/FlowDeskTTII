import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  assignRoleRow,
  createAccountRpc,
  createDepartmentRow,
  createOrganizationRpc,
  createRoleRow,
  createTeamRow,
  loadAdminSnapshot,
  resendWelcomeRpc,
  removeMembershipRow,
  resolveUserId,
  setUserTeam,
  updateDepartmentRow,
  updateOrganizationRow,
  updateProfileRow,
  updateRoleRow,
  updateTeamRow,
  upsertMembershipRow,
  type AdminRpcError,
  type AdminRpcResult,
  type BaseRole,
  type WriteResult,
} from "@/lib/admin-api";

export type { AdminRpcError, AdminRpcResult } from "@/lib/admin-api";

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
  /**
   * The permission row-level security checks for them here (user_roles), when
   * the caller can see it: admins see it for their organizations. This, not
   * the role's name, decides who counts as an admin.
   */
  privilege?: BaseRole;
  /**
   * The membership points at a role that is not one of this organization's
   * (an old id from another organization, or one the caller cannot read). The
   * role shown is the built-in one matching their permission, and a save that
   * leaves the role alone does not rewrite the permission.
   */
  roleUnreadable?: boolean;
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
  | "updated"
  | "welcome-sent";

export interface UserActivity {
  id: string;
  userId: string;
  type: UserActivityType;
  message: string;
  at: string;
}

/** Add User, for someone who has no account yet. */
export interface NewUserInput {
  name: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  employeeId?: string;
  designation: string;
  joiningDate?: string;
  /** Their first organization: created together with the login. */
  primary: Membership;
  /** Further organizations, added once the account exists. */
  additional: Membership[];
}

export type NewOrganizationInput = Omit<Organization, "id">;

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
  /**
   * Organizations whose task and project settings the signed-in user may
   * change: they hold the admin or manager permission there.
   */
  managedOrganizations: Organization[];
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
  ) => Promise<boolean>;
  isNameTaken: (name: string, exceptId?: string) => boolean;
  isCodeTaken: (code: string, exceptId?: string) => boolean;
  // Users
  userActivity: UserActivity[];
  currentUser: OrgUser | null;
  canManageUsers: boolean;
  /*
   * The writes below update the screen at once and resolve true once
   * everything is saved. When the database refuses (it keeps an active admin in
   * every organization) its reason is shown as a toast, the screen is re-read
   * and they resolve false.
   */
  updateUser: (id: string, updates: Partial<OrgUser>) => Promise<boolean>;
  setUserStatus: (id: string, status: OrgStatus) => Promise<boolean>;
  upsertMembership: (userId: string, membership: Membership) => Promise<boolean>;
  removeMembership: (userId: string, orgId: string) => Promise<boolean>;
  isEmailTaken: (email: string, exceptId?: string) => boolean;
  logUserActivity: (userId: string, type: UserActivityType, message: string) => void;
  /**
   * Create the login and first membership on the server, then any additional
   * organizations, then reload. Resolves with the new user's id, or the
   * server's reason for refusing (nothing is created in that case).
   */
  createUser: (input: NewUserInput) => Promise<AdminRpcResult<string>>;
  /** A new welcome email with a fresh link, for someone who has never signed in. */
  resendWelcome: (userId: string) => Promise<AdminRpcResult<null>>;
  /** Create an organization on the server; the caller becomes its admin. */
  createOrganization: (input: NewOrganizationInput) => Promise<AdminRpcResult<string>>;
  /** Re-read organizations, people, roles and the caller's own access. */
  reload: () => Promise<void>;
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
  /**
   * Active admins, counted the way the database counts them: the admin
   * permission (user_roles), an active membership there and an active account.
   * Not by role name: a membership showing "Employee" can still carry admin.
   */
  activeAdminCount: number;
  activeAdminCountIn: (orgId: string) => number;
  /** Holds the admin permission in this organization, with an active membership there. */
  isAdminIn: (user: OrgUser, orgId: string) => boolean;
  /** Whether this organization's role of that name carries the admin permission. */
  roleGrantsAdmin: (orgId: string, roleName: string) => boolean;
  /** Organizations where this person is the only active admin. */
  soleAdminOrgIds: (user: OrgUser) => string[];
  createRole: (input: NewRoleInput) => Role;
  updateRole: (id: string, updates: Partial<Role>) => Promise<boolean>;
  /** Returns false when refused (built-in roles cannot be deactivated). */
  setRoleStatus: (id: string, status: OrgStatus) => boolean;
  duplicateRole: (id: string) => void;
  isRoleNameTaken: (name: string, exceptId?: string, orgId?: string) => boolean;
  /** Give the user this role in the role's organization — label and privilege. */
  assignRole: (userId: string, roleId: string) => Promise<boolean>;
};

const OrganizationsContext = createContext<OrganizationsContextValue | null>(null);

/**
 * SQLSTATEs admin_create_user raises before creating anything: invalid input,
 * not allowed, too many in a short time, a business rule. Any other failure
 * may have followed a committed account.
 */
const SETTLED_REFUSALS = new Set(["22023", "42501", "PT429", "P0001"]);

/** Optional profile fields Edit User can empty; "" is sent to clear them. */
const CLEARABLE_PROFILE_FIELDS = new Set(["phone", "avatarUrl", "employeeId", "joiningDate"]);

/** A retry's "already has an account" once the reload shows that the person exists. */
const ALREADY_LISTED =
  "They're already in the list — open them to add further organizations.";

const normalize = (v: string) => v.trim().toLowerCase();

const saveFailed = (what: string) =>
  toast.error(`${what} could not be saved. You may not have permission, or the connection dropped.`);

type Outcome = boolean | WriteResult;

const succeeded = (outcome: Outcome) => (typeof outcome === "boolean" ? outcome : outcome.ok);

/**
 * Toast when a write reports failure. A save the database refused on one of
 * its rules shows the database's own reason ("There must always be at least
 * one active admin in …") and calls onRefused; anything else gets the general
 * message. The cause is already in the console from admin-api.
 */
const reportIfFailed = (what: string, onRefused?: () => void) => (outcome: Outcome) => {
  if (succeeded(outcome)) return true;
  const refusal = typeof outcome === "boolean" || outcome.ok ? null : outcome.refusal;
  if (refusal) {
    // One toast however many of a save's writes were refused for the same reason.
    toast.error(refusal, { id: refusal });
    onRefused?.();
  } else {
    saveFailed(what);
  }
  return false;
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

/** Resolves with the people just loaded, or null when nothing was loaded. */
type LoadAll = (isActive: () => boolean, initial: boolean) => Promise<OrgUser[] | null>;

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
  /** Organizations where the caller holds the admin permission (user_roles), which RLS checks. */
  const [adminOrgIds, setAdminOrgIds] = useState<string[]>([]);
  /** Organizations where the caller holds the admin or manager permission. */
  const [managerOrgIds, setManagerOrgIds] = useState<string[]>([]);

  const reloadProjects = useCallback(async () => {
    const loaded = await loadOrgProjects();
    if (loaded) setProjects(loaded);
  }, []);

  /**
   * Load the caller's access and everything the admin screens show. Runs on
   * mount, and again after something is created on the server (a new account,
   * a new organization) so it appears without a page refresh.
   *
   * `initial` is the first load: it may report "error" and picks the caller's
   * primary organization. A later reload that fails keeps what is on screen.
   */
  const loadAll = useCallback<LoadAll>(async (isActive, initial) => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user || !isActive()) return null;
    const [membershipsResult, rolesResult] = await Promise.all([
      supabase
        .from("organization_memberships")
        .select("organization_id, is_primary")
        .eq("user_id", authData.user.id)
        .eq("status", "active"),
      supabase.from("user_roles").select("role, organization_id").eq("user_id", authData.user.id),
    ]);
    const { data: memberships, error: membershipsError } = membershipsResult;
    const { data: assignedRoles, error: rolesError } = rolesResult;
    if (!isActive()) return null;
    setAuthenticatedUserId(authData.user.id);
    // A reload that fails must not strip the caller's access from the screen.
    if (initial || !membershipsError) {
      setAccessibleOrgIds((memberships ?? []).map((membership) => membership.organization_id));
    }
    if (initial || !rolesError) {
      setAuthenticatedRoles((assignedRoles ?? []).map((assignedRole) => assignedRole.role));
      setAdminOrgIds(
        (assignedRoles ?? [])
          .filter((assignedRole) => assignedRole.role === "admin")
          .map((assignedRole) => assignedRole.organization_id),
      );
      setManagerOrgIds(
        (assignedRoles ?? [])
          .filter((assignedRole) => assignedRole.role === "admin" || assignedRole.role === "manager")
          .map((assignedRole) => assignedRole.organization_id),
      );
    }
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
    if (!isActive()) return null;
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
    } else if (initial) {
      setAdminStatus("error");
    }

    if (initial) {
      const primary = memberships?.find((membership) => membership.is_primary)?.organization_id;
      if (primary) setActiveOrgId(primary);
    }
    return snapshot?.users ?? null;
  }, []);

  useEffect(() => {
    let active = true;
    void loadAll(() => active, true);
    return () => {
      active = false;
    };
  }, [loadAll]);

  const reload = useCallback(async () => {
    await loadAll(() => true, false);
  }, [loadAll]);

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
    const roleGrantsAdmin = (orgId: string, name: string) => {
      const role = roleIn(orgId, name);
      return role ? privilegeOf(role) === "admin" : normalize(name) === "admin";
    };
    // By the permission itself, as the database counts admins. It used to go by
    // the role's name, so a sole admin whose membership read "Employee" did not
    // count, and saving them unchanged took the organization's last admin away.
    const isAdminIn = (user: OrgUser, orgId: string) =>
      user.memberships.some(
        (m) => m.orgId === orgId && m.status === "active" && m.privilege === "admin",
      );
    /** The permission a membership will carry once its role is saved. */
    const privilegeFor = (membership: Membership, previous?: Membership): BaseRole | undefined => {
      if (
        previous &&
        normalize(previous.role) === normalize(membership.role) &&
        previous.roleUnreadable
      ) {
        return previous.privilege;
      }
      const role = roleIn(membership.orgId, membership.role);
      return role ? privilegeOf(role) : previous?.privilege;
    };
    // After a refused save the screen showed a change that did not happen.
    const reloadAfterRefusal = () => void reload();
    const report = (what: string) => reportIfFailed(what, reloadAfterRefusal);
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
     * Write one membership: department, team, manager, role label — and, when
     * asked, the privilege too. Without the privilege write a role change on the
     * Users page only relabelled the person (FD-067).
     *
     * is_primary and designation are passed explicitly: the upsert otherwise
     * writes false / null, which cleared them on every assignment edit.
     */
    const persistMembership = async (
      userId: string,
      membership: Membership,
      options: {
        isPrimary: boolean;
        designation?: string;
        writePrivilege: boolean;
        /**
         * The status is unchanged from the loaded copy: leave it to the
         * database. Deactivate switches memberships off and Reactivate back on
         * there, so writing the loaded status back could undo either.
         */
        keepStatus?: boolean;
      },
    ): Promise<boolean> => {
      const role = roleIn(membership.orgId, membership.role);
      const saved = await upsertMembershipRow(userId, {
        orgId: membership.orgId,
        departmentId: membership.departmentId,
        teamId: membership.teamId,
        roleId: role?.id ?? null,
        reportingManagerId: membership.reportingManagerId ?? null,
        status: options.keepStatus ? undefined : membership.status,
        designation: options.designation,
        isPrimary: options.isPrimary,
      });
      if (!report("The organization assignment")(saved)) return false;
      if (options.writePrivilege && role) {
        return report("The role change")(
          await assignRoleRow(userId, membership.orgId, {
            id: role.id,
            baseRole: privilegeOf(role),
          }),
        );
      }
      return true;
    };

    /**
     * Make the permission row-level security reads (user_roles) match the role
     * shown for this membership, without rewriting the rest of it. Idempotent.
     * `membership` is the one as loaded, so it knows whether its role is readable.
     */
    const reassertPrivilege = async (userId: string, membership: Membership): Promise<boolean> => {
      // Only where the caller may write it: RLS refuses anywhere else, and an
      // unchanged row there is not worth an error toast.
      if (!adminOrgIds.includes(membership.orgId)) return true;
      // The role shown stands in for one this organization does not have (or
      // the caller cannot read), so it says nothing about the permission.
      if (membership.roleUnreadable) return true;
      const role = roleIn(membership.orgId, membership.role);
      if (!role || role.id.startsWith("R-pending")) return true;
      return report("The role")(
        await assignRoleRow(userId, membership.orgId, { id: role.id, baseRole: privilegeOf(role) }),
      );
    };

    const sameMembership = (a: Membership, b: Membership) =>
      a.departmentId === b.departmentId &&
      a.teamId === b.teamId &&
      normalize(a.role) === normalize(b.role) &&
      a.reportingManagerId === b.reportingManagerId &&
      a.status === b.status;

    /** The membership as the screen should show it once saved, permission included. */
    const shownMembership = (membership: Membership, previous?: Membership): Membership => {
      const keepsRole =
        !!previous &&
        normalize(previous.role) === normalize(membership.role) &&
        !!previous.roleUnreadable;
      return {
        ...membership,
        privilege: privilegeFor(membership, previous),
        roleUnreadable: keepsRole || undefined,
      };
    };

    const replaceMembership = (userId: string, membership: Membership) =>
      setUsers((current) =>
        current.map((u) => {
          if (u.id !== userId) return u;
          const previous = u.memberships.find((m) => m.orgId === membership.orgId);
          const shown = shownMembership(membership, previous);
          return {
            ...u,
            primaryOrgId: u.primaryOrgId || membership.orgId,
            memberships: previous
              ? u.memberships.map((m) => (m.orgId === membership.orgId ? { ...m, ...shown } : m))
              : [...u.memberships, shown],
          };
        }),
      );

    const upsertMembership = async (userId: string, membership: Membership): Promise<boolean> => {
      const user = users.find((u) => u.id === userId);
      const before = user?.memberships.find((m) => m.orgId === membership.orgId);
      replaceMembership(userId, membership);
      return persistMembership(userId, membership, {
        isPrimary: user?.primaryOrgId ? user.primaryOrgId === membership.orgId : true,
        designation: user?.designation,
        writePrivilege: !before || normalize(before.role) !== normalize(membership.role),
        keepStatus: !!before && before.status === membership.status,
      });
    };

    /**
     * A refusal the server raised on purpose (invalid input, not allowed, too
     * many, a business rule) created nothing. Anything else — the connection
     * dropped, the reply was lost — may have come after the account was
     * committed, so the people list is re-read to show it if it exists.
     */
    const afterFailedCreate = async (
      email: string,
      failed: { ok: false; error: AdminRpcError },
    ): Promise<AdminRpcResult<string>> => {
      if (SETTLED_REFUSALS.has(failed.error.code)) return failed;
      const reloaded = await loadAll(() => true, false);
      const listed = reloaded?.some((u) => normalize(u.email) === normalize(email));
      if (!listed) return failed;
      return {
        ok: false,
        error: {
          code: failed.error.code,
          message:
            failed.error.code === "23505"
              ? ALREADY_LISTED
              : "The account was created, but the reply didn't reach us. They're in the list now — open them to add further organizations.",
        },
      };
    };

    // The database's rule: the admin permission, an active membership there and
    // an active account (private.org_has_other_active_admin).
    const adminCountIn = (orgId?: string) =>
      users.filter(
        (u) =>
          u.status === "active" &&
          u.memberships.some((m) => (!orgId || m.orgId === orgId) && isAdminIn(u, m.orgId)),
      ).length;
    const soleAdminOrgIds = (user: OrgUser) =>
      user.status !== "active"
        ? []
        : user.memberships
            .filter((m) => isAdminIn(user, m.orgId) && adminCountIn(m.orgId) <= 1)
            .map((m) => m.orgId);

    return {
      status: adminStatus,
      organizations,
      departments,
      teams,
      users,
      projects,
      accessibleOrganizations: organizations.filter((organization) => accessibleOrgIds.includes(organization.id)),
      managedOrganizations: organizations.filter(
        (organization) =>
          accessibleOrgIds.includes(organization.id) && managerOrgIds.includes(organization.id),
      ),
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
      updateUser: async (id, updates) => {
        const before = users.find((u) => u.id === id);
        // "" means cleared: stored as NULL, shown as absent.
        const shown = Object.fromEntries(
          Object.entries(updates).map(([key, value]) => [
            key,
            value === "" && CLEARABLE_PROFILE_FIELDS.has(key) ? undefined : value,
          ]),
        ) as Partial<OrgUser>;
        if (updates.memberships) {
          shown.memberships = updates.memberships.map((next) =>
            shownMembership(
              next,
              before?.memberships.find((m) => m.orgId === next.orgId),
            ),
          );
        }
        setUsers((current) => current.map((u) => (u.id === id ? { ...u, ...shown } : u)));
        // The profile goes first, on its own. Deactivate and Reactivate (a
        // status change) switch the person's memberships off or on in the
        // database; the membership writes below then leave their status alone.
        const profileSaved = report("The user's details")(
          await updateProfileRow(id, {
            name: updates.name,
            phone: updates.phone,
            employeeId: updates.employeeId,
            joiningDate: updates.joiningDate,
            status: updates.status,
            avatarUrl: updates.avatarUrl,
          }),
        );
        const writes: Promise<boolean>[] = [Promise.resolve(profileSaved)];
        if (!before) return (await Promise.all(writes)).every(Boolean);
        const statusChanged = updates.status !== undefined && updates.status !== before.status;

        // Department, team, manager, role and designation live on the membership
        // rows. This used to update the screen only, so those edits vanished on
        // reload and the Users and Roles pages disagreed (FD-067).
        const primaryOrgId = before.primaryOrgId;
        const designation = updates.designation ?? before.designation;
        const designationChanged = designation !== before.designation;
        // The permission is written on every save, even when the role name
        // looks unchanged. Before this release every role change saved the name
        // but the permission write failed (42P10), so "Employee" on screen could
        // still carry admin rights; saving the person now repairs that.
        for (const next of updates.memberships ?? []) {
          const previous = before.memberships.find((m) => m.orgId === next.orgId);
          const isPrimary = next.orgId === primaryOrgId;
          if (previous && sameMembership(previous, next) && !(isPrimary && designationChanged)) {
            writes.push(reassertPrivilege(id, previous));
            continue;
          }
          writes.push(
            persistMembership(id, next, {
              isPrimary,
              designation,
              writePrivilege: true,
              keepStatus: !!previous && previous.status === next.status,
            }),
          );
        }
        if (updates.memberships) {
          // Additional access removed in the drawer. The primary is never removed here.
          for (const previous of before.memberships) {
            if (previous.orgId === primaryOrgId) continue;
            if (updates.memberships.some((m) => m.orgId === previous.orgId)) continue;
            writes.push(
              removeMembershipRow(id, previous.orgId).then(report("Removing organization access")),
            );
          }
        }
        const saved = (await Promise.all(writes)).every(Boolean);
        // The database switched their memberships off (or back on) as well.
        if (statusChanged && profileSaved) void reload();
        return saved;
      },
      setUserStatus: async (id, status) => {
        setUsers((current) => current.map((u) => (u.id === id ? { ...u, status } : u)));
        const saved = report("The account status")(await updateProfileRow(id, { status }));
        if (!saved) return false;
        pushActivity(
          id,
          status === "active" ? "activated" : "deactivated",
          status === "active" ? "Account activated" : "Account deactivated",
        );
        // The database switched their memberships off (or back on) as well.
        void reload();
        return true;
      },
      upsertMembership,
      createUser: async (input) => {
        const role = roleIn(input.primary.orgId, input.primary.role);
        if (!role || role.id.startsWith("R-pending")) {
          return {
            ok: false,
            error: { code: "22023", message: "Choose a role that exists in this organization." },
          };
        }
        const created = await createAccountRpc({
          email: input.email,
          fullName: input.name,
          organizationId: input.primary.orgId,
          // The privilege row-level security enforces; roleId keeps the exact
          // (possibly custom) role, whose base_role the server checks matches.
          role: privilegeOf(role),
          details: {
            roleId: role.id,
            departmentId: input.primary.departmentId,
            teamId: input.primary.teamId,
            reportingManagerId: input.primary.reportingManagerId,
            designation: input.designation,
            employeeId: input.employeeId,
            phone: input.phone,
            joiningDate: input.joiningDate,
          },
        });
        if (!created.ok) return afterFailedCreate(input.email, created);

        const userId = created.value;
        // The account exists from here on. What follows is best effort: each
        // failure is reported on its own and can be redone from the user's page.
        if (input.avatarUrl) {
          reportIfFailed("The profile photo")(
            await updateProfileRow(userId, { avatarUrl: input.avatarUrl }),
          );
        }
        for (const membership of input.additional) {
          await persistMembership(userId, membership, { isPrimary: false, writePrivilege: true });
        }
        pushActivity(userId, "created", "Account created and welcome email queued");
        await reload();
        return created;
      },
      resendWelcome: async (userId) => {
        const result = await resendWelcomeRpc(userId);
        if (result.ok) {
          pushActivity(userId, "welcome-sent", "Welcome email sent again with a new link");
        }
        return result;
      },
      createOrganization: async (input) => {
        const created = await createOrganizationRpc({
          name: input.name,
          code: input.code,
          country: input.country,
          timezone: input.timezone,
          details: {
            officialEmail: input.email,
            phone: input.phone,
            website: input.website,
            logoUrl: input.logoUrl,
            status: input.status,
          },
        });
        if (created.ok) await reload();
        return created;
      },
      reload,
      removeMembership: async (userId, orgId) => {
        // The primary organization is never removed; that would leave the account
        // with no route into any workspace.
        const user = users.find((u) => u.id === userId);
        if (!user || user.primaryOrgId === orgId) return false;
        setUsers((current) =>
          current.map((u) =>
            u.id === userId
              ? { ...u, memberships: u.memberships.filter((m) => m.orgId !== orgId) }
              : u,
          ),
        );
        return report("Removing organization access")(await removeMembershipRow(userId, orgId));
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
      roleGrantsAdmin,
      soleAdminOrgIds,
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
      updateRole: async (id, updates) => {
        const before = roles.find((r) => r.id === id);
        if (!before) return false;
        // A built-in role stays active whatever the form says (FD-062).
        const safe: Partial<Role> = before.system ? { ...updates, status: "active" } : updates;
        const nextBase = !before.system && safe.scope !== undefined ? baseRoleFor(safe.scope) : undefined;
        setRoles((current) =>
          current.map((r) => (r.id === id ? { ...r, ...safe, ...(nextBase ? { baseRole: nextBase } : {}) } : r)),
        );
        const outcome = await updateRoleRow(id, {
          name: safe.name,
          description: safe.description,
          scope: safe.scope,
          permissions: safe.permissions,
          settings: safe.settings,
          status: safe.status,
          // A system role refuses this at the database; a custom role follows its scope.
          ...(nextBase ? { baseRole: nextBase } : {}),
        });
        if (!outcome.ok) {
          setRoles((current) => current.map((r) => (r.id === id ? before : r)));
          // A new permission that would leave an organization without an active
          // admin is refused, and the database says so.
          return report(before.name)(outcome);
        }
        // The database moved everyone holding the role to its new permission.
        if (nextBase && nextBase !== before.baseRole) void reload();
        return true;
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
        void updateRoleRow(id, { status }).then((outcome) => {
          if (outcome.ok) return;
          setRoles((current) => current.map((r) => (r.id === id ? { ...r, status: role.status } : r)));
          reportIfFailed(`${role.name}'s status`)(outcome);
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
      assignRole: async (userId, roleId) => {
        const role = roles.find((r) => r.id === roleId);
        const user = users.find((u) => u.id === userId);
        if (!role || !user) return false;
        // Only the membership in the role's own organization: the other
        // organization has its own role rows, and used to be handed this one's id.
        const targets = user.memberships.filter((m) => inOrg(role, m.orgId));
        setUsers((current) =>
          current.map((u) =>
            u.id === userId
              ? {
                  ...u,
                  memberships: u.memberships.map((m) =>
                    targets.some((t) => t.orgId === m.orgId)
                      ? {
                          ...m,
                          role: role.name,
                          privilege: privilegeOf(role),
                          roleUnreadable: undefined,
                        }
                      : m,
                  ),
                }
              : u,
          ),
        );
        // Writes the label AND the privilege. Without the second, the screen
        // would report a permission change that granted nothing.
        const saved = await Promise.all(
          targets.map((membership) =>
            assignRoleRow(userId, membership.orgId, {
              id: role.id,
              baseRole: privilegeOf(role),
            }).then(report("The role change")),
          ),
        );
        if (!saved.every(Boolean)) return false;
        pushActivity(userId, "role-changed", `Role changed to ${role.name}`);
        return true;
      },
    };
  }, [
    organizations,
    departments,
    teams,
    users,
    projects,
    activeOrgId,
    countsFor,
    userActivity,
    pushActivity,
    roles,
    accessibleOrgIds,
    authenticatedUserId,
    authenticatedRoles,
    adminOrgIds,
    managerOrgIds,
    adminStatus,
    reconcileId,
    reloadProjects,
    reload,
    loadAll,
  ]);

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
