// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  GROUP_LIMIT,
  dailyDigestContent,
  dailyManagementContent,
  weeklyDigestContent,
  weeklyManagementContent,
} from "./digests";
import {
  ADMIN,
  APP,
  DAN,
  DUBAI,
  FRIDAY_0830_DUBAI,
  KOLKATA,
  LEAD,
  MAYA,
  PROJECT,
  baseSnapshot,
  membership,
  org,
  person,
  project,
  role,
  task,
} from "./fixtures";
import { indexSnapshot } from "./lookup";
import type {
  EmailSnapshot,
  SnapshotProject,
  SnapshotProjectMember,
  SnapshotTask,
} from "./snapshot";

const args = (snapshot: EmailSnapshot, userId: string, now = FRIDAY_0830_DUBAI) => ({
  index: indexSnapshot(snapshot),
  userId,
  now,
  appUrl: APP,
});

type Grouped = { label: string; tasks?: { title: string }[]; items?: { title: string }[] };
const titles = (groups: Grouped[], label: string) =>
  (
    groups.find((g) => g.label === label)?.tasks ??
    groups.find((g) => g.label === label)?.items ??
    []
  ).map((row) => row.title);

describe("daily digest", () => {
  test("sorts the recipient's open work into overdue, today and the next seven days", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ title: "late", dueDate: "2026-09-20" }),
        task({ title: "today", dueDate: "2026-09-25" }),
        task({ title: "in 7 days", dueDate: "2026-10-02" }),
        task({ title: "in 8 days", dueDate: "2026-10-03" }),
        task({ title: "tomorrow", dueDate: "2026-09-26" }),
        task({ title: "dateless", dueDate: null }),
        task({ title: "Dan's", assigneeId: DAN, dueDate: "2026-09-25" }),
      ],
    });
    const content = dailyDigestContent(args(snapshot, MAYA));
    expect(content).not.toBeNull();
    const groups = content!.organizations[0].groups;
    expect(titles(groups, "Overdue")).toEqual(["late"]);
    expect(titles(groups, "Due Today")).toEqual(["today"]);
    expect(titles(groups, "Upcoming")).toEqual(["tomorrow", "in 7 days"]);
    expect(content).toMatchObject({
      firstName: "Maya",
      date: "Fri, 25 Sep 2026",
      overdueCount: "1",
      dueTodayCount: "1",
      upcomingCount: "2",
      completedCount: "0",
      myTasksUrl: `${APP}/my-tasks`,
    });
    const today = groups.find((g) => g.label === "Due Today")!.tasks[0];
    expect(today.dateLabel).toBe("Due today");
    expect(groups.find((g) => g.label === "Overdue")!.tasks[0].dateLabel).toBe(
      "Due Sun, 20 Sep 2026",
    );
  });

  test("recently completed means since the start of the previous working day, local time", () => {
    const snapshot = baseSnapshot({
      tasks: [
        // Thu 24 Sep 00:30 in Dubai (Wed 20:30 UTC): in.
        task({ title: "thursday", status: "done", completedAt: "2026-09-23T20:30:00Z" }),
        // Wed 23 Sep 23:59 in Dubai: out.
        task({ title: "wednesday", status: "done", completedAt: "2026-09-23T19:59:00Z" }),
        // Done but with no completion time: unknown, so out.
        task({ title: "undated", status: "done", completedAt: null }),
      ],
    });
    const content = dailyDigestContent(args(snapshot, MAYA))!;
    const completed = content.organizations[0].groups.find(
      (g) => g.label === "Recently Completed",
    )!;
    expect(completed.tasks.map((t) => t.title)).toEqual(["thursday"]);
    expect(completed.tasks[0].dateLabel).toBe("Completed Thu, 24 Sep 2026");
    expect(content.completedCount).toBe("1");
  });

  test("on Monday, recently completed reaches back to Friday", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ title: "friday", status: "done", completedAt: "2026-09-25T10:00:00Z" }),
        task({ title: "thursday", status: "done", completedAt: "2026-09-24T10:00:00Z" }),
      ],
    });
    const content = dailyDigestContent(args(snapshot, MAYA, new Date("2026-09-28T04:30:00Z")))!;
    expect(titles(content.organizations[0].groups, "Recently Completed")).toEqual(["friday"]);
  });

  test("caps each group at eight rows but counts everything, and links to the rest", () => {
    const late = Array.from({ length: 11 }, (_, i) =>
      task({
        title: `late ${String(i).padStart(2, "0")}`,
        dueDate: `2026-09-${String(10 + i).padStart(2, "0")}`,
      }),
    );
    const content = dailyDigestContent(args(baseSnapshot({ tasks: late }), MAYA))!;
    const overdue = content.organizations[0].groups.find((g) => g.label === "Overdue")!;
    expect(overdue.tasks).toHaveLength(GROUP_LIMIT);
    expect(overdue.tasks[0].title).toBe("late 00"); // oldest first
    expect(overdue.viewAllUrl).toBe(`${APP}/my-tasks`);
    expect(content.overdueCount).toBe("11");
  });

  test("ties on the due date go to the higher priority first", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ title: "low", dueDate: "2026-09-25", priority: "low" }),
        task({ title: "critical", dueDate: "2026-09-25", priority: "critical" }),
      ],
    });
    const content = dailyDigestContent(args(snapshot, MAYA))!;
    expect(titles(content.organizations[0].groups, "Due Today")).toEqual(["critical", "low"]);
  });

  test("returns null when there is nothing to report", () => {
    expect(dailyDigestContent(args(baseSnapshot(), MAYA))).toBeNull();
    const onlyClosed = baseSnapshot({
      tasks: [task({ status: "cancelled", dueDate: "2026-09-25" })],
    });
    expect(dailyDigestContent(args(onlyClosed, MAYA))).toBeNull();
  });

  test("covers every organization the person is an active member of, each on its own calendar", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ assigneeId: LEAD, organizationId: KOLKATA, title: "tti", dueDate: "2026-09-25" }),
        task({ assigneeId: LEAD, organizationId: DUBAI, title: "dubai", dueDate: "2026-09-25" }),
      ],
    });
    const content = dailyDigestContent(args(snapshot, LEAD))!;
    expect(content.organizations.map((o) => o.name).sort()).toEqual([
      "Teachers' Training Institute of India",
      "upCarrera",
    ]);
    expect(content.dueTodayCount).toBe("2");
  });

  test("leaves out organizations that switched the digest off or that the person left", () => {
    const tasks = [
      task({ assigneeId: LEAD, organizationId: KOLKATA, title: "tti", dueDate: "2026-09-25" }),
      task({ assigneeId: LEAD, organizationId: DUBAI, title: "dubai", dueDate: "2026-09-25" }),
    ];
    const toggled = baseSnapshot({
      tasks,
      organizations: [
        org(DUBAI, "upCarrera", "Asia/Dubai", { daily_digest: false }),
        org(KOLKATA, "TTI", "Asia/Kolkata"),
      ],
    });
    expect(dailyDigestContent(args(toggled, LEAD))!.organizations.map((o) => o.name)).toEqual([
      "TTI",
    ]);
    const base = baseSnapshot({ tasks });
    const left = {
      ...base,
      memberships: base.memberships.filter(
        (m) => !(m.userId === LEAD && m.organizationId === DUBAI),
      ),
    };
    expect(dailyDigestContent(args(left, LEAD))!.dueTodayCount).toBe("1");
  });

  test("project names appear only when the task has a project", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ title: "with", dueDate: "2026-09-25", projectId: PROJECT }),
        task({ title: "without", dueDate: "2026-09-25" }),
      ],
    });
    const rows = dailyDigestContent(args(snapshot, MAYA))!.organizations[0].groups[0].tasks;
    expect(rows.find((r) => r.title === "with")!.projectName).toBe("October Admissions Drive");
    expect("projectName" in rows.find((r) => r.title === "without")!).toBe(false);
  });
});

describe("weekly digest", () => {
  const monday = new Date("2026-09-28T04:30:00Z");

  test("reports the previous seven days and the week ahead", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ title: "done in period", status: "done", completedAt: "2026-09-22T10:00:00Z" }),
        task({ title: "done before period", status: "done", completedAt: "2026-09-20T19:00:00Z" }),
        task({ title: "done today", status: "done", completedAt: "2026-09-28T04:00:00Z" }),
        task({ title: "overdue", dueDate: "2026-09-25" }),
        task({ title: "due today", dueDate: "2026-09-28" }),
        task({ title: "due sunday", dueDate: "2026-10-04" }),
        task({ title: "due later", dueDate: "2026-10-05" }),
        task({ title: "no date" }),
      ],
    });
    const content = weeklyDigestContent(args(snapshot, MAYA, monday))!;
    const groups = content.organizations[0].groups;
    expect(content.dateRange).toBe("Mon, 21 Sep – Sun, 27 Sep 2026");
    expect(titles(groups, "Completed")).toEqual(["done in period"]);
    expect(titles(groups, "Overdue")).toEqual(["overdue"]);
    expect(titles(groups, "Due Next Week")).toEqual(["due today", "due sunday"]);
    expect(titles(groups, "Other Open Tasks")).toEqual(["due later", "no date"]);
    expect(content).toMatchObject({
      completedCount: "1",
      openCount: "5",
      overdueCount: "1",
      nextWeekCount: "2",
    });
    expect(groups.find((g) => g.label === "Other Open Tasks")!.tasks[1].dateLabel).toBe(
      "No deadline",
    );
  });

  test("returns null for someone with no tasks at all", () => {
    expect(weeklyDigestContent(args(baseSnapshot(), DAN, monday))).toBeNull();
  });
});

describe("daily management summary", () => {
  test("lists what needs attention with badges, without listing a task twice", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ title: "overdue critical", dueDate: "2026-09-24", priority: "critical" }),
        task({ title: "blocked due today", dueDate: "2026-09-25", blocked: true, assigneeId: DAN }),
        task({ title: "unassigned", assigneeId: null, dueDate: "2026-09-30" }),
        task({ title: "in review", status: "review", dueDate: "2026-09-30" }),
        task({ title: "plain due today", dueDate: "2026-09-25", priority: "high" }),
        task({ title: "finished", status: "done", completedAt: "2026-09-24T12:00:00Z" }),
        task({ title: "tti", organizationId: KOLKATA, dueDate: "2026-09-24" }),
      ],
    });
    const content = dailyManagementContent(args(snapshot, ADMIN))!;
    expect(content.organizations).toHaveLength(1);
    const [dubai] = content.organizations;
    expect(dubai.name).toBe("upCarrera");
    const attention = dubai.groups.find((g) => g.label === "Needs Attention")!.tasks;
    expect(attention.map((t) => t.title)).toEqual([
      "overdue critical",
      "blocked due today",
      "unassigned",
      "in review",
    ]);
    expect(attention[0].badges).toEqual(["Critical", "Overdue"]);
    expect(attention[1].badges).toEqual(["Blocked"]);
    expect(attention[1].assignee).toBe("Dan Okafor");
    expect(attention[2].badges).toEqual(["Unassigned"]);
    expect("assignee" in attention[2]).toBe(false);
    expect(attention[3].badges).toEqual([{ tone: "Review", label: "Waiting Approval" }]);
    expect(titles(dubai.groups, "Due Today")).toEqual(["plain due today"]);
    expect(dubai.groups.find((g) => g.label === "Due Today")!.tasks[0].badges).toEqual(["High"]);
    expect(titles(dubai.groups, "Recently Completed")).toEqual(["finished"]);
    expect(attention[0].url).toBe(`${APP}/team?task=${snapshot.tasks[0].id}`);
    expect(dubai.summary).toBe("5 open tasks · 4 need attention · 1 completed");
    expect(content).toMatchObject({
      firstName: "Test",
      completedCount: "1",
      dueTodayCount: "2",
      overdueCount: "1",
      blockedCount: "1",
      reviewCount: "1",
      unassignedCount: "1",
      dashboardUrl: `${APP}/`,
    });
  });

  test("sees only organizations where the person is admin, manager or team lead", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ title: "dubai", organizationId: DUBAI, dueDate: "2026-09-24" }),
        task({ title: "tti", organizationId: KOLKATA, assigneeId: null, dueDate: "2026-09-24" }),
      ],
    });
    const lead = dailyManagementContent(args(snapshot, LEAD))!;
    expect(lead.organizations.map((o) => o.name)).toEqual([
      "Teachers' Training Institute of India",
    ]);
    expect(lead.overdueCount).toBe("1");
    expect(dailyManagementContent(args(snapshot, MAYA))).toBeNull();
  });

  test("a manager role counts, a viewer role does not", () => {
    const tasks = [task({ dueDate: "2026-09-24" })];
    const manager = baseSnapshot({ tasks, roles: [role(DAN, DUBAI, "manager")] });
    expect(dailyManagementContent(args(manager, DAN))).not.toBeNull();
    const viewer = baseSnapshot({ tasks, roles: [role(DAN, DUBAI, "viewer")] });
    expect(dailyManagementContent(args(viewer, DAN))).toBeNull();
  });

  test("an organization with nothing to report is dropped, and all-empty is null", () => {
    const snapshot = baseSnapshot({
      memberships: [membership(ADMIN, DUBAI), membership(ADMIN, KOLKATA, false)],
      roles: [role(ADMIN, DUBAI, "admin"), role(ADMIN, KOLKATA, "admin")],
      tasks: [task({ organizationId: KOLKATA, dueDate: "2026-09-24" })],
    });
    expect(dailyManagementContent(args(snapshot, ADMIN))!.organizations.map((o) => o.name)).toEqual(
      ["Teachers' Training Institute of India"],
    );
    expect(dailyManagementContent(args(baseSnapshot(), ADMIN))).toBeNull();
  });
});

describe("weekly management summary", () => {
  test("builds progress, attention, workload, project health and next week", () => {
    const snapshot = baseSnapshot({
      projects: [
        project(),
        project({ id: "p2", name: "Healthy project", dueDate: "2026-12-31" }),
        project({ id: "p3", name: "Finished project", status: "completed" }),
      ],
      tasks: [
        task({
          title: "shipped",
          status: "done",
          completedAt: "2026-09-22T10:00:00Z",
          projectId: PROJECT,
        }),
        task({ title: "late", dueDate: "2026-09-20", projectId: PROJECT }),
        task({ title: "stuck", blocked: true, assigneeId: DAN }),
        task({ title: "next tuesday", dueDate: "2026-09-29", assigneeId: DAN }),
        task({ title: "healthy work", projectId: "p2", status: "progress" }),
        task({
          title: "healthy done",
          projectId: "p2",
          status: "done",
          completedAt: "2026-09-01T10:00:00Z",
        }),
      ],
    });
    const content = weeklyManagementContent(args(snapshot, ADMIN))!;
    const sections = content.organizations[0].sections;
    expect(sections.map((s) => s.label)).toEqual([
      "Progress",
      "Needs Attention",
      "Team Workload",
      "Project Health",
      "Next Week",
    ]);
    expect(titles(sections, "Progress")).toEqual(["shipped"]);
    const progress = sections[0].items[0];
    expect(progress.badge).toBe("Completed");
    expect(progress.meta).toBe("Maya Chen · October Admissions Drive · Completed Tue, 22 Sep 2026");
    const attention = sections.find((s) => s.label === "Needs Attention")!.items;
    expect(attention.map((i) => [i.title, i.badge])).toEqual([
      ["late", "Overdue"],
      ["stuck", "Blocked"],
    ]);
    const workload = sections.find((s) => s.label === "Team Workload")!.items;
    expect(workload).toEqual([
      { title: "Dan Okafor", meta: "2 open tasks · 0 overdue" },
      { title: "Maya Chen", meta: "2 open tasks · 1 overdue" },
    ]);
    const health = sections.find((s) => s.label === "Project Health")!.items;
    expect(health.map((i) => [i.title, i.badge])).toEqual([
      ["October Admissions Drive", "Delayed"],
      ["Healthy project", "On track"],
    ]);
    expect(health[0].meta).toBe("50% complete · Deadline Sat, 31 Oct 2026");
    expect(health[0].url).toBe(`${APP}/projects?project=${PROJECT}`);
    expect(titles(sections, "Next Week")).toEqual(["next tuesday"]);
    expect(content.organizations[0].summary).toBe(
      "4 open tasks · 1 project needs attention · 1 completed",
    );
    expect(content).toMatchObject({
      dateRange: "Fri, 18 Sep – Thu, 24 Sep 2026",
      completedCount: "1",
      overdueCount: "1",
      blockedCount: "1",
      reviewCount: "0",
      attentionProjectCount: "1",
      nextWeekCount: "1",
    });
  });

  test("never includes an organization the person does not manage", () => {
    const snapshot = baseSnapshot({
      tasks: [task({ title: "dubai secret", dueDate: "2026-09-24" })],
    });
    expect(weeklyManagementContent(args(snapshot, LEAD))).toBeNull();
  });
});

const PRIYA = "50000000-0000-4000-8000-000000000005"; // a TTI-only colleague

describe("names in management summaries", () => {
  // Dan has left upCarrera (inactive membership); Priya was never in it.
  const snapshot = () => {
    const base = baseSnapshot();
    return baseSnapshot({
      people: [...base.people, person(PRIYA, "Priya Sharma", "priya@tti.test")],
      memberships: [
        ...base.memberships.filter((m) => m.userId !== DAN),
        membership(DAN, DUBAI, true, "inactive"),
        membership(PRIYA, KOLKATA),
      ],
      tasks: [
        task({ title: "cross-org", assigneeId: PRIYA, dueDate: "2026-09-24" }),
        task({ title: "former colleague", assigneeId: DAN, dueDate: "2026-09-24" }),
        task({
          title: "tti for maya",
          organizationId: KOLKATA,
          assigneeId: MAYA,
          dueDate: "2026-09-24",
        }),
      ],
    });
  };

  test("a person the recipient cannot see in the app is 'A teammate', in every section", () => {
    const daily = dailyManagementContent(args(snapshot(), ADMIN))!;
    const attention = daily.organizations[0].groups.find((g) => g.label === "Needs Attention")!;
    expect(attention.tasks.map((t) => [t.title, t.assignee])).toEqual([
      ["cross-org", "A teammate"],
      ["former colleague", "Dan Okafor"],
    ]);
    const weekly = weeklyManagementContent(args(snapshot(), ADMIN))!;
    const sections = weekly.organizations[0].sections;
    const needs = sections.find((s) => s.label === "Needs Attention")!.items;
    expect(needs.map((i) => i.meta)).toEqual([
      "A teammate · Due Thu, 24 Sep 2026",
      "Dan Okafor · Due Thu, 24 Sep 2026",
    ]);
    const workload = sections.find((s) => s.label === "Team Workload")!.items;
    expect(workload.map((i) => i.title).sort()).toEqual(["A teammate", "Dan Okafor"]);
    expect(JSON.stringify([daily, weekly])).not.toContain("Priya");
  });

  test("anyone sharing an organization with the recipient keeps their name", () => {
    // The lead manages TTI and is also in upCarrera, where Maya works.
    const lead = dailyManagementContent(args(snapshot(), LEAD))!;
    const tti = lead.organizations.find((o) => o.name.startsWith("Teachers"))!;
    expect(tti.groups[0].tasks.map((t) => t.assignee)).toEqual(["Maya Chen"]);
  });
});

describe("status labels in management summaries", () => {
  const withReview = (statusLabels = baseSnapshot().statusLabels) =>
    baseSnapshot({
      tasks: [task({ title: "awaiting sign-off", status: "review", dueDate: "2026-09-30" })],
      statusLabels,
    });

  test("the weekly summary uses the organization's name for review", () => {
    const labels = [
      { organizationId: DUBAI, value: "review", label: "Waiting Approval" },
      { organizationId: KOLKATA, value: "review", label: "QA check" },
    ];
    const weekly = weeklyManagementContent(args(withReview(labels), ADMIN))!;
    const needs = weekly.organizations[0].sections.find((s) => s.label === "Needs Attention")!;
    expect(needs.items.map((i) => [i.title, i.badge])).toEqual([
      ["awaiting sign-off", "Waiting Approval"],
    ]);
  });

  test("without a configured label it falls back to the app's own name for the status", () => {
    const weekly = weeklyManagementContent(args(withReview(), ADMIN))!;
    const needs = weekly.organizations[0].sections.find((s) => s.label === "Needs Attention")!;
    expect(needs.items[0].badge).toBe("Waiting Approval");
  });

  const waitingApproval = [{ organizationId: DUBAI, value: "review", label: "Waiting Approval" }];

  test("the weekly review badge keeps the review colour and names the tile", () => {
    const weekly = weeklyManagementContent(args(withReview(waitingApproval), ADMIN))!;
    const needs = weekly.organizations[0].sections.find((s) => s.label === "Needs Attention")!;
    expect(needs.items[0]).toMatchObject({ badge: "Waiting Approval", badgeTone: "Review" });
    expect(weekly.reviewLabel).toBe("Waiting Approval");
  });

  test("the daily review badge and tile use the organization's name", () => {
    const daily = dailyManagementContent(args(withReview(waitingApproval), ADMIN))!;
    const attention = daily.organizations[0].groups.find((g) => g.label === "Needs Attention")!;
    expect(attention.tasks[0].badges).toEqual([{ tone: "Review", label: "Waiting Approval" }]);
    expect(daily.reviewLabel).toBe("Waiting Approval");
  });

  test("organizations that name review differently keep the neutral tile caption", () => {
    const base = withReview([
      ...waitingApproval,
      { organizationId: KOLKATA, value: "review", label: "QA check" },
    ]);
    const snapshot = {
      ...base,
      memberships: [...base.memberships, membership(ADMIN, KOLKATA)],
      roles: [...base.roles, role(ADMIN, KOLKATA, "admin")],
      tasks: [
        ...base.tasks,
        task({
          title: "tti sign-off",
          organizationId: KOLKATA,
          status: "review",
          dueDate: "2026-09-30",
        }),
      ],
    };
    const daily = dailyManagementContent(args(snapshot, ADMIN))!;
    const badges = Object.fromEntries(
      daily.organizations.map((o) => [o.name, o.groups[0].tasks[0].badges]),
    );
    expect(badges).toEqual({
      upCarrera: [{ tone: "Review", label: "Waiting Approval" }],
      "Teachers' Training Institute of India": [{ tone: "Review", label: "QA check" }],
    });
    expect("reviewLabel" in daily).toBe(false);
    expect("reviewLabel" in weeklyManagementContent(args(snapshot, ADMIN))!).toBe(false);
  });
});

describe("project health", () => {
  test("progress comes from projectCounts, overdue from the open tasks in the snapshot", () => {
    const snapshot = baseSnapshot({
      projects: [
        project({ dueDate: "2026-12-31" }),
        project({ id: "p2", name: "Due next week", dueDate: "2026-10-01" }),
        project({ id: "p3", name: "Typo deadline", dueDate: "20266-01-01" }),
        project({ id: "p4", name: "Late work", dueDate: "2026-12-31" }),
        project({ id: "p5", name: "Never counted", dueDate: "2026-12-31" }),
      ],
      tasks: [
        // The snapshot keeps only open and recently closed tasks: nine done tasks closed
        // months ago exist only in the counts.
        task({ title: "last open", projectId: PROJECT }),
        task({ title: "p2 open", projectId: "p2" }),
        task({ title: "p3 open", projectId: "p3" }),
        task({ title: "p4 overdue", projectId: "p4", dueDate: "2026-09-20" }),
        task({ title: "p5 open", projectId: "p5" }),
      ],
      projectCounts: [
        { projectId: PROJECT, total: 10, done: 9 },
        { projectId: "p2", total: 4, done: 1 },
        { projectId: "p3", total: 2, done: 1 },
        { projectId: "p4", total: 3, done: 2 },
      ],
    });
    const weekly = weeklyManagementContent(args(snapshot, ADMIN))!;
    const health = weekly.organizations[0].sections.find((s) => s.label === "Project Health")!;
    expect(health.items.map((i) => [i.title, i.badge, i.meta])).toEqual([
      ["Late work", "Delayed", "67% complete · Deadline Thu, 31 Dec 2026"],
      ["Due next week", "At risk", "25% complete · Deadline Thu, 1 Oct 2026"],
      ["October Admissions Drive", "On track", "90% complete · Deadline Thu, 31 Dec 2026"],
      ["Typo deadline", "On track", "50% complete · No deadline"],
    ]);
    expect(weekly.attentionProjectCount).toBe("2");
  });

  test("a snapshot from an RPC without projectCounts still renders, as projects with no tasks", () => {
    const snapshot = {
      ...baseSnapshot({
        tasks: [task({ title: "late", dueDate: "2026-09-20", projectId: PROJECT })],
      }),
      projectCounts: undefined,
    } as unknown as EmailSnapshot;
    const weekly = weeklyManagementContent(args(snapshot, ADMIN))!;
    expect(weekly.organizations[0].sections.map((s) => s.label)).not.toContain("Project Health");
  });
});

describe("projects in management summaries", () => {
  // The snapshot bypasses row-level security, so a summary must show a team lead only the
  // projects they are part of, as the app does (20260930000100_project_access.sql). The lead is
  // team lead in TTI; Priya owns and runs a TTI project the lead is not on.
  const TTI_PROJECT = "p0000000-0000-4000-8000-000000000002";
  const ttiSnapshot = (
    options: {
      project?: Partial<SnapshotProject>;
      members?: SnapshotProjectMember[];
      tasks?: SnapshotTask[];
    } = {},
  ) => {
    const base = baseSnapshot();
    const inTti = (overrides: Partial<SnapshotTask>) =>
      task({ organizationId: KOLKATA, assigneeId: PRIYA, createdBy: PRIYA, ...overrides });
    return baseSnapshot({
      people: [...base.people, person(PRIYA, "Priya Sharma", "priya@tti.test")],
      memberships: [
        ...base.memberships,
        membership(PRIYA, KOLKATA),
        membership(DAN, KOLKATA, false),
      ],
      roles: [...base.roles, role(PRIYA, KOLKATA, "employee"), role(DAN, KOLKATA, "manager")],
      projects: [
        project({
          id: TTI_PROJECT,
          organizationId: KOLKATA,
          name: "Batch 12 Onboarding",
          ownerId: PRIYA,
          managerId: PRIYA,
          ...options.project,
        }),
      ],
      projectMembers: options.members ?? [
        { projectId: TTI_PROJECT, userId: PRIYA, roleLabel: null },
      ],
      tasks: [
        inTti({ title: "project late", projectId: TTI_PROJECT, dueDate: "2026-09-24" }),
        inTti({
          title: "project shipped",
          projectId: TTI_PROJECT,
          status: "done",
          completedAt: "2026-09-22T10:00:00Z",
        }),
        inTti({ title: "loose late", dueDate: "2026-09-24" }),
        ...(options.tasks ?? []),
      ],
    });
  };

  const dailyTitles = (snapshot: EmailSnapshot, userId: string) =>
    (dailyManagementContent(args(snapshot, userId))?.organizations ?? [])
      .flatMap((o) => o.groups.flatMap((g) => g.tasks.map((t) => t.title)))
      .sort();
  const weeklySections = (snapshot: EmailSnapshot, userId: string) =>
    weeklyManagementContent(args(snapshot, userId))?.organizations.find((o) =>
      o.name.startsWith("Teachers"),
    )?.sections ?? [];
  const weeklyTitles = (snapshot: EmailSnapshot, userId: string) =>
    weeklySections(snapshot, userId)
      .filter((s) => s.label !== "Team Workload" && s.label !== "Project Health")
      .flatMap((s) => s.items.map((i) => i.title))
      .sort();
  const healthOf = (snapshot: EmailSnapshot, userId: string) =>
    titles(weeklySections(snapshot, userId), "Project Health");

  test("a team lead who is not on the project sees none of its tasks and not its health", () => {
    const snapshot = ttiSnapshot();
    expect(dailyTitles(snapshot, LEAD)).toEqual(["loose late"]);
    expect(dailyManagementContent(args(snapshot, LEAD))).toMatchObject({
      overdueCount: "1",
      completedCount: "0",
    });
    expect(weeklyTitles(snapshot, LEAD)).toEqual(["loose late"]);
    expect(healthOf(snapshot, LEAD)).toEqual([]);
    const weekly = weeklyManagementContent(args(snapshot, LEAD))!;
    expect(weekly.organizations[0].summary).toBe(
      "1 open task · 0 projects need attention · 0 completed",
    );
    const everything = JSON.stringify([dailyManagementContent(args(snapshot, LEAD)), weekly]);
    expect(everything).not.toContain("Batch 12");
    expect(everything).not.toContain("project late");
    expect(everything).not.toContain("project shipped");
  });

  test("on the team, as owner or as Project Manager, a team lead sees its tasks and health", () => {
    const ways = [
      ttiSnapshot({
        members: [
          { projectId: TTI_PROJECT, userId: PRIYA, roleLabel: null },
          { projectId: TTI_PROJECT, userId: LEAD, roleLabel: "Coordinator" },
        ],
      }),
      ttiSnapshot({ project: { ownerId: LEAD } }),
      ttiSnapshot({ project: { managerId: LEAD } }),
    ];
    for (const snapshot of ways) {
      // Daily lists what is completed since yesterday's start, so "project shipped" is weekly only.
      expect(dailyTitles(snapshot, LEAD)).toEqual(["loose late", "project late"]);
      expect(weeklyTitles(snapshot, LEAD)).toEqual([
        "loose late",
        "project late",
        "project shipped",
      ]);
      expect(healthOf(snapshot, LEAD)).toEqual(["Batch 12 Onboarding"]);
    }
  });

  test("a manager sees every project in the organization without being on it", () => {
    const snapshot = ttiSnapshot();
    expect(dailyTitles(snapshot, DAN)).toEqual(["loose late", "project late"]);
    expect(weeklyTitles(snapshot, DAN)).toEqual(["loose late", "project late", "project shipped"]);
    expect(healthOf(snapshot, DAN)).toEqual(["Batch 12 Onboarding"]);
  });

  test("tasks with no project reach every team lead of the organization, as before", () => {
    const snapshot = ttiSnapshot({
      tasks: [task({ title: "loose unassigned", organizationId: KOLKATA, assigneeId: null })],
    });
    expect(dailyTitles(snapshot, LEAD)).toEqual(["loose late", "loose unassigned"]);
  });

  test("a team lead keeps their own task in a project they are not on, without its health", () => {
    const snapshot = ttiSnapshot({
      tasks: [
        task({
          title: "lead's own",
          organizationId: KOLKATA,
          projectId: TTI_PROJECT,
          assigneeId: LEAD,
          dueDate: "2026-09-24",
        }),
      ],
    });
    expect(dailyTitles(snapshot, LEAD)).toEqual(["lead's own", "loose late"]);
    expect(healthOf(snapshot, LEAD)).toEqual([]);
  });

  test("what the snapshot cannot settle is left out for everyone but admins and managers", () => {
    // A snapshot RPC from before ownerId was added: the lead is on the team, but it can't be told.
    const legacy = ttiSnapshot({
      members: [{ projectId: TTI_PROJECT, userId: LEAD, roleLabel: null }],
    });
    const stripped = {
      ...legacy,
      projects: legacy.projects.map(({ ownerId: _o, managerId: _m, ...rest }) => rest),
    } as unknown as EmailSnapshot;
    expect(dailyTitles(stripped, LEAD)).toEqual(["loose late"]);
    expect(healthOf(stripped, LEAD)).toEqual([]);
    expect(dailyTitles(stripped, DAN)).toEqual(["loose late", "project late"]);
    // An archived project is not in the snapshot, though its open tasks are.
    const archived = ttiSnapshot({
      members: [{ projectId: "p-archived", userId: LEAD, roleLabel: null }],
      tasks: [
        task({
          title: "archived project's",
          organizationId: KOLKATA,
          projectId: "p-archived",
          assigneeId: PRIYA,
          dueDate: "2026-09-24",
        }),
      ],
    });
    expect(dailyTitles(archived, LEAD)).toEqual(["loose late"]);
    expect(dailyTitles(archived, DAN)).toEqual([
      "archived project's",
      "loose late",
      "project late",
    ]);
  });
});
