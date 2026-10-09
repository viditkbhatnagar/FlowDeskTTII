/**
 * Who Team Tasks lists, and each person's workload.
 *
 * Every people list on Team Tasks used to come from task assignees, so a
 * manager saw "3 with tasks" and had no way to reach anyone with nothing
 * assigned (QA bug 6). Since 9 Oct a task is visible to the people involved,
 * the organization's admins and whoever manages its assignee or creator
 * (spec rule c), and the roster follows the same lines: an admin gets the
 * organization's whole active roster, zero-task members included; anyone else
 * gets the people they manage — who report to them, or are in the department
 * they head or the team they lead — plus themselves.
 *
 * No Supabase imports, so this can be unit-tested with plain data.
 */
import type { ManagementIndex } from "./task-permissions";

export const NO_DEPARTMENT = "No department";
/** Assignee filter value for tasks nobody is assigned to. */
export const UNASSIGNED = "__unassigned";
/** Open tasks at which someone counts as fully loaded. */
export const CAPACITY = 10;
/** Shown above the workload when the roster is not a whole organization. */
export const TEAM_NOTE =
  "Your team: people who report to you, your department or your team. Counts include only tasks you can see.";

const isOpen = (status: string) => status !== "done" && status !== "cancelled";

export interface RosterMembership {
  orgId: string;
  departmentId?: string;
  teamId?: string;
  reportingManagerId?: string;
  status: string;
  /** The user_roles privilege, when the viewer can read it (always for their own rows). */
  privilege?: string;
}

export interface RosterUser {
  id: string;
  name: string;
  status: string;
  memberships: readonly RosterMembership[];
}

/** What an avatar needs. Built by the caller so colours match task cards. */
export interface Avatar {
  name: string;
  initials: string;
  color: string;
}

export interface RosterMember extends Avatar {
  id: string;
  /** Department names in the managed organizations; NO_DEPARTMENT when they have none. */
  departments: string[];
}

export interface RosterFilter {
  /** A department name, or "all". */
  department: string;
  /** A person's id, UNASSIGNED, or "all". */
  assignee: string;
  /** A dashboard "assignee:<id>" link: only that person. */
  linkedAssignee?: string;
  /** The search box. It matches task titles and assignee names, so here the name. */
  query?: string;
}

export interface WorkloadTask {
  assigneeId?: string | null;
  assignee: Avatar;
  status: string;
}

export interface WorkloadMember extends Avatar {
  key: string;
  active: number;
  done: number;
  /** Open tasks as a share of CAPACITY, capped at 100. */
  pct: number;
  /** Share of their tasks in view that are finished. */
  productivity: number;
  availability: "Busy" | "Available" | "Free";
}

/**
 * Who the viewer's Team Tasks roster covers in one organization: all of it
 * for an admin (they see every task there), otherwise the people they manage
 * and themselves (the tasks they can see are those people's, their own, and
 * the ones they created, are reviewing or share in a group).
 */
export interface RosterScope {
  orgId: string;
  /** The whole organization (an admin), rather than the people they manage. */
  whole: boolean;
  /** When not whole: the people covered, the viewer included. */
  personIds?: readonly string[];
}

export function rosterScopes(
  viewer: RosterUser | null | undefined,
  management: Pick<ManagementIndex, "managedBy">,
): RosterScope[] {
  if (!viewer) return [];
  const scopes: RosterScope[] = [];
  for (const m of viewer.memberships) {
    if (m.status !== "active" || scopes.some((scope) => scope.orgId === m.orgId)) continue;
    if (m.privilege === "admin") scopes.push({ orgId: m.orgId, whole: true });
    else
      scopes.push({
        orgId: m.orgId,
        whole: false,
        personIds: [viewer.id, ...management.managedBy(viewer.id, m.orgId)],
      });
  }
  return scopes;
}

/** Whether the roster is less than whole organizations, so the page says whose it is. */
export const isPartialRoster = (scopes: readonly RosterScope[]): boolean =>
  scopes.length > 0 && !scopes.every((scope) => scope.whole);

/** Active people with an active membership that falls in one of `scopes`, by name. */
export function buildScopedRoster(
  users: readonly RosterUser[],
  scopes: readonly RosterScope[],
  departmentNames: ReadonlyMap<string, string>,
  avatarFor: (id: string, name: string) => Avatar,
): RosterMember[] {
  if (!scopes.length) return [];
  const inScope = (userId: string, m: RosterMembership) =>
    scopes.some(
      (scope) =>
        scope.orgId === m.orgId && (scope.whole || Boolean(scope.personIds?.includes(userId))),
    );
  const scopedUsers = users.map((user) => ({
    ...user,
    memberships: user.memberships.filter((m) => m.status === "active" && inScope(user.id, m)),
  }));
  return buildRoster(scopedUsers, [...new Set(scopes.map((scope) => scope.orgId))], departmentNames, avatarFor);
}

/**
 * Active people with an active membership in any of `orgIds`, by name.
 *
 * Both statuses matter: colleagues' profiles are readable even after they are
 * deactivated or leave, so their old work keeps a name, but they are not on
 * the team any more.
 */
export function buildRoster(
  users: readonly RosterUser[],
  orgIds: readonly string[],
  departmentNames: ReadonlyMap<string, string>,
  avatarFor: (id: string, name: string) => Avatar,
): RosterMember[] {
  if (!orgIds.length) return [];
  const managed = new Set(orgIds);
  const roster: RosterMember[] = [];
  for (const user of users) {
    if (user.status !== "active") continue;
    const memberships = user.memberships.filter(
      (m) => m.status === "active" && managed.has(m.orgId),
    );
    if (!memberships.length) continue;
    const named = memberships
      .map((m) => (m.departmentId ? departmentNames.get(m.departmentId) : undefined))
      .filter((name): name is string => Boolean(name));
    const { name, initials, color } = avatarFor(user.id, user.name);
    roster.push({
      id: user.id,
      name,
      initials,
      color,
      // Same fallback as a task's department label: any department they have wins over none.
      departments: named.length ? [...new Set(named)].sort() : [NO_DEPARTMENT],
    });
  }
  return roster.sort((a, b) => a.name.localeCompare(b.name));
}

/** The roster members the page's person filters leave in view. */
export function filterRoster(
  roster: readonly RosterMember[],
  filter: RosterFilter,
): RosterMember[] {
  const query = filter.query?.trim().toLowerCase() ?? "";
  return roster.filter(
    (member) =>
      (filter.department === "all" || member.departments.includes(filter.department)) &&
      (filter.assignee === "all" || member.id === filter.assignee) &&
      (!filter.linkedAssignee || member.id === filter.linkedAssignee) &&
      (query === "" || member.name.toLowerCase().includes(query)),
  );
}

/**
 * Assignee filter choices as [id, name], by name: the roster, everyone with a
 * task, and "Unassigned" when some task has nobody.
 */
export function assigneeOptions(
  tasks: readonly WorkloadTask[],
  roster: readonly RosterMember[],
): [string, string][] {
  const byId = new Map<string, string>(roster.map((m) => [m.id, m.name]));
  for (const task of tasks) {
    const id = task.assigneeId ?? UNASSIGNED;
    if (!byId.has(id)) byId.set(id, task.assigneeId ? task.assignee.name : "Unassigned");
  }
  return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
}

/** Department filter choices: those on tasks plus the roster's, so a team with no tasks yet can be picked. */
export function departmentOptions(
  taskDepartments: readonly string[],
  roster: readonly RosterMember[],
): string[] {
  return [...new Set([...taskDepartments, ...roster.flatMap((m) => m.departments)])].sort();
}

/**
 * Workload per person for the tasks in view, busiest first, then by name.
 *
 * Roster members start at zero so people with nothing assigned still appear.
 * Assignees who are not on the roster (a former member, or someone from an
 * organization the viewer does not manage) are kept: their tasks are in view.
 * Keyed by user id, not name, so two people who share a name are not merged.
 */
export function buildWorkload(
  tasks: readonly WorkloadTask[],
  roster: readonly RosterMember[] = [],
): WorkloadMember[] {
  const byPerson = new Map<string, Avatar & { key: string; active: number; done: number }>();
  for (const member of roster) {
    byPerson.set(member.id, {
      key: member.id,
      name: member.name,
      initials: member.initials,
      color: member.color,
      active: 0,
      done: 0,
    });
  }
  for (const task of tasks) {
    if (!task.assigneeId) continue;
    const { name, initials, color } = task.assignee;
    const entry = byPerson.get(task.assigneeId) ?? {
      key: task.assigneeId,
      name,
      initials,
      color,
      active: 0,
      done: 0,
    };
    byPerson.set(task.assigneeId, {
      ...entry,
      done: entry.done + (task.status === "done" ? 1 : 0),
      active: entry.active + (isOpen(task.status) ? 1 : 0),
    });
  }
  return [...byPerson.values()]
    .map((person): WorkloadMember => {
      const total = person.active + person.done;
      const pct = Math.min(100, Math.round((person.active / CAPACITY) * 100));
      return {
        ...person,
        pct,
        productivity: total ? Math.round((person.done / total) * 100) : 0,
        availability: pct > 80 ? "Busy" : pct > 50 ? "Available" : "Free",
      };
    })
    .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
}

/** How many of these people have at least one task in view. */
export const countWithTasks = (members: readonly WorkloadMember[]): number =>
  members.filter((m) => m.active + m.done > 0).length;
