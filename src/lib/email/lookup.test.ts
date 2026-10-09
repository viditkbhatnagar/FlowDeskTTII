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
  department,
  groupTask,
  membership,
  project,
  role,
  task,
  team,
  withLines,
} from "./fixtures";
import { canSeeProject, canSeeTask, indexSnapshot, isGroupParent, managesPerson } from "./lookup";
import type { EmailSnapshot, SnapshotProject } from "./snapshot";

// The database's rules for who may open a project (20260930000100_project_access.sql) and see a
// task (private.can_view_task, 9 Oct 2026), as the email worker applies them to its snapshot.
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
  // private.can_view_task (9 Oct 2026). Nobody reports to anybody in the base snapshot.
  const BOSS = "60000000-0000-4000-8000-000000000006"; // a manager in upCarrera
  const SALES = "d0000000-0000-4000-8000-000000000001"; // an upCarrera department
  const OUTREACH = "e0000000-0000-4000-8000-000000000001"; // an upCarrera team

  /** The base snapshot plus Boss, a manager in upCarrera with nobody under them yet. */
  const withBoss = (overrides: Partial<EmailSnapshot> = {}) => {
    const base = baseSnapshot(overrides);
    return {
      ...base,
      memberships: [...base.memberships, membership(BOSS, DUBAI)],
      roles: [...base.roles, role(BOSS, DUBAI, "manager")],
    };
  };
  /** Maya reports to the lead, Dan to Boss. */
  const twoTeams = () =>
    withLines(withLines(withBoss(), MAYA, DUBAI, { reportingManagerId: LEAD }), DAN, DUBAI, {
      reportingManagerId: BOSS,
    });
  const mayas = { assigneeId: MAYA, createdBy: ADMIN };
  const dans = { assigneeId: DAN, createdBy: ADMIN };

  test("its creator, assignee and reviewer see it, while active members of its organization", () => {
    expect(seesTask(baseSnapshot(), MAYA)).toBe(true); // assignee
    expect(seesTask(baseSnapshot(), DAN, { assigneeId: null, reviewerId: DAN })).toBe(true);
    expect(seesTask(baseSnapshot(), DAN, { createdBy: DAN })).toBe(true);
    expect(seesTask(baseSnapshot(), DAN)).toBe(false);
    const base = baseSnapshot();
    const left = {
      ...base,
      memberships: [
        ...base.memberships.filter((m) => m.userId !== DAN),
        membership(DAN, DUBAI, true, "inactive"),
      ],
    };
    expect(seesTask(left, DAN, { assigneeId: DAN })).toBe(false);
    expect(seesTask(left, DAN, { projectId: PROJECT, createdBy: DAN })).toBe(false);
  });

  test("an admin of its organization sees every task there, and only there", () => {
    expect(seesTask(baseSnapshot(), ADMIN, { createdBy: MAYA, assigneeId: DAN })).toBe(true);
    expect(seesTask(baseSnapshot(), ADMIN, { projectId: PROJECT, ...dans })).toBe(true);
    expect(seesTask(baseSnapshot(), ADMIN, { projectId: "p-archived", ...dans })).toBe(true);
    // Not a member of TTI, whatever their role in upCarrera.
    expect(seesTask(baseSnapshot(), ADMIN, { organizationId: KOLKATA, createdBy: LEAD })).toBe(
      false,
    );
    const base = baseSnapshot();
    const lapsed = {
      ...base,
      memberships: [
        ...base.memberships.filter((m) => m.userId !== ADMIN),
        membership(ADMIN, DUBAI, true, "inactive"),
      ],
    };
    expect(seesTask(lapsed, ADMIN, { createdBy: MAYA })).toBe(false);
  });

  test("a manager sees the tasks of the people who report to them, not another manager's", () => {
    const snapshot = twoTeams();
    expect(seesTask(snapshot, LEAD, mayas)).toBe(true);
    expect(seesTask(snapshot, LEAD, dans)).toBe(false);
    expect(seesTask(snapshot, BOSS, dans)).toBe(true);
    expect(seesTask(snapshot, BOSS, mayas)).toBe(false);
    // Whatever the project: being off its team does not matter, being on it shows nothing more.
    expect(seesTask(snapshot, BOSS, { projectId: PROJECT, ...dans })).toBe(true);
    expect(seesTask(snapshot, MAYA, { projectId: PROJECT, ...dans })).toBe(false); // on the team
  });

  test("a manager or team lead by role alone sees nobody else's tasks", () => {
    const snapshot = withBoss();
    expect(seesTask(snapshot, BOSS, mayas)).toBe(false);
    expect(seesTask(snapshot, BOSS, { projectId: PROJECT, ...mayas })).toBe(false);
    const leadInTti = baseSnapshot({
      memberships: [...baseSnapshot().memberships, membership(MAYA, KOLKATA, false)],
    });
    expect(seesTask(leadInTti, LEAD, { organizationId: KOLKATA, ...mayas })).toBe(false);
  });

  test("a task someone made for themself reaches whoever they report to", () => {
    const snapshot = twoTeams();
    const own = { assigneeId: MAYA, createdBy: MAYA };
    expect(seesTask(snapshot, LEAD, own)).toBe(true);
    expect(seesTask(snapshot, BOSS, own)).toBe(false);
    expect(seesTask(snapshot, DAN, own)).toBe(false);
    // What Maya made for Dan reaches both their managers.
    const forDan = { assigneeId: DAN, createdBy: MAYA };
    expect(seesTask(snapshot, LEAD, forDan)).toBe(true);
    expect(seesTask(snapshot, BOSS, forDan)).toBe(true);
  });

  test("a department's head and a team's lead manage the people in it", () => {
    const structure = {
      departments: [department(SALES, DUBAI, BOSS)],
      teams: [team(OUTREACH, DUBAI, LEAD)],
    };
    const snapshot = withLines(
      withLines(withBoss(structure), MAYA, DUBAI, { departmentId: SALES }),
      DAN,
      DUBAI,
      { teamId: OUTREACH },
    );
    expect(seesTask(snapshot, BOSS, mayas)).toBe(true); // head of Maya's department
    expect(seesTask(snapshot, BOSS, dans)).toBe(false);
    expect(seesTask(snapshot, LEAD, dans)).toBe(true); // lead of Dan's team
    expect(seesTask(snapshot, LEAD, mayas)).toBe(false);
    // A department of another organization heads nobody here.
    const foreign = withLines(
      withBoss({ departments: [department(SALES, KOLKATA, BOSS)] }),
      MAYA,
      DUBAI,
      { departmentId: SALES },
    );
    expect(seesTask(foreign, BOSS, mayas)).toBe(false);
  });

  test("reporting lines count only between active members of the task's organization", () => {
    // Maya reports to the lead in upCarrera only; her TTI task is not the lead's to see.
    const base = withLines(baseSnapshot(), MAYA, DUBAI, { reportingManagerId: LEAD });
    const inTti = { ...base, memberships: [...base.memberships, membership(MAYA, KOLKATA, false)] };
    expect(seesTask(inTti, LEAD, mayas)).toBe(true);
    expect(seesTask(inTti, LEAD, { organizationId: KOLKATA, ...mayas })).toBe(false);
    // A report who left, or a manager who left, ends it.
    const reportLeft = {
      ...base,
      memberships: base.memberships.map((m) =>
        m.userId === MAYA ? { ...m, status: "inactive" } : m,
      ),
    };
    expect(seesTask(reportLeft, LEAD, mayas)).toBe(false);
    const managerLeft = {
      ...base,
      memberships: base.memberships.map((m) =>
        m.userId === LEAD && m.organizationId === DUBAI ? { ...m, status: "inactive" } : m,
      ),
    };
    expect(seesTask(managerLeft, LEAD, mayas)).toBe(false);
  });

  test("a group's members see the group and each other's parts; nobody else does", () => {
    const [parent, mayasPart, dansPart] = groupTask({ title: "Open day", createdBy: ADMIN }, [
      { assigneeId: MAYA },
      { assigneeId: DAN },
    ]);
    const snapshot = baseSnapshot({ tasks: [parent, mayasPart, dansPart] });
    const index = indexSnapshot(snapshot);
    expect(parent.assigneeId).toBeNull();
    expect(canSeeTask(index, MAYA, parent)).toBe(true);
    expect(canSeeTask(index, DAN, parent)).toBe(true);
    expect(canSeeTask(index, MAYA, mayasPart)).toBe(true);
    expect(canSeeTask(index, MAYA, dansPart)).toBe(true); // in the same group
    expect(canSeeTask(index, DAN, mayasPart)).toBe(true);
    expect(canSeeTask(index, LEAD, parent)).toBe(false); // not in the group
    expect(canSeeTask(index, LEAD, mayasPart)).toBe(false);
    expect(canSeeTask(index, ADMIN, parent)).toBe(true); // its creator, and an admin
    // An archived part no longer shows its member the group.
    const archived = baseSnapshot({
      tasks: [parent, { ...mayasPart, archivedAt: "2026-09-24T10:00:00Z" }, dansPart],
    });
    expect(canSeeTask(indexSnapshot(archived), MAYA, parent)).toBe(false);
    expect(canSeeTask(indexSnapshot(archived), MAYA, dansPart)).toBe(false);
  });

  test("a group across two managers' people: each manager sees their own person's part", () => {
    // Boss makes a group for Dan (Boss's report) and Maya (the lead's report).
    const [parent, mayasPart, dansPart] = groupTask({ createdBy: BOSS }, [
      { assigneeId: MAYA },
      { assigneeId: DAN },
    ]);
    const snapshot = twoTeams();
    const index = indexSnapshot({ ...snapshot, tasks: [parent, mayasPart, dansPart] });
    const seen = (userId: string) =>
      [parent, mayasPart, dansPart].map((t) => canSeeTask(index, userId, t));
    expect(seen(BOSS)).toEqual([true, true, true]); // made all of it
    expect(seen(LEAD)).toEqual([false, true, false]); // Maya's part only
    expect(seen(MAYA)).toEqual([true, true, true]); // her group, and Dan's part in it
    // Someone Boss reports to sees everything Boss made.
    const above = indexSnapshot({
      ...withLines(snapshot, BOSS, DUBAI, { reportingManagerId: LEAD }),
      tasks: [parent, mayasPart, dansPart],
    });
    expect([parent, mayasPart, dansPart].map((t) => canSeeTask(above, LEAD, t))).toEqual([
      true,
      true,
      true,
    ]);
  });

  test("a snapshot without reporting lines (an older RPC) fails closed for all but admins and its people", () => {
    const [parent, mayasPart] = groupTask({ createdBy: ADMIN }, [
      { assigneeId: MAYA },
      { assigneeId: DAN },
    ]);
    const current = withLines(
      baseSnapshot({ tasks: [parent, mayasPart], departments: [department(SALES, DUBAI, DAN)] }),
      MAYA,
      DUBAI,
      { reportingManagerId: LEAD, departmentId: SALES },
    );
    const index = indexSnapshot(current);
    expect(canSeeTask(index, LEAD, mayasPart)).toBe(true);
    expect(canSeeTask(index, DAN, mayasPart)).toBe(true);
    expect(canSeeTask(index, MAYA, parent)).toBe(true);
    const { departments: _d, teams: _t, ...rest } = current;
    const legacy = {
      ...rest,
      memberships: current.memberships.map(
        ({ departmentId: _dep, teamId: _team, reportingManagerId: _rm, ...m }) => m,
      ),
      tasks: current.tasks.map(({ parentTaskId: _p, ...t }) => t),
    } as EmailSnapshot;
    const old = indexSnapshot(legacy);
    expect(canSeeTask(old, LEAD, mayasPart)).toBe(false);
    expect(canSeeTask(old, DAN, mayasPart)).toBe(false);
    expect(canSeeTask(old, ADMIN, mayasPart)).toBe(true);
    expect(canSeeTask(old, MAYA, mayasPart)).toBe(true);
    // The group cannot be told either: its members keep their own part only.
    expect(canSeeTask(old, MAYA, parent)).toBe(false);
    // Reporting lines with no departments or teams to go with them are not trusted either.
    const partial = { ...current, departments: undefined } as EmailSnapshot;
    expect(canSeeTask(indexSnapshot(partial), LEAD, mayasPart)).toBe(false);
  });
});

describe("group tasks in the index", () => {
  test("a group's parent is nobody's own work; each member's part is theirs", () => {
    const [parent, mayasPart, dansPart] = groupTask({ createdBy: ADMIN }, [
      { assigneeId: MAYA },
      { assigneeId: DAN },
    ]);
    const index = indexSnapshot(baseSnapshot({ tasks: [parent, mayasPart, dansPart] }));
    expect(isGroupParent(index, parent)).toBe(true);
    expect(isGroupParent(index, mayasPart)).toBe(false);
    expect(index.tasksByAssignee.get(MAYA)?.map((t) => t.id)).toEqual([mayasPart.id]);
    expect(index.tasksByAssignee.get(DAN)?.map((t) => t.id)).toEqual([dansPart.id]);
    expect(index.childrenByParent.get(parent.id)?.map((t) => t.id)).toEqual([
      mayasPart.id,
      dansPart.id,
    ]);
  });

  test("an unassigned task with no parts is an ordinary task", () => {
    const loose = task({ assigneeId: null });
    expect(isGroupParent(indexSnapshot(baseSnapshot({ tasks: [loose] })), loose)).toBe(false);
  });

  test("nobody manages themself", () => {
    const snapshot = withLines(baseSnapshot(), MAYA, DUBAI, { reportingManagerId: MAYA });
    expect(managesPerson(indexSnapshot(snapshot), MAYA, MAYA, DUBAI)).toBe(false);
  });
});
