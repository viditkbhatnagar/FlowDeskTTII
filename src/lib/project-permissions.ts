import type { BaseRole } from "./admin-api";

// What the signed-in person may do with a project, by the database's own rule
// (supabase/migrations/20260930000100_project_access.sql). The project screens
// use it to hide controls the database would refuse. It grants nothing:
// row-level security still decides every read and write.
//
// `privileges` are always the person's own permissions (user_roles) in the
// project's organization, as useOrganizations().ownPrivilegesIn gives them.

/** Admins and managers oversee every project in their organization. */
export function hasProjectOversight(privileges: readonly BaseRole[]): boolean {
  return privileges.includes("admin") || privileges.includes("manager");
}

/** Creating a project, a copy included, takes admin, manager or team lead there. */
export function canCreateProjects(privileges: readonly BaseRole[]): boolean {
  return hasProjectOversight(privileges) || privileges.includes("team_lead");
}

/** Only an admin may delete a project. */
export function canDeleteProjects(privileges: readonly BaseRole[]): boolean {
  return privileges.includes("admin");
}

export type ProjectPeople = {
  ownerId: string | null;
  /** The Project Manager. */
  managerId: string | null;
  /** Its team (project_members). */
  memberIds: readonly string[];
};

/**
 * private.can_manage_project: may change the project itself (details, status,
 * team, milestones) and remove other people's files on it. An admin or manager
 * of its organization, its owner, its Project Manager, or a team lead on its
 * team. Anyone else who can open it may still work its tasks, add tasks,
 * comment and upload. Being able to open it already means an active membership
 * in its organization, which the database also requires.
 */
export function canManageProject(
  userId: string | null,
  privileges: readonly BaseRole[],
  project: ProjectPeople,
): boolean {
  if (hasProjectOversight(privileges)) return true;
  if (!userId) return false;
  if (project.ownerId === userId || project.managerId === userId) return true;
  return privileges.includes("team_lead") && project.memberIds.includes(userId);
}
