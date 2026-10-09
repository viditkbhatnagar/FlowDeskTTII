// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  NO_DEPARTMENT,
  UNASSIGNED,
  assigneeOptions,
  buildRoster,
  buildWorkload,
  countWithTasks,
  departmentOptions,
  buildScopedRoster,
  filterRoster,
  isPartialRoster,
  rosterScopes,
  type RosterUser,
  type WorkloadTask,
} from "./team-roster";
import { indexManagement, type ManagementData } from "./task-permissions";

const ORG = "org-upcarrera";
const OTHER_ORG = "org-other";
const SALES = "dept-sales";
const ADMISSIONS = "dept-admissions";
const departmentNames = new Map([
  [SALES, "Sales"],
  [ADMISSIONS, "Admissions"],
]);
const avatarFor = (id: string, name: string) => ({
  name,
  initials: name.slice(0, 2).toUpperCase(),
  color: `c-${id}`,
});

const person = (id: string, name: string, overrides: Partial<RosterUser> = {}): RosterUser => ({
  id,
  name,
  status: "active",
  memberships: [{ orgId: ORG, status: "active" }],
  ...overrides,
});

const edwin = person("edwin", "Edwin Manager", {
  memberships: [{ orgId: ORG, status: "active", privilege: "manager", departmentId: SALES }],
});
const dan = person("dan", "Dan Employee", {
  memberships: [{ orgId: ORG, status: "active", departmentId: SALES }],
});
const asha = person("asha", "Asha Admissions", {
  memberships: [{ orgId: ORG, status: "active", departmentId: ADMISSIONS }],
});
const bea = person("bea", "Bea No-Tasks");
const users = [edwin, dan, asha, bea];

const task = (
  assigneeId: string | null,
  status: string,
  name = assigneeId ?? "Unassigned",
): WorkloadTask => ({
  assigneeId,
  status,
  assignee: { name, initials: name.slice(0, 2).toUpperCase(), color: `c-${assigneeId}` },
});

describe("buildRoster", () => {
  test("lists every active member by name, with their department", () => {
    const roster = buildRoster(users, [ORG], departmentNames, avatarFor);
    expect(roster.map((m) => m.name)).toEqual([
      "Asha Admissions",
      "Bea No-Tasks",
      "Dan Employee",
      "Edwin Manager",
    ]);
    expect(roster.find((m) => m.id === "dan")?.departments).toEqual(["Sales"]);
    expect(roster.find((m) => m.id === "bea")?.departments).toEqual([NO_DEPARTMENT]);
    expect(roster.find((m) => m.id === "dan")?.color).toBe("c-dan");
  });

  test("deactivated people and people who left are excluded", () => {
    const deactivated = person("gone", "Gone Deactivated", { status: "inactive" });
    const left = person("left", "Left Membership", {
      memberships: [{ orgId: ORG, status: "inactive" }],
    });
    const roster = buildRoster([...users, deactivated, left], [ORG], departmentNames, avatarFor);
    expect(roster.map((m) => m.id)).not.toContain("gone");
    expect(roster.map((m) => m.id)).not.toContain("left");
  });

  test("members of organizations the viewer does not manage are excluded", () => {
    const elsewhere = person("far", "Far Away", {
      memberships: [{ orgId: OTHER_ORG, status: "active" }],
    });
    expect(
      buildRoster([...users, elsewhere], [ORG], departmentNames, avatarFor).map((m) => m.id),
    ).not.toContain("far");
  });

  test("no managed organization means no roster", () => {
    expect(buildRoster(users, [], departmentNames, avatarFor)).toEqual([]);
  });

  test("a department that cannot be named counts as none", () => {
    const stale = person("stale", "Stale Dept", {
      memberships: [{ orgId: ORG, status: "active", departmentId: "deleted" }],
    });
    expect(buildRoster([stale], [ORG], departmentNames, avatarFor)[0].departments).toEqual([
      NO_DEPARTMENT,
    ]);
  });
});

describe("filterRoster", () => {
  const roster = buildRoster(users, [ORG], departmentNames, avatarFor);
  const all = { department: "all", assignee: "all" };

  test("no filters keep everyone", () => {
    expect(filterRoster(roster, all)).toHaveLength(4);
  });

  test("a department keeps its members, including those with no tasks", () => {
    expect(filterRoster(roster, { ...all, department: "Sales" }).map((m) => m.id)).toEqual([
      "dan",
      "edwin",
    ]);
    expect(filterRoster(roster, { ...all, department: NO_DEPARTMENT }).map((m) => m.id)).toEqual([
      "bea",
    ]);
  });

  test("an assignee, or a dashboard assignee link, keeps only that person", () => {
    expect(filterRoster(roster, { ...all, assignee: "bea" }).map((m) => m.id)).toEqual(["bea"]);
    expect(filterRoster(roster, { ...all, linkedAssignee: "dan" }).map((m) => m.id)).toEqual([
      "dan",
    ]);
    expect(filterRoster(roster, { ...all, assignee: UNASSIGNED })).toEqual([]);
  });

  test("the search box matches names", () => {
    expect(filterRoster(roster, { ...all, query: "  bea " }).map((m) => m.id)).toEqual(["bea"]);
    expect(filterRoster(roster, { ...all, query: "budget" })).toEqual([]);
  });
});

describe("buildWorkload", () => {
  const roster = buildRoster(users, [ORG], departmentNames, avatarFor);

  test("roster members with no tasks appear at zero", () => {
    const workload = buildWorkload([task("dan", "todo", "Dan Employee")], roster);
    const bea = workload.find((m) => m.key === "bea");
    expect(bea).toMatchObject({
      active: 0,
      done: 0,
      pct: 0,
      productivity: 0,
      availability: "Free",
    });
    expect(workload).toHaveLength(4);
    expect(countWithTasks(workload)).toBe(1);
  });

  test("people with tasks who are not on the roster are kept", () => {
    const workload = buildWorkload([task("former", "progress", "Unknown")], roster);
    expect(workload.map((m) => m.key)).toContain("former");
    expect(workload).toHaveLength(5);
  });

  test("without a roster only assignees are listed, as before", () => {
    const workload = buildWorkload([task("dan", "todo"), task(null, "todo"), task("dan", "done")]);
    expect(workload).toHaveLength(1);
    expect(workload[0]).toMatchObject({ key: "dan", active: 1, done: 1, productivity: 50 });
  });

  test("counts open and done, not cancelled", () => {
    const workload = buildWorkload([
      task("dan", "todo"),
      task("dan", "review"),
      task("dan", "done"),
      task("dan", "cancelled"),
    ]);
    expect(workload[0]).toMatchObject({ active: 2, done: 1 });
  });

  test("busiest first, then by name", () => {
    const workload = buildWorkload(
      [task("asha", "todo"), task("dan", "todo"), task("dan", "progress"), task("edwin", "done")],
      roster,
    );
    expect(workload.map((m) => m.key)).toEqual(["dan", "asha", "bea", "edwin"]);
  });

  test("a roster member keeps the roster's name and avatar", () => {
    const workload = buildWorkload([task("dan", "todo", "Somebody Else")], roster);
    expect(workload.find((m) => m.key === "dan")?.name).toBe("Dan Employee");
  });

  test("availability follows open tasks against capacity", () => {
    const many = (n: number) => Array.from({ length: n }, () => task("dan", "todo"));
    expect(buildWorkload(many(9))[0]).toMatchObject({ pct: 90, availability: "Busy" });
    expect(buildWorkload(many(6))[0].availability).toBe("Available");
    expect(buildWorkload(many(14))[0].pct).toBe(100);
  });
});

describe("filter options", () => {
  const roster = buildRoster(users, [ORG], departmentNames, avatarFor);

  test("assignees include roster members with no tasks, task assignees and Unassigned", () => {
    const options = assigneeOptions(
      [task("former", "todo", "Unknown"), task(null, "todo")],
      roster,
    );
    expect(options.map(([id]) => id)).toEqual([
      "asha",
      "bea",
      "dan",
      "edwin",
      UNASSIGNED,
      "former",
    ]);
    expect(options.find(([id]) => id === UNASSIGNED)?.[1]).toBe("Unassigned");
  });

  test("departments include the roster's", () => {
    expect(departmentOptions(["Sales"], roster)).toEqual(["Admissions", NO_DEPARTMENT, "Sales"]);
    expect(departmentOptions(["Sales"], [])).toEqual(["Sales"]);
  });
});


describe("roster scope (9 Oct: admins see the organization, others the people they manage)", () => {
  const COORDINATORS = "team-coordinators";
  const sharon = person("sharon", "Sharon Admin", {
    memberships: [{ orgId: ORG, status: "active", privilege: "admin" }],
  });
  const karthika = person("karthika", "Karthika Lead", {
    memberships: [{ orgId: ORG, status: "active", privilege: "team_lead", departmentId: SALES, teamId: COORDINATORS }],
  });
  const riya = person("riya", "Riya Coordinator", {
    memberships: [{ orgId: ORG, status: "active", departmentId: SALES, teamId: COORDINATORS }],
  });
  const ravi = person("ravi", "Ravi Reports", {
    memberships: [{ orgId: ORG, status: "active", departmentId: ADMISSIONS, reportingManagerId: "edwin" }],
  });
  const naji = person("naji", "Naji Head", {
    memberships: [{ orgId: ORG, status: "active", departmentId: ADMISSIONS }],
  });
  const everyone = [...users, sharon, karthika, riya, ravi, naji];
  const linksOf = (list: RosterUser[]): ManagementData => ({
    memberships: list.flatMap((user) =>
      user.memberships.map((m) => ({
        userId: user.id,
        orgId: m.orgId,
        status: m.status,
        departmentId: m.departmentId,
        teamId: m.teamId,
        reportingManagerId: m.reportingManagerId,
      })),
    ),
    departmentHeads: [
      { id: ADMISSIONS, orgId: ORG, leadId: "naji" },
      { id: SALES, orgId: ORG, leadId: null },
    ],
    teamLeads: [{ id: COORDINATORS, orgId: ORG, leadId: "karthika" }],
  });
  const management = indexManagement(linksOf(everyone));
  const rosterIds = (viewer: RosterUser) =>
    buildScopedRoster(everyone, rosterScopes(viewer, management), departmentNames, avatarFor).map((m) => m.id);

  test("an admin covers the whole organization", () => {
    expect(rosterScopes(sharon, management)).toEqual([{ orgId: ORG, whole: true }]);
    expect(rosterIds(sharon)).toHaveLength(everyone.length);
    expect(isPartialRoster(rosterScopes(sharon, management))).toBe(false);
  });

  test("a manager who is not an admin covers only the people who report to them, and themselves", () => {
    // Edwin holds the manager permission but no longer sees the whole organization.
    expect(rosterIds(edwin)).toEqual(["edwin", "ravi"]);
    expect(isPartialRoster(rosterScopes(edwin, management))).toBe(true);
  });

  test("a team lead covers their team", () => {
    expect(rosterIds(karthika)).toEqual(["karthika", "riya"]);
  });

  test("a department head covers their department", () => {
    expect(rosterIds(naji)).toEqual(["asha", "naji", "ravi"]);
  });

  test("someone who manages nobody sees only themselves", () => {
    expect(rosterScopes(dan, management)).toEqual([{ orgId: ORG, whole: false, personIds: ["dan"] }]);
    expect(rosterIds(dan)).toEqual(["dan"]);
  });

  test("an inactive membership gives no scope", () => {
    const off = person("off", "Off Admin", {
      memberships: [{ orgId: ORG, status: "inactive", privilege: "admin" }],
    });
    expect(rosterScopes(off, management)).toEqual([]);
    expect(rosterScopes(null, management)).toEqual([]);
    expect(isPartialRoster([])).toBe(false);
  });

  test("admin in one organization and not in another: whole there, managed people here", () => {
    const both = person("both", "Both Orgs", {
      memberships: [
        { orgId: OTHER_ORG, status: "active", privilege: "admin" },
        { orgId: ORG, status: "active", privilege: "employee" },
      ],
    });
    expect(rosterScopes(both, management)).toEqual([
      { orgId: OTHER_ORG, whole: true },
      { orgId: ORG, whole: false, personIds: ["both"] },
    ]);
    expect(isPartialRoster(rosterScopes(both, management))).toBe(true);
  });
});
