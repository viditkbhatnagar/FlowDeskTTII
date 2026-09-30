// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  ADMIN,
  DAN,
  DUBAI,
  KOLKATA,
  LEAD,
  MAYA,
  PROJECT,
  baseSnapshot,
  membership,
  project,
  role,
  task,
} from "./fixtures";
import { canSeeProject, canSeeTask, indexSnapshot } from "./lookup";
import type { EmailSnapshot, SnapshotProject } from "./snapshot";

// The database's rule for who may open a project and see a task
// (20260930000100_project_access.sql), as the email worker applies it to its snapshot.
// In the base snapshot the admin owns and manages PROJECT (upCarrera), Maya is on its team, and
// Dan and the lead are plain employees there.

/** The base snapshot with the lead made a team lead in upCarrera. */
const withDubaiLead = (overrides: Partial<EmailSnapshot> = {}) => {
  const base = baseSnapshot(overrides);
  return {
    ...base,
    roles: [
      ...base.roles.filter((r) => !(r.userId === LEAD && r.organizationId === DUBAI)),
      role(LEAD, DUBAI, "team_lead"),
    ],
  };
};

const seesProject = (snapshot: EmailSnapshot, userId: string, projectId = PROJECT) =>
  canSeeProject(indexSnapshot(snapshot), userId, projectId);

const seesTask = (snapshot: EmailSnapshot, userId: string, taskOverrides = {}) =>
  canSeeTask(indexSnapshot(snapshot), userId, task(taskOverrides));

describe("canSeeProject", () => {
  test("open to the organization's admins and managers, its owner, Project Manager and team", () => {
    const snapshot = baseSnapshot({
      roles: [...baseSnapshot().roles.filter((r) => r.userId !== DAN), role(DAN, DUBAI, "manager")],
    });
    expect(seesProject(snapshot, ADMIN)).toBe(true);
    expect(seesProject(snapshot, DAN)).toBe(true); // manager, not on the team
    expect(seesProject(snapshot, MAYA)).toBe(true); // on the team
    expect(seesProject(baseSnapshot(), DAN)).toBe(false); // an employee off the team
    const owned = baseSnapshot({ projects: [project({ ownerId: DAN, managerId: null })] });
    expect(seesProject(owned, DAN)).toBe(true);
    const managed = baseSnapshot({ projects: [project({ managerId: DAN })] });
    expect(seesProject(managed, DAN)).toBe(true);
  });

  test("a team lead gets in only as owner, Project Manager or team member", () => {
    expect(seesProject(withDubaiLead(), LEAD)).toBe(false);
    expect(seesProject(withDubaiLead({ projects: [project({ ownerId: LEAD })] }), LEAD)).toBe(true);
    expect(seesProject(withDubaiLead({ projects: [project({ managerId: LEAD })] }), LEAD)).toBe(
      true,
    );
    const member = withDubaiLead({
      projectMembers: [{ projectId: PROJECT, userId: LEAD, roleLabel: null }],
    });
    expect(seesProject(member, LEAD)).toBe(true);
  });

  test("closed to anyone without an active membership in the project's organization", () => {
    const base = baseSnapshot({ projects: [project({ ownerId: LEAD })] });
    const left = {
      ...base,
      memberships: [
        ...base.memberships.filter((m) => !(m.userId === LEAD && m.organizationId === DUBAI)),
        membership(LEAD, DUBAI, false, "inactive"),
      ],
    };
    expect(seesProject(left, LEAD)).toBe(false);
    // An admin of another organization is no one here.
    const tti = baseSnapshot({ projects: [project({ organizationId: KOLKATA })] });
    expect(seesProject(tti, ADMIN)).toBe(false);
  });

  test("an unknown or archived project is closed, even to its admin", () => {
    expect(seesProject(baseSnapshot(), ADMIN, "p-archived")).toBe(false);
  });

  test("without ownerId (an older snapshot RPC) only admins and managers see it", () => {
    const { ownerId: _ownerId, managerId: _managerId, ...legacy } = project();
    const snapshot = baseSnapshot({ projects: [legacy as SnapshotProject] });
    expect(seesProject(snapshot, ADMIN)).toBe(true);
    expect(seesProject(snapshot, MAYA)).toBe(false); // on the team, but fail closed
  });
});

describe("canSeeTask", () => {
  test("a task with no project: its own people, or any admin, manager or team lead there", () => {
    expect(seesTask(baseSnapshot(), MAYA)).toBe(true); // assignee
    expect(seesTask(baseSnapshot(), DAN, { assigneeId: null, reviewerId: DAN })).toBe(true);
    expect(seesTask(baseSnapshot(), DAN, { createdBy: DAN })).toBe(true);
    expect(seesTask(baseSnapshot(), DAN)).toBe(false);
    expect(seesTask(baseSnapshot(), ADMIN, { createdBy: MAYA })).toBe(true);
    expect(seesTask(withDubaiLead(), LEAD)).toBe(true); // team lead, as before
  });

  test("a project's task: whoever may open the project", () => {
    const inProject = { projectId: PROJECT, assigneeId: null };
    expect(seesTask(baseSnapshot(), ADMIN, inProject)).toBe(true);
    expect(seesTask(baseSnapshot(), MAYA, inProject)).toBe(true); // on the team
    expect(seesTask(baseSnapshot(), DAN, inProject)).toBe(false);
    expect(seesTask(withDubaiLead(), LEAD, inProject)).toBe(false); // team lead, off the team
  });

  test("its creator, assignee and reviewer keep it off the team, while still a member there", () => {
    expect(seesTask(baseSnapshot(), DAN, { projectId: PROJECT, assigneeId: DAN })).toBe(true);
    expect(seesTask(baseSnapshot(), DAN, { projectId: PROJECT, reviewerId: DAN })).toBe(true);
    expect(seesTask(baseSnapshot(), DAN, { projectId: PROJECT, createdBy: DAN })).toBe(true);
    const base = baseSnapshot();
    const left = {
      ...base,
      memberships: [
        ...base.memberships.filter((m) => m.userId !== DAN),
        membership(DAN, DUBAI, true, "inactive"),
      ],
    };
    expect(seesTask(left, DAN, { projectId: PROJECT, assigneeId: DAN })).toBe(false);
  });

  test("a task whose project is not in the snapshot is shown to admins and managers only", () => {
    const archived = { projectId: "p-archived", assigneeId: null };
    const member = withDubaiLead({
      projectMembers: [{ projectId: "p-archived", userId: LEAD, roleLabel: null }],
    });
    expect(seesTask(member, ADMIN, archived)).toBe(true);
    expect(seesTask(member, LEAD, archived)).toBe(false);
    expect(seesTask(member, MAYA, { projectId: "p-archived" })).toBe(true); // her own task
  });
});
