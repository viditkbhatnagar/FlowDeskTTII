import type { PreferenceKind } from "./kinds";
import type {
  EmailSnapshot,
  SnapshotOrganization,
  SnapshotPerson,
  SnapshotLabel,
  SnapshotPreferences,
  SnapshotProject,
  SnapshotProjectCount,
  SnapshotTask,
} from "./snapshot";
import { localParts } from "./time";

// Lookups over one worker snapshot, shared by the planner and the composer.

export const MANAGEMENT_ROLES: ReadonlySet<string> = new Set(["admin", "manager", "team_lead"]);
/** Every project in the organization is open to them (private.has_project_oversight). */
export const OVERSIGHT_ROLES: ReadonlySet<string> = new Set(["admin", "manager"]);
/** Every task in the organization is open to them (private.can_view_task, rule b). */
const ADMIN_ROLES: ReadonlySet<string> = new Set(["admin"]);

export const isOpenTask = (task: Pick<SnapshotTask, "status">) =>
  task.status !== "done" && task.status !== "cancelled";

export const isEligiblePerson = (person: SnapshotPerson | undefined): person is SnapshotPerson =>
  Boolean(person && person.status === "active" && person.email?.trim());

export type SnapshotIndex = {
  snapshot: EmailSnapshot;
  orgById: ReadonlyMap<string, SnapshotOrganization>;
  personById: ReadonlyMap<string, SnapshotPerson>;
  prefsByUser: ReadonlyMap<string, SnapshotPreferences>;
  taskById: ReadonlyMap<string, SnapshotTask>;
  projectById: ReadonlyMap<string, SnapshotProject>;
  tasksByOrg: ReadonlyMap<string, SnapshotTask[]>;
  /** Each person's own work. A group's parent belongs to no one: each person has their child. */
  tasksByAssignee: ReadonlyMap<string, SnapshotTask[]>;
  /** A group task's non-archived children in the snapshot, by the group's (parent's) id. */
  childrenByParent: ReadonlyMap<string, SnapshotTask[]>;
  /** Active memberships of organizations in the snapshot, sorted by organization id. */
  activeOrgsByUser: ReadonlyMap<string, string[]>;
  primaryOrgByUser: ReadonlyMap<string, string>;
  /** Every membership (any status) of organizations in the snapshot. */
  memberOrgsByUser: ReadonlyMap<string, string[]>;
  /**
   * Organizations where the person is admin, manager or team_lead AND an active member: they get
   * the management summaries there. Which tasks those show is canSeeTask's business.
   */
  managedOrgsByUser: ReadonlyMap<string, string[]>;
  /**
   * Organizations where the person is admin or manager AND an active member: every project there
   * is open to them.
   */
  oversightOrgsByUser: ReadonlyMap<string, string[]>;
  /** Organizations where the person is admin AND an active member: every task there is open. */
  adminOrgsByUser: ReadonlyMap<string, string[]>;
  /**
   * `${organizationId}:${personId}` → who manages that person there (private.manages_person).
   * Empty for a snapshot without reporting lines, so nobody manages anybody.
   */
  managersOf: ReadonlyMap<string, ReadonlySet<string>>;
  projectRoleLabels: ReadonlyMap<string, string | null>;
  projectCountById: ReadonlyMap<string, SnapshotProjectCount>;
  priorityLabels: ReadonlyMap<string, string>;
  statusLabels: ReadonlyMap<string, string>;
};

export function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    if (value === null) continue;
    // Appended in place: the arrays are this function's own until it returns, and copying them
    // on every item made grouping thousands of tasks quadratic.
    const group = groups.get(value);
    if (group) group.push(item);
    else groups.set(value, [item]);
  }
  return groups;
}

const orgIdsByUser = (rows: readonly { userId: string; organizationId: string }[]) =>
  new Map(
    [...groupBy(rows, (m) => m.userId)].map(([userId, group]) => [
      userId,
      [...new Set(group.map((m) => m.organizationId))].sort(),
    ]),
  );

function membershipMaps(snapshot: EmailSnapshot, orgIds: ReadonlySet<string>) {
  const known = snapshot.memberships.filter((m) => orgIds.has(m.organizationId));
  const active = known.filter((m) => m.status === "active");
  const activeOrgsByUser = orgIdsByUser(active);
  const primaryOrgByUser = new Map(
    [...activeOrgsByUser].map(([userId, orgs]) => {
      const primary = active.find((m) => m.userId === userId && m.isPrimary);
      return [userId, primary?.organizationId ?? orgs[0]];
    }),
  );
  // A role counts only where the membership is active, as in the database's helpers.
  const holding = (roles: ReadonlySet<string>) =>
    orgIdsByUser(
      snapshot.roles.filter(
        (r) => roles.has(r.role) && activeOrgsByUser.get(r.userId)?.includes(r.organizationId),
      ),
    );
  return {
    activeOrgsByUser,
    primaryOrgByUser,
    memberOrgsByUser: orgIdsByUser(known),
    managedOrgsByUser: holding(MANAGEMENT_ROLES),
    oversightOrgsByUser: holding(OVERSIGHT_ROLES),
    adminOrgsByUser: holding(ADMIN_ROLES),
  };
}

/**
 * private.manages_person, for every active membership at once: the person's reporting manager,
 * the head of their department and the lead of their team there, each only with an active
 * membership in that organization, and never the person themself. A department or team of
 * another organization manages no one here.
 *
 * A snapshot RPC from before the reporting lines (no departments or teams) cannot settle any of
 * this, so the map stays empty and only admins and a task's own people see it (fail closed).
 */
function managerMap(
  snapshot: EmailSnapshot,
  activeOrgsByUser: ReadonlyMap<string, string[]>,
): Map<string, Set<string>> {
  const managers = new Map<string, Set<string>>();
  if (!Array.isArray(snapshot.departments) || !Array.isArray(snapshot.teams)) return managers;
  const departmentById = new Map(snapshot.departments.map((d) => [d.id, d]));
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
  for (const m of snapshot.memberships) {
    if (m.status !== "active") continue;
    const orgId = m.organizationId;
    const department = m.departmentId ? departmentById.get(m.departmentId) : undefined;
    const team = m.teamId ? teamById.get(m.teamId) : undefined;
    const candidates = [
      m.reportingManagerId,
      department?.organizationId === orgId ? department.headUserId : null,
      team?.organizationId === orgId ? team.leadUserId : null,
    ];
    for (const managerId of candidates) {
      if (typeof managerId !== "string" || managerId === m.userId) continue;
      if (!activeOrgsByUser.get(managerId)?.includes(orgId)) continue;
      const key = `${orgId}:${m.userId}`;
      const set = managers.get(key);
      if (set) set.add(managerId);
      else managers.set(key, new Set([managerId]));
    }
  }
  return managers;
}

const labelMap = (labels: readonly SnapshotLabel[]) =>
  new Map(labels.map((l) => [`${l.organizationId}:${l.value}`, l.label]));

function buildIndex(snapshot: EmailSnapshot): SnapshotIndex {
  const orgById = new Map(snapshot.organizations.map((org) => [org.id, org]));
  const memberships = membershipMaps(snapshot, new Set(orgById.keys()));
  // `?? null`: a snapshot RPC from before group tasks has no parentTaskId, and no groups.
  const childrenByParent = groupBy(
    snapshot.tasks.filter((task) => !task.archivedAt),
    (task) => task.parentTaskId ?? null,
  );
  return {
    snapshot,
    orgById,
    personById: new Map(snapshot.people.map((person) => [person.userId, person])),
    prefsByUser: new Map(snapshot.preferences.map((prefs) => [prefs.userId, prefs])),
    taskById: new Map(snapshot.tasks.map((task) => [task.id, task])),
    projectById: new Map(snapshot.projects.map((project) => [project.id, project])),
    tasksByOrg: groupBy(snapshot.tasks, (task) => task.organizationId),
    // A parent has no assignee anyway; left out by name so it can never read as someone's work.
    tasksByAssignee: groupBy(
      snapshot.tasks.filter((task) => !childrenByParent.has(task.id)),
      (task) => task.assigneeId,
    ),
    childrenByParent,
    ...memberships,
    managersOf: managerMap(snapshot, memberships.activeOrgsByUser),
    projectRoleLabels: new Map(
      snapshot.projectMembers.map((m) => [`${m.projectId}:${m.userId}`, m.roleLabel]),
    ),
    // `?? []`: a snapshot from an RPC that predates projectCounts must not stop every email.
    projectCountById: new Map((snapshot.projectCounts ?? []).map((c) => [c.projectId, c])),
    priorityLabels: labelMap(snapshot.priorityLabels),
    statusLabels: labelMap(snapshot.statusLabels),
  };
}

const indexCache = new WeakMap<EmailSnapshot, SnapshotIndex>();

/** Memoized per snapshot object, so composing a batch of rows indexes once. */
export function indexSnapshot(snapshot: EmailSnapshot): SnapshotIndex {
  const cached = indexCache.get(snapshot);
  if (cached) return cached;
  const index = buildIndex(snapshot);
  indexCache.set(snapshot, index);
  return index;
}

export const isActiveMember = (index: SnapshotIndex, userId: string, orgId: string) =>
  index.activeOrgsByUser.get(userId)?.includes(orgId) ?? false;

const hasOversight = (index: SnapshotIndex, userId: string, orgId: string) =>
  index.oversightOrgsByUser.get(userId)?.includes(orgId) ?? false;

const isOrgAdmin = (index: SnapshotIndex, userId: string, orgId: string) =>
  index.adminOrgsByUser.get(userId)?.includes(orgId) ?? false;

/**
 * private.manages_person: `managerId` is `personId`'s reporting manager, department head or team
 * lead in the organization, both with active memberships there. Nobody manages themself.
 */
export const managesPerson = (
  index: SnapshotIndex,
  managerId: string,
  personId: string,
  orgId: string,
) => index.managersOf.get(`${orgId}:${personId}`)?.has(managerId) ?? false;

/**
 * A group task's parent: the snapshot holds at least one of its children. Never anyone's own work
 * (it has no assignee); each person's part is their child.
 */
export const isGroupParent = (index: SnapshotIndex, task: Pick<SnapshotTask, "id">) =>
  index.childrenByParent.has(task.id);

// The snapshot is read through a SECURITY DEFINER function, so row-level security never narrows
// it. The two checks below are the database's own rules for projects
// (20260930000100_project_access.sql) and tasks (private.can_view_task, 9 Oct 2026), applied
// here so a summary lists only what the app would show its recipient. Anything the snapshot
// cannot settle is left out.

/**
 * private.can_access_project: an admin or manager of the project's organization, or its owner,
 * its Project Manager or someone on its team, with an active membership there. Team leads get in
 * only those three ways. Archived projects are not in the snapshot, so they are closed here; a
 * project from a snapshot RPC without ownerId is open to admins and managers only.
 */
export function canSeeProject(index: SnapshotIndex, userId: string, projectId: string): boolean {
  const project = index.projectById.get(projectId);
  if (!project || !isActiveMember(index, userId, project.organizationId)) return false;
  if (hasOversight(index, userId, project.organizationId)) return true;
  if (typeof project.ownerId !== "string") return false;
  return (
    project.ownerId === userId ||
    project.managerId === userId ||
    index.projectRoleLabels.has(`${projectId}:${userId}`)
  );
}

/**
 * private.can_view_task, the work_tasks SELECT policy. With an active membership in the task's
 * organization, the viewer:
 *   a. created it, or is its assignee or reviewer;
 *   b. is an admin of the organization;
 *   c. manages its assignee or its creator there (managesPerson);
 *   d. is the assignee of one of its non-archived children (a group's members see the group);
 *   e. has a part in the same group (a group's members see each other's parts).
 * Being on the project's team, or a manager or team lead by role, shows nobody else's tasks.
 */
export function canSeeTask(
  index: SnapshotIndex,
  userId: string,
  task: Pick<SnapshotTask, "id" | "organizationId" | "createdBy" | "assigneeId" | "reviewerId"> &
    Partial<Pick<SnapshotTask, "parentTaskId">>,
): boolean {
  const orgId = task.organizationId;
  if (!isActiveMember(index, userId, orgId)) return false;
  if (task.createdBy === userId || task.assigneeId === userId || task.reviewerId === userId) {
    return true;
  }
  if (isOrgAdmin(index, userId, orgId)) return true;
  const people = [task.assigneeId, task.createdBy];
  if (people.some((personId) => personId && managesPerson(index, userId, personId, orgId))) {
    return true;
  }
  const hasPartIn = (groupId: string) =>
    (index.childrenByParent.get(groupId) ?? []).some((child) => child.assigneeId === userId);
  return hasPartIn(task.id) || Boolean(task.parentTaskId && hasPartIn(task.parentTaskId));
}

export const kindEnabledForOrg = (org: SnapshotOrganization | undefined, kind: PreferenceKind) =>
  Boolean(org && org.settings.enabled && org.settings[kind] !== false);

/** A missing preferences row means every kind is on. */
export const preferenceOn = (index: SnapshotIndex, userId: string, kind: PreferenceKind) =>
  index.prefsByUser.get(userId)?.[kind] !== false;

export const orgToday = (org: SnapshotOrganization, now: Date) =>
  localParts(now, org.timezone).date;

export function firstNameOf(person: Pick<SnapshotPerson, "fullName" | "email">): string {
  const first = person.fullName?.trim().split(/\s+/)[0];
  if (first) return first;
  const local = person.email?.trim().split("@")[0];
  return local || "there";
}

export const UNKNOWN_NAME = "A teammate";

/** A colleague's name as the emails print it: full name, else username, as the app does. */
export function displayName(index: SnapshotIndex, userId: string | null): string {
  const person = userId ? index.personById.get(userId) : undefined;
  return person?.fullName?.trim() || person?.username?.trim() || UNKNOWN_NAME;
}

/**
 * Whether profiles RLS lets `viewerId` see `userId`'s profile: the person has a membership (any
 * status) in an organization where the viewer is an active member.
 */
export function canSeeProfile(index: SnapshotIndex, viewerId: string, userId: string): boolean {
  if (viewerId === userId) return true;
  const viewerOrgs = index.activeOrgsByUser.get(viewerId) ?? [];
  return (index.memberOrgsByUser.get(userId) ?? []).some((orgId) => viewerOrgs.includes(orgId));
}

/**
 * A task can be assigned to someone outside its organization, so a summary names a person only
 * when the app would show the recipient that name.
 */
export const colleagueName = (index: SnapshotIndex, viewerId: string, userId: string) =>
  canSeeProfile(index, viewerId, userId) ? displayName(index, userId) : UNKNOWN_NAME;

const titleCase = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

export function priorityLabel(index: SnapshotIndex, orgId: string, value: string): string {
  return index.priorityLabels.get(`${orgId}:${value}`)?.trim() || titleCase(value);
}

/** What the app calls each status when the organization has not renamed it (task-settings-data.tsx). */
const DEFAULT_STATUS_LABELS: ReadonlyMap<string, string> = new Map([
  ["todo", "To Do"],
  ["progress", "In Progress"],
  ["review", "Waiting Approval"],
  ["done", "Completed"],
  ["cancelled", "Cancelled"],
]);

/** The organization's name for a status, else the app's default: "Waiting Approval" for review. */
export function statusLabel(index: SnapshotIndex, orgId: string, value: string): string {
  return (
    index.statusLabels.get(`${orgId}:${value}`)?.trim() ||
    DEFAULT_STATUS_LABELS.get(value) ||
    titleCase(value)
  );
}

export const projectNameOf = (index: SnapshotIndex, projectId: string | null) =>
  (projectId && index.projectById.get(projectId)?.name) || "";

export const appUrls = (appUrl: string) => ({
  myTasks: `${appUrl}/my-tasks`,
  team: `${appUrl}/team`,
  dashboard: `${appUrl}/`,
  myTask: (taskId: string) => `${appUrl}/my-tasks?task=${encodeURIComponent(taskId)}`,
  teamTask: (taskId: string) => `${appUrl}/team?task=${encodeURIComponent(taskId)}`,
  project: (projectId: string) => `${appUrl}/projects?project=${encodeURIComponent(projectId)}`,
});

/** Organizations whose content may appear in a person's `kind` email, in a stable order. */
export function contentOrgs(
  index: SnapshotIndex,
  userId: string,
  kind: PreferenceKind,
  management: boolean,
): SnapshotOrganization[] {
  const orgIds = (management ? index.managedOrgsByUser : index.activeOrgsByUser).get(userId) ?? [];
  return orgIds
    .map((id) => index.orgById.get(id))
    .filter((org): org is SnapshotOrganization => kindEnabledForOrg(org, kind))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
