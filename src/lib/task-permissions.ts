/**
 * Who may change, move or delete a task (spec of 9 Oct 2026, section B), and
 * who manages whom (rule c), for the screens.
 *
 * Row-level security is the real guard: these functions mirror it so a screen
 * does not offer a control the database would refuse. Sharon's report was
 * "anybody can edit and move it along the queue"; the database now refuses
 * that, and the screens stop offering it.
 *
 * No Supabase imports, so this can be unit-tested with plain data.
 */

/** A membership as loaded for the people screens (organization_memberships). */
export interface MembershipLink {
  userId: string;
  orgId: string;
  status: string;
  departmentId?: string | null;
  teamId?: string | null;
  reportingManagerId?: string | null;
}

/** A department's head or a team's lead (departments.head_user_id, teams.lead_user_id). */
export interface UnitLead {
  id: string;
  orgId: string;
  leadId: string | null;
}

export interface ManagementData {
  memberships: readonly MembershipLink[];
  departmentHeads: readonly UnitLead[];
  teamLeads: readonly UnitLead[];
}

export interface ManagementIndex {
  /**
   * private.manages_person: `personId` has an active membership in `orgId`
   * whose reporting manager is `managerId`, or whose department `managerId`
   * heads, or whose team `managerId` leads; `managerId` is an active member
   * there too. Nobody manages themself.
   */
  manages: (managerId: string, personId: string, orgId: string) => boolean;
  /** Everyone `managerId` manages in `orgId`. */
  managedBy: (managerId: string, orgId: string) => string[];
}

const ACTIVE = "active";

export function indexManagement(data: ManagementData): ManagementIndex {
  const headOf = new Map(data.departmentHeads.map((unit) => [unit.id, unit]));
  const leadOf = new Map(data.teamLeads.map((unit) => [unit.id, unit]));
  const active = data.memberships.filter((m) => m.status === ACTIVE);
  const isActiveIn = (userId: string, orgId: string) =>
    active.some((m) => m.userId === userId && m.orgId === orgId);

  /** Whether this membership puts its person under `managerId`. */
  const reportsTo = (m: MembershipLink, managerId: string) => {
    if (m.userId === managerId) return false;
    if (m.reportingManagerId === managerId) return true;
    const department = m.departmentId ? headOf.get(m.departmentId) : undefined;
    if (department && department.orgId === m.orgId && department.leadId === managerId) return true;
    const team = m.teamId ? leadOf.get(m.teamId) : undefined;
    return Boolean(team && team.orgId === m.orgId && team.leadId === managerId);
  };

  return {
    manages: (managerId, personId, orgId) =>
      Boolean(managerId && personId) &&
      managerId !== personId &&
      isActiveIn(managerId, orgId) &&
      active.some((m) => m.userId === personId && m.orgId === orgId && reportsTo(m, managerId)),
    managedBy: (managerId, orgId) => {
      if (!managerId || !isActiveIn(managerId, orgId)) return [];
      const ids = active
        .filter((m) => m.orgId === orgId && reportsTo(m, managerId))
        .map((m) => m.userId);
      return [...new Set(ids)];
    },
  };
}

/** The fields of a task the rules read. */
export interface PermissionTask {
  organizationId?: string | null;
  createdById?: string | null;
  assigneeId?: string | null;
  reviewerId?: string | null;
  /** Set on one person's part of a group task. */
  parentTaskId?: string | null;
}

export interface TaskViewer {
  /** The signed-in user; null while unknown (nothing is allowed then). */
  id: string | null;
  /** Holds the admin permission in this organization, with an active membership there. */
  isAdminIn: (orgId: string) => boolean;
  /** Rule c, from this viewer: they manage `personId` in `orgId`. */
  manages: (personId: string, orgId: string) => boolean;
}

export interface TaskPermissions {
  /** Title, description, dates, priority, tags, blocked. */
  canEdit: boolean;
  /** Its status: Kanban drag-and-drop, status pickers and buttons. */
  canMove: boolean;
  canDelete: boolean;
  /**
   * A group's assignee stays empty: its people are its children. Who has a part
   * is the group's to change (its creator or an admin), not the part's person.
   */
  canChangeAssignee: boolean;
  /** A group's progress comes from its people, so it takes no subtasks. */
  canEditSubtasks: boolean;
  /** Remove other people's files and links (private.can_manage_task); anyone removes their own. */
  canManageFiles: boolean;
  /**
   * Its comments, files, subtasks and activity (private.can_access_task: rules
   * a to d). False only for someone in the same group looking at another
   * person's part, who sees the part itself but not what is inside it.
   */
  canCollaborate: boolean;
}

export const NO_PERMISSIONS: TaskPermissions = {
  canEdit: false,
  canMove: false,
  canDelete: false,
  canChangeAssignee: false,
  canEditSubtasks: false,
  canManageFiles: false,
  canCollaborate: false,
};

/**
 * Section B. UPDATE: the creator, assignee, reviewer, an admin of the
 * organization, or someone who manages the assignee. A group parent: only its
 * creator and admins, and never its status (each member moves their own
 * part). DELETE: the creator or an admin.
 */
export function taskPermissions(
  task: PermissionTask,
  isGroupParent: boolean,
  viewer: TaskViewer,
): TaskPermissions {
  const me = viewer.id;
  if (!me) return NO_PERMISSIONS;
  const orgId = task.organizationId ?? null;
  const admin = orgId ? viewer.isAdminIn(orgId) : false;
  const creator = Boolean(task.createdById) && task.createdById === me;
  const canDelete = creator || admin;

  if (isGroupParent) {
    const canEdit = creator || admin;
    return {
      canEdit,
      canMove: false,
      canDelete,
      canChangeAssignee: false,
      canEditSubtasks: false,
      canManageFiles: canEdit,
      // Whoever can see a group task may also work on it (rule d: its people).
      canCollaborate: true,
    };
  }

  const assignee = Boolean(task.assigneeId) && task.assigneeId === me;
  const reviewer = Boolean(task.reviewerId) && task.reviewerId === me;
  const managesAssignee = Boolean(
    orgId && task.assigneeId && viewer.manages(task.assigneeId, orgId),
  );
  const canEdit = creator || assignee || reviewer || admin || managesAssignee;
  const managesCreator = Boolean(
    orgId && task.createdById && viewer.manages(task.createdById, orgId),
  );
  const isPart = Boolean(task.parentTaskId);
  return {
    canEdit,
    canMove: canEdit,
    canDelete,
    // A part's creator is the group's creator (create_group_task).
    canChangeAssignee: isPart ? creator || admin : canEdit,
    canEditSubtasks: canEdit,
    canManageFiles: creator || admin || managesAssignee,
    canCollaborate: canEdit || managesCreator,
  };
}

/** Why a status control is read-only, for its hint. */
export const READ_ONLY_HINT = "You can see this task but not change it";
