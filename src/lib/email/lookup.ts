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
  tasksByAssignee: ReadonlyMap<string, SnapshotTask[]>;
  /** Active memberships of organizations in the snapshot, sorted by organization id. */
  activeOrgsByUser: ReadonlyMap<string, string[]>;
  primaryOrgByUser: ReadonlyMap<string, string>;
  /** Every membership (any status) of organizations in the snapshot. */
  memberOrgsByUser: ReadonlyMap<string, string[]>;
  /**
   * Organizations where the person is admin, manager or team_lead AND an active member: they get
   * the management summaries there, and RLS shows them every task with no project.
   */
  managedOrgsByUser: ReadonlyMap<string, string[]>;
  /**
   * Organizations where the person is admin or manager AND an active member: every project there
   * is open to them.
   */
  oversightOrgsByUser: ReadonlyMap<string, string[]>;
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
  };
}

const labelMap = (labels: readonly SnapshotLabel[]) =>
  new Map(labels.map((l) => [`${l.organizationId}:${l.value}`, l.label]));

function buildIndex(snapshot: EmailSnapshot): SnapshotIndex {
  const orgById = new Map(snapshot.organizations.map((org) => [org.id, org]));
  return {
    snapshot,
    orgById,
    personById: new Map(snapshot.people.map((person) => [person.userId, person])),
    prefsByUser: new Map(snapshot.preferences.map((prefs) => [prefs.userId, prefs])),
    taskById: new Map(snapshot.tasks.map((task) => [task.id, task])),
    projectById: new Map(snapshot.projects.map((project) => [project.id, project])),
    tasksByOrg: groupBy(snapshot.tasks, (task) => task.organizationId),
    tasksByAssignee: groupBy(snapshot.tasks, (task) => task.assigneeId),
    ...membershipMaps(snapshot, new Set(orgById.keys())),
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

// The snapshot is read through a SECURITY DEFINER function, so row-level security never narrows
// it. The two checks below are the database's own rule for projects and tasks
// (20260930000100_project_access.sql), applied here so a summary lists only what the app would
// show its recipient. Anything the snapshot cannot settle is left out.

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
 * The work_tasks SELECT policy. A task with no project keeps the older rule: its creator,
 * assignee or reviewer, or an admin, manager or team lead of its organization. A project's task
 * is open to whoever may open the project, and its creator, assignee and reviewer keep it even
 * off the team. A task whose project is not in the snapshot (archived) is shown to admins and
 * managers only.
 */
export function canSeeTask(
  index: SnapshotIndex,
  userId: string,
  task: Pick<
    SnapshotTask,
    "organizationId" | "projectId" | "createdBy" | "assigneeId" | "reviewerId"
  >,
): boolean {
  const own = task.createdBy === userId || task.assigneeId === userId || task.reviewerId === userId;
  if (!task.projectId) {
    return own || (index.managedOrgsByUser.get(userId)?.includes(task.organizationId) ?? false);
  }
  if (own && isActiveMember(index, userId, task.organizationId)) return true;
  if (!index.projectById.has(task.projectId)) {
    return hasOversight(index, userId, task.organizationId);
  }
  return canSeeProject(index, userId, task.projectId);
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
