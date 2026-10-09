/**
 * What the signed-in user may do with each task, for the screens (spec of
 * 9 Oct 2026, section B). The rules are in task-permissions.ts; this hook
 * feeds them what the app has loaded: the user's own permission per
 * organization, colleagues' memberships (reporting manager, department, team)
 * and the departments' heads and teams' leads.
 *
 * Row-level security still decides. A screen built on this simply does not
 * offer what the database would refuse.
 */
import { useCallback, useMemo } from "react";
import { useOrganizations } from "@/lib/organizations-data";
import {
  indexManagement,
  taskPermissions,
  type ManagementIndex,
  type MembershipLink,
  type TaskPermissions,
  type TaskViewer,
} from "@/lib/task-permissions";
import { useWorkspace, type WorkspaceTask } from "@/lib/workspace-data";

export interface TaskAccess {
  viewer: TaskViewer;
  management: ManagementIndex;
  permissionsFor: (task: WorkspaceTask) => TaskPermissions;
  /** Whether this task is a group (a parent with people in it). */
  isGroup: (task: WorkspaceTask) => boolean;
}

export function useTaskAccess(): TaskAccess {
  const { users, currentUserId, ownPrivilegesIn } = useOrganizations();
  const { groups, unitLeads } = useWorkspace();

  const management = useMemo(() => {
    const memberships: MembershipLink[] = users.flatMap((user) =>
      user.memberships.map((m) => ({
        userId: user.id,
        orgId: m.orgId,
        status: m.status,
        departmentId: m.departmentId ?? null,
        teamId: m.teamId ?? null,
        reportingManagerId: m.reportingManagerId ?? null,
      })),
    );
    return indexManagement({ memberships, ...unitLeads });
  }, [users, unitLeads]);

  const viewer = useMemo<TaskViewer>(
    () => ({
      id: currentUserId,
      isAdminIn: (orgId) => ownPrivilegesIn(orgId).includes("admin"),
      manages: (personId, orgId) =>
        currentUserId ? management.manages(currentUserId, personId, orgId) : false,
    }),
    [currentUserId, ownPrivilegesIn, management],
  );

  const isGroup = useCallback((task: WorkspaceTask) => groups.groups.has(task.id), [groups]);
  const permissionsFor = useCallback(
    (task: WorkspaceTask) => taskPermissions(task, groups.groups.has(task.id), viewer),
    [groups, viewer],
  );

  return { viewer, management, permissionsFor, isGroup };
}
