// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  NO_PERMISSIONS,
  indexManagement,
  taskPermissions,
  type ManagementData,
  type MembershipLink,
  type PermissionTask,
  type TaskViewer,
} from "./task-permissions";

const ORG = "org-upc";
const OTHER = "org-ttii";

const member = (userId: string, overrides: Partial<MembershipLink> = {}): MembershipLink => ({
  userId,
  orgId: ORG,
  status: "active",
  ...overrides,
});

// Sharon is admin. Naji heads Admissions. Lena leads the Coordinators team.
// Dan reports to Ravi directly. Asha is in Admissions, Riya on Coordinators.
const data: ManagementData = {
  memberships: [
    member("sharon"),
    member("naji", { departmentId: "dept-admissions" }),
    member("lena", { departmentId: "dept-sales", teamId: "team-coord" }),
    member("ravi"),
    member("dan", { reportingManagerId: "ravi" }),
    member("asha", { departmentId: "dept-admissions" }),
    member("riya", { departmentId: "dept-sales", teamId: "team-coord" }),
    member("gone", { reportingManagerId: "ravi", status: "inactive" }),
    member("dan", { orgId: OTHER }),
    member("ravi", { orgId: OTHER }),
    member("self", { reportingManagerId: "self" }),
  ],
  departmentHeads: [
    { id: "dept-admissions", orgId: ORG, leadId: "naji" },
    { id: "dept-sales", orgId: ORG, leadId: null },
  ],
  teamLeads: [{ id: "team-coord", orgId: ORG, leadId: "lena" }],
};

const index = indexManagement(data);

describe("indexManagement (rule c)", () => {
  test("a reporting manager manages their direct reports", () => {
    expect(index.manages("ravi", "dan", ORG)).toBe(true);
    expect(index.manages("dan", "ravi", ORG)).toBe(false);
  });

  test("a department head manages the department", () => {
    expect(index.manages("naji", "asha", ORG)).toBe(true);
    expect(index.manages("naji", "riya", ORG)).toBe(false);
  });

  test("a team lead manages the team", () => {
    expect(index.manages("lena", "riya", ORG)).toBe(true);
    expect(index.manages("lena", "asha", ORG)).toBe(false);
  });

  test("only within the organization the link is in", () => {
    // Dan reports to Ravi in UPC, not in TTII.
    expect(index.manages("ravi", "dan", OTHER)).toBe(false);
  });

  test("an inactive membership is managed by nobody", () => {
    expect(index.manages("ravi", "gone", ORG)).toBe(false);
  });

  test("a manager who is not an active member manages nobody there", () => {
    const off = indexManagement({
      ...data,
      memberships: [
        member("ravi", { status: "inactive" }),
        member("dan", { reportingManagerId: "ravi" }),
      ],
    });
    expect(off.manages("ravi", "dan", ORG)).toBe(false);
    expect(off.managedBy("ravi", ORG)).toEqual([]);
  });

  test("nobody manages themself", () => {
    expect(index.manages("self", "self", ORG)).toBe(false);
    expect(index.manages("lena", "lena", ORG)).toBe(false);
    expect(index.managedBy("lena", ORG)).toEqual(["riya"]);
  });

  test("a team or department that belongs to another organization does not count", () => {
    const crossed = indexManagement({
      ...data,
      teamLeads: [{ id: "team-coord", orgId: OTHER, leadId: "lena" }],
    });
    expect(crossed.manages("lena", "riya", ORG)).toBe(false);
  });

  test("managedBy lists everyone under someone, once", () => {
    const both = indexManagement({
      ...data,
      memberships: [
        ...data.memberships,
        member("asha", { departmentId: "dept-admissions", reportingManagerId: "naji" }),
      ],
    });
    expect(both.managedBy("naji", ORG)).toEqual(["asha"]);
    expect(index.managedBy("ravi", ORG)).toEqual(["dan"]);
    expect(index.managedBy("asha", ORG)).toEqual([]);
  });

  test("empty ids never match", () => {
    expect(index.manages("", "dan", ORG)).toBe(false);
    expect(index.manages("ravi", "", ORG)).toBe(false);
  });
});

const viewer = (id: string | null, admins: string[] = []): TaskViewer => ({
  id,
  isAdminIn: (orgId) => Boolean(id) && admins.includes(`${id}@${orgId}`),
  manages: (personId, orgId) => (id ? index.manages(id, personId, orgId) : false),
});

const taskFor = (overrides: Partial<PermissionTask> = {}): PermissionTask => ({
  organizationId: ORG,
  createdById: "dan",
  assigneeId: "dan",
  reviewerId: null,
  ...overrides,
});

const ALL = {
  canEdit: true,
  canMove: true,
  canDelete: true,
  canChangeAssignee: true,
  canEditSubtasks: true,
  canManageFiles: true,
  canCollaborate: true,
};

describe("taskPermissions: an ordinary task or a member's part", () => {
  test("the creator may do everything", () => {
    expect(taskPermissions(taskFor(), false, viewer("dan"))).toEqual(ALL);
  });

  test("the assignee may edit and move, but not delete", () => {
    const task = taskFor({ createdById: "ravi", assigneeId: "asha" });
    expect(taskPermissions(task, false, viewer("asha"))).toEqual({
      ...ALL,
      canDelete: false,
      canManageFiles: false,
    });
  });

  test("the reviewer may edit and move, but not delete", () => {
    const task = taskFor({ reviewerId: "naji" });
    expect(taskPermissions(task, false, viewer("naji"))).toEqual({
      ...ALL,
      canDelete: false,
      canManageFiles: false,
    });
  });

  test("an admin of the organization may do everything", () => {
    expect(taskPermissions(taskFor(), false, viewer("sharon", [`sharon@${ORG}`]))).toEqual(ALL);
  });

  test("an admin of another organization may not", () => {
    expect(taskPermissions(taskFor(), false, viewer("sharon", [`sharon@${OTHER}`]))).toEqual(
      NO_PERMISSIONS,
    );
  });

  test("someone who manages the assignee may edit and move, but not delete", () => {
    expect(taskPermissions(taskFor(), false, viewer("ravi"))).toEqual({ ...ALL, canDelete: false });
  });

  test("someone who manages only the creator may look but not change", () => {
    // Rule c lets Ravi see a task Dan created for Asha; only managing the assignee allows changes.
    const task = taskFor({ createdById: "dan", assigneeId: "asha" });
    // …and still comments on it and reads its files (rule c reaches can_access_task).
    expect(taskPermissions(task, false, viewer("ravi"))).toEqual({
      ...NO_PERMISSIONS,
      canCollaborate: true,
    });
  });

  test("a colleague on the same project may not change it (the 9 Oct bug)", () => {
    expect(taskPermissions(taskFor(), false, viewer("riya"))).toEqual(NO_PERMISSIONS);
  });

  test("nothing is allowed before the signed-in user is known", () => {
    expect(taskPermissions(taskFor(), false, viewer(null))).toEqual(NO_PERMISSIONS);
  });

  test("an unassigned task: only its creator and admins", () => {
    const task = taskFor({ assigneeId: null, createdById: "lena" });
    expect(taskPermissions(task, false, viewer("lena")).canEdit).toBe(true);
    expect(taskPermissions(task, false, viewer("ravi")).canEdit).toBe(false);
  });

  test("a task with no organization gives admins nothing", () => {
    const task = taskFor({ organizationId: null, createdById: "lena", assigneeId: "riya" });
    expect(taskPermissions(task, false, viewer("sharon", [`sharon@${ORG}`]))).toEqual(
      NO_PERMISSIONS,
    );
  });

  test("an unknown creator is nobody's", () => {
    const task = taskFor({ createdById: null, assigneeId: null });
    expect(taskPermissions(task, false, viewer("dan"))).toEqual(NO_PERMISSIONS);
  });
});

describe("taskPermissions: a group task (the parent)", () => {
  const group = taskFor({ createdById: "naji", assigneeId: null });

  test("its creator may edit and delete it, never move it or give it an assignee", () => {
    expect(taskPermissions(group, true, viewer("naji"))).toEqual({
      canEdit: true,
      canMove: false,
      canDelete: true,
      canChangeAssignee: false,
      canEditSubtasks: false,
      canManageFiles: true,
      canCollaborate: true,
    });
  });

  test("an admin may edit and delete it, never move it", () => {
    expect(taskPermissions(group, true, viewer("sharon", [`sharon@${ORG}`]))).toMatchObject({
      canEdit: true,
      canMove: false,
      canDelete: true,
    });
  });

  test("its members only look at it: each moves their own part", () => {
    expect(taskPermissions(group, true, viewer("asha"))).toEqual({
      ...NO_PERMISSIONS,
      canCollaborate: true,
    });
  });

  test("a manager of its creator only looks at it", () => {
    const byDan = taskFor({ createdById: "dan", assigneeId: null });
    expect(taskPermissions(byDan, true, viewer("ravi"))).toEqual({
      ...NO_PERMISSIONS,
      canCollaborate: true,
    });
  });
});

describe("taskPermissions: one person's part of a group task", () => {
  // Naji made a group task; this is Asha's part (create_group_task: its creator is Naji).
  const part = taskFor({ createdById: "naji", assigneeId: "asha", parentTaskId: "group-1" });

  test("its person moves and edits it, but cannot hand it to someone else or delete it", () => {
    expect(taskPermissions(part, false, viewer("asha"))).toEqual({
      ...ALL,
      canDelete: false,
      canChangeAssignee: false,
      canManageFiles: false,
    });
  });

  test("the group's creator and admins decide who has a part", () => {
    expect(taskPermissions(part, false, viewer("naji")).canChangeAssignee).toBe(true);
    expect(
      taskPermissions(part, false, viewer("sharon", [`sharon@${ORG}`])).canChangeAssignee,
    ).toBe(true);
  });

  test("someone in the same group only looks at it, and not inside it", () => {
    // Riya sees Asha's part (rule e) but not its comments, files or subtasks.
    expect(taskPermissions(part, false, viewer("riya"))).toEqual(NO_PERMISSIONS);
    expect(taskPermissions(part, false, viewer("riya")).canCollaborate).toBe(false);
  });
});
