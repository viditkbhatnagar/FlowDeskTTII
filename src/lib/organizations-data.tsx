import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  assignRoleRow,
  createDepartmentRow,
  createRoleRow,
  createTeamRow,
  deleteRoleRow,
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

export type NewUserInput = Omit<OrgUser, "id">;

export interface OrgProject {
  id: string;
  name: string;
  orgId: string;
  active: boolean;
}

export type NewOrganization = Omit<Organization, "id">;

const seedOrganizations: Organization[] = [
  {
    id: "ORG-1",
    name: "upCarrera",
    code: "UPC",
    email: "hello@upcarrera.com",
    phone: "+971 4 555 0100",
    website: "https://upcarrera.com",
    country: "United Arab Emirates",
    timezone: "Asia/Dubai",
    status: "active",
  },
  {
    id: "ORG-2",
    name: "Teachers' Training Institute of India",
    code: "TTII",
    email: "contact@ttii.in",
    phone: "+91 22 4000 1200",
    website: "https://ttii.in",
    country: "India",
    timezone: "Asia/Kolkata",
    status: "active",
  },
];

const seedDepartments: Department[] = [
  { id: "D-1", orgId: "ORG-1", name: "Management", head: "Alex Morgan", status: "active" },
  { id: "D-2", orgId: "ORG-1", name: "Product", head: "Sam Chen", status: "active" },
  { id: "D-3", orgId: "ORG-1", name: "Engineering", head: "Jordan Lee", status: "active" },
  { id: "D-4", orgId: "ORG-1", name: "Growth", head: "Riley Park", status: "active" },
  { id: "D-5", orgId: "ORG-1", name: "Operations", head: "Priya Shah", status: "active" },
  { id: "D-6", orgId: "ORG-1", name: "People", head: "Priya Shah", status: "active" },
  { id: "D-7", orgId: "ORG-2", name: "Learning & Growth", head: "Priya Shah", status: "active" },
  { id: "D-8", orgId: "ORG-2", name: "Academics", head: "Meera Iyer", status: "active" },
  { id: "D-9", orgId: "ORG-2", name: "Admissions", head: "Rahul Verma", status: "active" },
  { id: "D-10", orgId: "ORG-2", name: "Operations", head: "Sam Chen", status: "active" },
];

const seedTeams: Team[] = [
  { id: "TM-1", orgId: "ORG-1", departmentId: "D-1", name: "Leadership", lead: "U-1", memberIds: ["U-1", "U-2"], status: "active" },
  { id: "TM-2", orgId: "ORG-1", departmentId: "D-2", name: "Design", lead: "U-4", memberIds: ["U-4"], status: "active" },
  { id: "TM-3", orgId: "ORG-1", departmentId: "D-2", name: "Research", memberIds: [], status: "active" },
  { id: "TM-4", orgId: "ORG-1", departmentId: "D-3", name: "Platform", lead: "U-3", memberIds: ["U-3"], status: "active" },
  { id: "TM-5", orgId: "ORG-1", departmentId: "D-3", name: "Payments", memberIds: [], status: "active" },
  { id: "TM-6", orgId: "ORG-1", departmentId: "D-4", name: "Marketing", lead: "U-5", memberIds: ["U-5"], status: "active" },
  { id: "TM-7", orgId: "ORG-1", departmentId: "D-5", name: "Service Desk", memberIds: [], status: "active" },
  { id: "TM-8", orgId: "ORG-2", departmentId: "D-7", name: "Trainer Enablement", lead: "U-1", memberIds: ["U-1", "U-2", "U-8"], status: "active" },
  { id: "TM-9", orgId: "ORG-2", departmentId: "D-8", name: "Curriculum", lead: "U-6", memberIds: ["U-6"], status: "active" },
  { id: "TM-10", orgId: "ORG-2", departmentId: "D-9", name: "Counselling", lead: "U-7", memberIds: ["U-7"], status: "active" },
  { id: "TM-11", orgId: "ORG-2", departmentId: "D-10", name: "Campus Ops", lead: "U-4", memberIds: ["U-4"], status: "active" },
];

const seedUsers: OrgUser[] = [
  {
    id: "U-1",
    name: "Alex Morgan",
    email: "alex.morgan@upcarrera.com",
    phone: "+971 50 221 8890",
    employeeId: "UPC-0001",
    designation: "Operations Director",
    joiningDate: "2021-03-15",
    status: "active",
    primaryOrgId: "ORG-1",
    memberships: [
      { orgId: "ORG-1", departmentId: "D-1", teamId: "TM-1", role: "Admin", status: "active" },
      {
        orgId: "ORG-2",
        departmentId: "D-7",
        teamId: "TM-8",
        role: "Manager",
        status: "active",
        reportingManagerId: "U-6",
      },
    ],
  },
  {
    id: "U-2",
    name: "Priya Shah",
    email: "priya.shah@upcarrera.com",
    phone: "+971 50 771 4410",
    employeeId: "UPC-0002",
    designation: "People Lead",
    joiningDate: "2021-09-01",
    status: "active",
    primaryOrgId: "ORG-1",
    memberships: [
      {
        orgId: "ORG-1",
        departmentId: "D-6",
        teamId: "TM-1",
        role: "Manager",
        status: "active",
        reportingManagerId: "U-1",
      },
      { orgId: "ORG-2", departmentId: "D-7", teamId: "TM-8", role: "Member", status: "active" },
    ],
  },
  {
    id: "U-3",
    name: "Jordan Lee",
    email: "jordan.lee@upcarrera.com",
    phone: "+971 50 330 7712",
    employeeId: "UPC-0003",
    designation: "Engineering Manager",
    joiningDate: "2022-01-10",
    status: "active",
    primaryOrgId: "ORG-1",
    memberships: [
      {
        orgId: "ORG-1",
        departmentId: "D-3",
        teamId: "TM-4",
        role: "Manager",
        status: "active",
        reportingManagerId: "U-1",
      },
    ],
  },
  {
    id: "U-4",
    name: "Sam Chen",
    email: "sam.chen@upcarrera.com",
    phone: "+971 50 118 2245",
    employeeId: "UPC-0004",
    designation: "Product Manager",
    joiningDate: "2022-06-20",
    status: "active",
    primaryOrgId: "ORG-1",
    memberships: [
      {
        orgId: "ORG-1",
        departmentId: "D-2",
        teamId: "TM-2",
        role: "Member",
        status: "active",
        reportingManagerId: "U-1",
      },
      { orgId: "ORG-2", departmentId: "D-10", teamId: "TM-11", role: "Manager", status: "active" },
    ],
  },
  {
    id: "U-5",
    name: "Riley Park",
    email: "riley.park@upcarrera.com",
    employeeId: "UPC-0005",
    designation: "Growth Lead",
    joiningDate: "2023-02-06",
    status: "active",
    primaryOrgId: "ORG-1",
    memberships: [
      {
        orgId: "ORG-1",
        departmentId: "D-4",
        teamId: "TM-6",
        role: "Member",
        status: "active",
        reportingManagerId: "U-1",
      },
    ],
  },
  {
    id: "U-6",
    name: "Meera Iyer",
    email: "meera.iyer@ttii.in",
    phone: "+91 98200 45512",
    employeeId: "TTII-0001",
    designation: "Academic Head",
    joiningDate: "2020-07-01",
    status: "active",
    primaryOrgId: "ORG-2",
    memberships: [
      { orgId: "ORG-2", departmentId: "D-8", teamId: "TM-9", role: "Admin", status: "active" },
    ],
  },
  {
    id: "U-7",
    name: "Rahul Verma",
    email: "rahul.verma@ttii.in",
    phone: "+91 98330 11245",
    employeeId: "TTII-0002",
    designation: "Admissions Manager",
    joiningDate: "2022-11-14",
    status: "active",
    primaryOrgId: "ORG-2",
    memberships: [
      {
        orgId: "ORG-2",
        departmentId: "D-9",
        teamId: "TM-10",
        role: "Manager",
        status: "active",
        reportingManagerId: "U-6",
      },
    ],
  },
  {
    id: "U-8",
    name: "Neha Kapoor",
    email: "neha.kapoor@ttii.in",
    employeeId: "TTII-0003",
    designation: "Training Coordinator",
    joiningDate: "2024-04-02",
    status: "inactive",
    primaryOrgId: "ORG-2",
    memberships: [
      {
        orgId: "ORG-2",
        departmentId: "D-7",
        teamId: "TM-8",
        role: "Member",
        status: "active",
        reportingManagerId: "U-6",
      },
    ],
  },
];

const seedUserActivity: UserActivity[] = [
  { id: "UA-1", userId: "U-1", type: "created", message: "User account created", at: "2021-03-15T09:00:00Z" },
  { id: "UA-2", userId: "U-1", type: "organization-added", message: "Added to Teachers' Training Institute of India as Manager", at: "2023-05-04T11:20:00Z" },
  { id: "UA-3", userId: "U-8", type: "created", message: "User account created", at: "2024-04-02T08:30:00Z" },
  { id: "UA-4", userId: "U-8", type: "deactivated", message: "Account deactivated", at: "2026-02-11T10:05:00Z" },
];

const seedProjects: OrgProject[] = [
  { id: "P-1", name: "Orbit Web", orgId: "ORG-1", active: true },
  { id: "P-2", name: "Payments", orgId: "ORG-1", active: true },
  { id: "P-3", name: "Platform", orgId: "ORG-1", active: true },
  { id: "P-4", name: "Growth", orgId: "ORG-1", active: true },
  { id: "P-5", name: "Operations", orgId: "ORG-2", active: true },
];

/** Signed-in employee used for permission checks in this prototype. */
export const roleOptions = ["Admin", "Manager", "Member", "Viewer"];

export interface OrgCounts {
  departments: number;
  teams: number;
  users: number;
  activeProjects: number;
}

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

export const permissionModules: { key: string; label: string; items: { key: string; label: string }[] }[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    items: [
      { key: "dashboard.personal", label: "View Personal Dashboard" },
      { key: "dashboard.team", label: "View Team Dashboard" },
      { key: "dashboard.org", label: "View Organization Dashboard" },
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
  {
    key: "calendar",
    label: "Calendar",
    items: [
      { key: "calendar.own", label: "View Own" },
      { key: "calendar.team", label: "View Team" },
      { key: "calendar.org", label: "View Organization" },
      { key: "calendar.events", label: "Create/Edit Events" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    items: [
      { key: "reports.own", label: "View Own" },
      { key: "reports.team", label: "View Team" },
      { key: "reports.org", label: "View Organization" },
      { key: "reports.export", label: "Export" },
    ],
  },
];

export const settingsModules: { key: string; label: string }[] = [
  { key: "settings.organizations", label: "Organizations" },
  { key: "settings.users", label: "Users" },
  { key: "settings.structure", label: "Teams & Departments" },
  { key: "settings.roles", label: "Roles & Permissions" },
  { key: "settings.taskProject", label: "Task & Project Settings" },
  { key: "settings.holidays", label: "Holidays & Working Days" },
];

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
  /** Built-in roles cannot be renamed away from their purpose. */
  system?: boolean;
}

export type NewRoleInput = Omit<Role, "id">;

const allPermissionKeys = permissionModules.flatMap((m) => m.items.map((i) => i.key));
const settingsAll = (access: SettingsAccess) =>
  Object.fromEntries(settingsModules.map((s) => [s.key, access])) as Record<string, SettingsAccess>;

const seedRoles: Role[] = [
  {
    id: "R-1",
    name: "Admin",
    description: "Full application and settings access.",
    status: "active",
    scope: "all",
    permissions: allPermissionKeys,
    settings: settingsAll("manage"),
    aliases: ["Admin"],
    system: true,
  },
  {
    id: "R-2",
    name: "Manager / HOD",
    description:
      "Manage department projects and tasks, assign work and view department-level information.",
    status: "active",
    scope: "department",
    permissions: [
      "dashboard.personal", "dashboard.team", "dashboard.org",
      "mytasks.view", "mytasks.create", "mytasks.edit", "mytasks.delete",
      "teamtasks.view", "teamtasks.create", "teamtasks.assign", "teamtasks.edit",
      "projects.view", "projects.create", "projects.manage",
      "calendar.own", "calendar.team", "calendar.org", "calendar.events",
      "reports.own", "reports.team", "reports.org", "reports.export",
    ],
    settings: { ...settingsAll("none"), "settings.users": "view", "settings.structure": "view" },
    aliases: ["Manager"],
    system: true,
  },
  {
    id: "R-3",
    name: "Team Lead",
    description: "Manage tasks for assigned teams.",
    status: "active",
    scope: "team",
    permissions: [
      "dashboard.personal", "dashboard.team",
      "mytasks.view", "mytasks.create", "mytasks.edit",
      "teamtasks.view", "teamtasks.create", "teamtasks.assign", "teamtasks.edit",
      "projects.view",
      "calendar.own", "calendar.team", "calendar.events",
      "reports.own", "reports.team",
    ],
    settings: settingsAll("none"),
    aliases: ["Team Lead"],
    system: true,
  },
  {
    id: "R-4",
    name: "Employee",
    description: "Manage own tasks and participate in assigned projects.",
    status: "active",
    scope: "own",
    permissions: [
      "dashboard.personal",
      "mytasks.view", "mytasks.create", "mytasks.edit",
      "teamtasks.view",
      "projects.view",
      "calendar.own", "calendar.events",
      "reports.own",
    ],
    settings: settingsAll("none"),
    aliases: ["Employee", "Member"],
    system: true,
  },
  {
    id: "R-5",
    name: "Management / Viewer",
    description: "View organization-level information and reports without operational editing.",
    status: "active",
    scope: "organization",
    permissions: [
      "dashboard.personal", "dashboard.team", "dashboard.org",
      "mytasks.view", "teamtasks.view", "projects.view",
      "calendar.own", "calendar.team", "calendar.org",
      "reports.own", "reports.team", "reports.org", "reports.export",
    ],
    settings: settingsAll("none"),
    aliases: ["Viewer"],
    system: true,
  },
];

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
  addOrganization: (input: NewOrganization) => Organization;
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
  addUser: (input: NewUserInput) => OrgUser;
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
  roleUserCount: (role: Role) => number;
  activeAdminCount: number;
  createRole: (input: NewRoleInput) => Role;
  updateRole: (id: string, updates: Partial<Role>) => void;
  setRoleStatus: (id: string, status: OrgStatus) => void;
  duplicateRole: (id: string) => void;
  isRoleNameTaken: (name: string, exceptId?: string) => boolean;
  assignRole: (userId: string, roleName: string) => void;
};

const OrganizationsContext = createContext<OrganizationsContextValue | null>(null);

export function OrganizationsProvider({ children }: { children: ReactNode }) {
  // Everything starts empty and is loaded from Supabase. These lists used to be
  // seeded from hardcoded arrays of invented people (Alex Morgan, UPC-0001 ...),
  // which meant the admin screens showed convincing data that did not exist and
  // silently discarded every edit.
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [projects, setProjects] = useState<OrgProject[]>(seedProjects);
  const [activeOrgId, setActiveOrgId] = useState<string | "all">("all");
  const [roles, setRoles] = useState<Role[]>([]);
  const [userActivity, setUserActivity] = useState<UserActivity[]>([]);
  const [adminStatus, setAdminStatus] = useState<"loading" | "ready" | "error">("loading");
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null>(null);
  const [accessibleOrgIds, setAccessibleOrgIds] = useState<string[]>([]);
  const [authenticatedRoles, setAuthenticatedRoles] = useState<string[]>([]);

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
      const snapshot = await loadAdminSnapshot();
      if (!active) return;
      if (snapshot) {
        setOrganizations(snapshot.organizations);
        setDepartments(snapshot.departments);
        setTeams(snapshot.teams);
        setUsers(snapshot.users);
        setRoles(snapshot.roles);
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
   * the row is removed again rather than left behind looking saved, and the cause
   * is already in the console from admin-api.
   */
  const reconcileId = useCallback(
    <T extends { id: string }>(
      setter: React.Dispatch<React.SetStateAction<T[]>>,
      tempId: string,
      realId: string | null,
    ) => {
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
      users: users.filter((u) => u.memberships.some((m) => m.orgId === orgId)).length,
      activeProjects: projects.filter((p) => p.orgId === orgId && p.active).length,
    }),
    [departments, teams, users, projects],
  );

  const value = useMemo<OrganizationsContextValue>(() => {
    const normalize = (v: string) => v.trim().toLowerCase();

    // The privilege a role actually carries. Everything else on a role is
    // presentation; this is the single value row-level security consults, so a
    // new role must declare one or it would grant nothing.
    const baseRoleFor = (scope: DataScope): BaseRole =>
      scope === "all" ? "admin"
      : scope === "organization" ? "viewer"
      : scope === "department" ? "manager"
      : scope === "team" ? "team_lead"
      : "employee";

    return {
      organizations,
      departments,
      teams,
      users,
      projects,
      accessibleOrganizations: organizations.filter((organization) => accessibleOrgIds.includes(organization.id)),
      activeOrgId,
      setActiveOrgId,
      countsFor,
      isNameTaken: (name, exceptId) =>
        organizations.some((o) => o.id !== exceptId && normalize(o.name) === normalize(name)),
      isCodeTaken: (code, exceptId) =>
        organizations.some((o) => o.id !== exceptId && normalize(o.code) === normalize(code)),
      addOrganization: (input) => {
        const org: Organization = { ...input, id: `ORG-${organizations.length + 1}-${Date.now()}` };
        setOrganizations((current) => [...current, org]);
        return org;
      },
      updateOrganization: (id, updates) => {
        setOrganizations((current) => current.map((o) => (o.id === id ? { ...o, ...updates } : o)));
        void updateOrganizationRow(id, updates);
      },
      setOrganizationStatus: (id, status) => {
        setOrganizations((current) => current.map((o) => (o.id === id ? { ...o, status } : o)));
        void updateOrganizationRow(id, { status });
      },
      addDepartment: (orgId, name, head) => {
        const tempId = `D-pending-${Date.now()}`;
        setDepartments((current) => [...current, { id: tempId, orgId, name, head, status: "active" }]);
        void createDepartmentRow({ orgId, name, headUserId: resolveUserId(users, head) }).then((realId) =>
          reconcileId(setDepartments, tempId, realId),
        );
      },
      addUserToOrganization: (userId, orgId, membership) =>
        setUsers((current) =>
          current.map((u) =>
            u.id === userId && !u.memberships.some((m) => m.orgId === orgId)
              ? { ...u, memberships: [...u.memberships, { ...membership, orgId, status: "active" }] }
              : u,
          ),
        ),
      userActivity,
      currentUser: users.find((u) => u.id === authenticatedUserId) ?? null,
      canManageUsers: authenticatedRoles.includes("admin"),
      logUserActivity: pushActivity,
      isEmailTaken: (email, exceptId) =>
        users.some((u) => u.id !== exceptId && normalize(u.email) === normalize(email)),
      addUser: (input) => {
        const user: OrgUser = { ...input, id: `U-${users.length + 1}-${Date.now()}` };
        setUsers((current) => [...current, user]);
        pushActivity(user.id, "created", "User account created");
        return user;
      },
      updateUser: (id, updates) => {
        setUsers((current) => current.map((u) => (u.id === id ? { ...u, ...updates } : u)));
        void updateProfileRow(id, {
          name: updates.name,
          phone: updates.phone,
          employeeId: updates.employeeId,
          joiningDate: updates.joiningDate,
          status: updates.status,
        });
      },
      setUserStatus: (id, status) => {
        setUsers((current) => current.map((u) => (u.id === id ? { ...u, status } : u)));
        void updateProfileRow(id, { status });
        pushActivity(
          id,
          status === "active" ? "activated" : "deactivated",
          status === "active" ? "Account activated" : "Account deactivated",
        );
      },
      upsertMembership: (userId, membership) => {
        void upsertMembershipRow(userId, {
          orgId: membership.orgId,
          departmentId: membership.departmentId,
          teamId: membership.teamId,
          roleId: roles.find((r) => normalize(r.name) === normalize(membership.role))?.id ?? null,
          reportingManagerId: membership.reportingManagerId ?? null,
          status: membership.status,
        });
        setUsers((current) =>
          current.map((u) => {
            if (u.id !== userId) return u;
            const exists = u.memberships.some((m) => m.orgId === membership.orgId);
            return {
              ...u,
              memberships: exists
                ? u.memberships.map((m) => (m.orgId === membership.orgId ? { ...m, ...membership } : m))
                : [...u.memberships, membership],
            };
          }),
        );
      },
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
        void removeMembershipRow(userId, orgId);
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
        }).then((realId) => reconcileId(setDepartments, tempId, realId));
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
        });
      },
      setDepartmentStatus: (id, status) => {
        setDepartments((current) => current.map((d) => (d.id === id ? { ...d, status } : d)));
        void updateDepartmentRow(id, { status });
      },
      createTeam: (input) => {
        const tempId = `TM-pending-${Date.now()}`;
        const team: Team = { ...input, id: tempId };
        setTeams((current) => [...current, team]);
        void createTeamRow({
          orgId: input.orgId,
          departmentId: input.departmentId,
          name: input.name,
          leadUserId: resolveUserId(users, input.lead),
        }).then((realId) => {
          reconcileId(setTeams, tempId, realId);
          // Members are a column on the membership row, so they can only be
          // written once the team has a real id.
          if (realId) {
            for (const userId of input.memberIds ?? []) void setUserTeam(userId, input.orgId, realId);
          }
        });
        return team;
      },
      updateTeam: (id, updates) => {
        setTeams((current) => current.map((t) => (t.id === id ? { ...t, ...updates } : t)));
        void updateTeamRow(id, {
          name: updates.name,
          departmentId: updates.departmentId,
          status: updates.status,
          ...(updates.lead !== undefined ? { leadUserId: resolveUserId(users, updates.lead) } : {}),
        });
      },
      setTeamStatus: (id, status) => {
        setTeams((current) => current.map((t) => (t.id === id ? { ...t, status } : t)));
        void updateTeamRow(id, { status });
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
        if (orgId) void setUserTeam(userId, orgId, teamId);
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
        if (orgId) void setUserTeam(userId, orgId, null);
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
        if (orgId) void setUserTeam(userId, orgId, toTeamId);
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
      roleUserCount: (role) => {
        const labels = new Set([role.name, ...role.aliases].map(normalize));
        return users.filter((u) => u.memberships.some((m) => labels.has(normalize(m.role)))).length;
      },
      activeAdminCount: users.filter(
        (u) => u.status === "active" && u.memberships.some((m) => normalize(m.role) === "admin"),
      ).length,
      isRoleNameTaken: (name, exceptId) =>
        roles.some((r) => r.id !== exceptId && normalize(r.name) === normalize(name)),
      createRole: (input) => {
        const tempId = `R-pending-${Date.now()}`;
        const role: Role = { ...input, id: tempId };
        setRoles((current) => [...current, role]);
        const orgId = activeOrgId !== "all" ? activeOrgId : (accessibleOrgIds[0] ?? organizations[0]?.id);
        if (orgId) {
          void createRoleRow({
            orgId,
            name: input.name,
            description: input.description,
            baseRole: baseRoleFor(input.scope),
            scope: input.scope,
            permissions: input.permissions,
            settings: input.settings,
          }).then((realId) => reconcileId(setRoles, tempId, realId));
        }
        return role;
      },
      updateRole: (id, updates) => {
        setRoles((current) => current.map((r) => (r.id === id ? { ...r, ...updates } : r)));
        void updateRoleRow(id, {
          name: updates.name,
          description: updates.description,
          scope: updates.scope,
          permissions: updates.permissions,
          settings: updates.settings,
          status: updates.status,
          // A system role refuses this at the database; a custom role follows its scope.
          ...(updates.scope !== undefined && !roles.find((r) => r.id === id)?.system
            ? { baseRole: baseRoleFor(updates.scope) }
            : {}),
        });
      },
      setRoleStatus: (id, status) => {
        setRoles((current) => current.map((r) => (r.id === id ? { ...r, status } : r)));
        void updateRoleRow(id, { status });
      },
      duplicateRole: (id) =>
        setRoles((current) => {
          const source = current.find((r) => r.id === id);
          if (!source) return current;
          let name = `${source.name} (Copy)`;
          let n = 2;
          while (current.some((r) => normalize(r.name) === normalize(name))) {
            name = `${source.name} (Copy ${n++})`;
          }
          const tempId = `R-pending-${Date.now()}`;
          const orgId = activeOrgId !== "all" ? activeOrgId : (accessibleOrgIds[0] ?? organizations[0]?.id);
          if (orgId) {
            void createRoleRow({
              orgId,
              name,
              description: source.description,
              baseRole: baseRoleFor(source.scope),
              scope: source.scope,
              permissions: source.permissions,
              settings: source.settings,
            }).then((realId) => reconcileId(setRoles, tempId, realId));
          }
          return [...current, { ...source, id: tempId, name, aliases: [], system: false }];
        }),
      assignRole: (userId, roleName) => {
        setUsers((current) =>
          current.map((u) =>
            u.id === userId
              ? { ...u, memberships: u.memberships.map((m) => ({ ...m, role: roleName })) }
              : u,
          ),
        );
        const role = roles.find((r) => normalize(r.name) === normalize(roleName));
        const user = users.find((u) => u.id === userId);
        if (role && user) {
          // Writes the label AND the privilege. Without the second, the screen
          // would report a permission change that granted nothing.
          const base = baseRoleFor(role.scope);
          for (const membership of user.memberships) {
            void assignRoleRow(userId, membership.orgId, { id: role.id, baseRole: base });
          }
        }
        pushActivity(userId, "role-changed", `Role changed to ${roleName}`);
      },
    };
  }, [organizations, departments, teams, users, projects, activeOrgId, countsFor, userActivity, pushActivity, roles, accessibleOrgIds, authenticatedUserId, authenticatedRoles]);

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
