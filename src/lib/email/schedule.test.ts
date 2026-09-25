// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import {
  ADMIN,
  DAN,
  DUBAI,
  FRIDAY_0830_DUBAI,
  KOLKATA,
  LEAD,
  MAYA,
  PROJECT,
  allKinds,
  baseSnapshot,
  membership,
  org,
  person,
  role,
  task,
} from "./fixtures";
import { orgClock, planScheduledEmails, TASK_EMAILS_PER_DAY, taskKindFor } from "./schedule";
import type { EmailSnapshot, OutboxInsert, SnapshotTask } from "./snapshot";

const at = (iso: string) => new Date(iso);
const kinds = (rows: OutboxInsert[]) => rows.map((row) => row.kind).sort();
const keys = (rows: OutboxInsert[]) => rows.map((row) => row.dedupeKey).sort();
const ofKind = (rows: OutboxInsert[], kind: string) => rows.filter((row) => row.kind === kind);
const forUser = (rows: OutboxInsert[], userId: string) =>
  rows.filter((row) => row.recipientUserId === userId);

/** Only Maya, only Dubai: isolates task-level rules from everyone else's digests. */
function mayaOnly(tasks: SnapshotTask[], overrides: Partial<EmailSnapshot> = {}): EmailSnapshot {
  const base = baseSnapshot();
  return {
    ...base,
    people: base.people.filter((p) => p.userId === MAYA),
    tasks,
    ...overrides,
  };
}

// Dates used below (all 2026): Thu 24 Sep, Fri 25, Sat 26, Sun 27, Mon 28, Tue 29 Sep.
const FRI = FRIDAY_0830_DUBAI; // 08:30 Dubai
const MON_0830_DUBAI = at("2026-09-28T04:30:00Z");
const TUE_0830_DUBAI = at("2026-09-29T04:30:00Z");
const SAT_0830_DUBAI = at("2026-09-26T04:30:00Z");

describe("send window", () => {
  const snapshot = () => mayaOnly([task({ dueDate: "2026-09-26" })]);

  test("opens at the send hour and closes three hours later, in the org's timezone", () => {
    expect(planScheduledEmails(snapshot(), at("2026-09-25T03:59:59Z"))).toEqual([]); // 07:59 Dubai
    expect(planScheduledEmails(snapshot(), at("2026-09-25T04:00:00Z")).length).toBeGreaterThan(0); // 08:00
    expect(planScheduledEmails(snapshot(), at("2026-09-25T06:59:59Z")).length).toBeGreaterThan(0); // 10:59
    expect(planScheduledEmails(snapshot(), at("2026-09-25T07:00:00Z"))).toEqual([]); // 11:00
  });

  test("Kolkata's window is Kolkata's 08:00–11:00, not Dubai's", () => {
    const tti = baseSnapshot({
      people: [person(LEAD, "Lakshmi Iyer", "lead@tti.test")],
      memberships: [membership(LEAD, KOLKATA)],
      roles: [role(LEAD, KOLKATA, "employee")],
      tasks: [task({ organizationId: KOLKATA, assigneeId: LEAD, dueDate: "2026-09-26" })],
    });
    expect(planScheduledEmails(tti, at("2026-09-25T02:29:00Z"))).toEqual([]); // 07:59 IST
    expect(kinds(planScheduledEmails(tti, at("2026-09-25T02:30:00Z")))).toContain("due_reminder");
    expect(planScheduledEmails(tti, at("2026-09-25T05:30:00Z"))).toEqual([]); // 11:00 IST
  });

  test("expiresAt is the window's end and notBefore is now", () => {
    const [row] = ofKind(planScheduledEmails(snapshot(), FRI), "due_reminder");
    expect(row.notBefore).toBe(FRI.toISOString());
    expect(row.expiresAt).toBe("2026-09-25T07:00:00.000Z");
  });

  test("honours a custom send hour", () => {
    const late = mayaOnly([task({ dueDate: "2026-09-26" })], {
      organizations: [org(DUBAI, "upCarrera", "Asia/Dubai", { sendHour: 14 })],
    });
    expect(planScheduledEmails(late, FRI)).toEqual([]);
    expect(planScheduledEmails(late, at("2026-09-25T10:15:00Z")).length).toBeGreaterThan(0); // 14:15
  });

  test("send hours 22 and 23: the window and the rows' expiry both stop at local midnight", () => {
    for (const sendHour of [22, 23]) {
      const clock = orgClock(
        org(DUBAI, "upCarrera", "Asia/Dubai", { sendHour }),
        at("2026-09-25T19:30:00Z"),
      );
      expect(clock.inWindow).toBe(true); // 23:30 Dubai
      // Not 01:00/02:00 Saturday: a row sent after midnight would carry Saturday's tasks.
      expect(clock.expiresAt).toBe("2026-09-25T20:00:00.000Z"); // 00:00 Saturday, Dubai
      expect(orgClock(clock.org, at("2026-09-25T20:30:00Z")).inWindow).toBe(false);
    }
    const kolkata = orgClock(
      org(KOLKATA, "TTI", "Asia/Kolkata", { sendHour: 23 }),
      at("2026-09-25T17:45:00Z"), // 23:15 IST
    );
    expect(kolkata.inWindow).toBe(true);
    expect(kolkata.expiresAt).toBe("2026-09-25T18:30:00.000Z"); // 00:00 Saturday, IST
  });

  test("an earlier window still expires at its own end, before midnight", () => {
    const clock = orgClock(
      org(DUBAI, "upCarrera", "Asia/Dubai", { sendHour: 20 }),
      at("2026-09-25T16:30:00Z"), // 20:30 Dubai
    );
    expect(clock.expiresAt).toBe("2026-09-25T19:00:00.000Z"); // 23:00 Dubai
    const late = mayaOnly([task({ dueDate: "2026-09-26" })], {
      organizations: [org(DUBAI, "upCarrera", "Asia/Dubai", { sendHour: 23 })],
    });
    const rows = planScheduledEmails(late, at("2026-09-25T19:58:00Z")); // 23:58 Dubai
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.expiresAt))).toEqual(
      new Set(["2026-09-25T20:00:00.000Z"]),
    );
  });
});

describe("working days and the weekly day", () => {
  test("daily kinds skip non-working days", () => {
    const rows = planScheduledEmails(
      baseSnapshot({ tasks: [task({ dueDate: "2026-09-27" })] }),
      SAT_0830_DUBAI,
    );
    expect(rows).toEqual([]);
  });

  test("weekly kinds go out on the weekly day only, even when it is not a working day", () => {
    const snapshot = baseSnapshot({
      organizations: [
        org(DUBAI, "upCarrera", "Asia/Dubai", { weeklyDay: 6 }),
        org(KOLKATA, "TTI", "Asia/Kolkata"),
      ],
      tasks: [task({ dueDate: "2026-09-30" })],
    });
    expect(kinds(forUser(planScheduledEmails(snapshot, SAT_0830_DUBAI), MAYA))).toEqual([
      "weekly_digest",
    ]);
    expect(ofKind(planScheduledEmails(snapshot, FRI), "weekly_digest")).toEqual([]);
  });

  test("with the default Monday weekly day, Monday has daily and weekly kinds", () => {
    const rows = forUser(
      planScheduledEmails(
        baseSnapshot({ tasks: [task({ dueDate: "2026-09-30" })] }),
        MON_0830_DUBAI,
      ),
      MAYA,
    );
    expect(kinds(rows)).toEqual(["daily_digest", "weekly_digest"]);
  });

  test("a Sunday–Thursday week sends on Sunday and not on Friday", () => {
    const snapshot = mayaOnly([task({ dueDate: "2026-09-28" })], {
      organizations: [org(DUBAI, "upCarrera", "Asia/Dubai", { workingDays: [7, 1, 2, 3, 4] })],
    });
    expect(planScheduledEmails(snapshot, FRI)).toEqual([]);
    expect(kinds(planScheduledEmails(snapshot, at("2026-09-27T04:30:00Z")))).toContain(
      "due_reminder",
    );
  });
});

describe("due-date reminders", () => {
  test("Friday reminds about everything due through Monday (the weekend included)", () => {
    const due = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"];
    const tasks = due.map((dueDate) => task({ dueDate }));
    const reminders = ofKind(planScheduledEmails(mayaOnly(tasks), FRI), "due_reminder");
    expect(reminders.map((row) => row.payload.due).sort()).toEqual([
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
    ]);
  });

  test("at most TASK_EMAILS_PER_DAY per person, the most urgent first", () => {
    const priorities = ["low", "critical", "medium", "high"] as const;
    const tasks = Array.from({ length: 14 }, (_, i) =>
      task({
        dueDate: "2026-09-29",
        title: `T${String(i).padStart(2, "0")}`,
        priority: priorities[i % 4],
      }),
    );
    const reminders = ofKind(planScheduledEmails(mayaOnly(tasks), MON_0830_DUBAI), "due_reminder");
    expect(reminders).toHaveLength(TASK_EMAILS_PER_DAY);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const order = reminders.map((row) => byId.get(row.taskId!)!.priority);
    // Every critical and high task is kept, in that order; the 4 dropped are the least urgent.
    expect(order.slice(0, 7)).toEqual([
      "critical",
      "critical",
      "critical",
      "critical",
      "high",
      "high",
      "high",
    ]);
    expect(order.filter((p) => p === "low")).toHaveLength(0);
  });

  test("midweek reminds about the next day only", () => {
    const tasks = [task({ dueDate: "2026-09-29" }), task({ dueDate: "2026-09-30" })];
    const reminders = ofKind(planScheduledEmails(mayaOnly(tasks), MON_0830_DUBAI), "due_reminder");
    expect(reminders.map((row) => row.payload.due)).toEqual(["2026-09-29"]);
  });

  test("row shape: dedupe key, org, task, project and payload", () => {
    const t = task({ dueDate: "2026-09-28", projectId: PROJECT });
    const [row] = ofKind(planScheduledEmails(mayaOnly([t]), FRI), "due_reminder");
    expect(row).toEqual({
      kind: "due_reminder",
      dedupeKey: `due_reminder:${t.id}:2026-09-28`,
      recipientUserId: MAYA,
      organizationId: DUBAI,
      taskId: t.id,
      projectId: PROJECT,
      payload: { localDate: "2026-09-25", timezone: "Asia/Dubai", due: "2026-09-28" },
      notBefore: FRI.toISOString(),
      expiresAt: "2026-09-25T07:00:00.000Z",
    });
  });

  test("a due_at-only task is due on the org's calendar day", () => {
    // 01:00 Saturday in Dubai, but still Friday in UTC.
    const t = task({ dueAt: "2026-09-25T21:00:00.000Z" });
    const [row] = ofKind(planScheduledEmails(mayaOnly([t]), FRI), "due_reminder");
    expect(row.payload.due).toBe("2026-09-26");
  });

  test("closed, unassigned and dateless tasks get nothing", () => {
    const tasks = [
      task({ dueDate: "2026-09-28", status: "done" }),
      task({ dueDate: "2026-09-28", status: "cancelled" }),
      task({ dueDate: "2026-09-28", assigneeId: null }),
      task({ dueDate: null }),
    ];
    expect(ofKind(planScheduledEmails(mayaOnly(tasks), FRI), "due_reminder")).toEqual([]);
  });
});

describe("overdue alerts", () => {
  test("Monday alerts about what fell due Friday, Saturday and Sunday", () => {
    const due = ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"];
    const alerts = ofKind(
      planScheduledEmails(mayaOnly(due.map((dueDate) => task({ dueDate }))), MON_0830_DUBAI),
      "overdue_alert",
    );
    expect(alerts.map((row) => row.payload.due).sort()).toEqual([
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
    ]);
  });

  test("Tuesday alerts about Monday only: each due date is alerted exactly once", () => {
    const due = ["2026-09-25", "2026-09-28"];
    const alerts = ofKind(
      planScheduledEmails(mayaOnly(due.map((dueDate) => task({ dueDate }))), TUE_0830_DUBAI),
      "overdue_alert",
    );
    expect(alerts.map((row) => row.payload.due)).toEqual(["2026-09-28"]);
  });

  test("no flood on launch: long-overdue tasks never get an alert", () => {
    const old = ["2026-01-15", "2026-08-01", "2026-09-10", "2026-09-23"].map((dueDate) =>
      task({ dueDate }),
    );
    expect(ofKind(planScheduledEmails(mayaOnly(old), FRI), "overdue_alert")).toEqual([]);
  });

  test("dedupe key is per task and due date", () => {
    const t = task({ dueDate: "2026-09-24" });
    const [row] = ofKind(planScheduledEmails(mayaOnly([t]), FRI), "overdue_alert");
    expect(row.dedupeKey).toBe(`overdue_alert:${t.id}:2026-09-24`);
  });

  test("taskKindFor never returns both kinds for one date", () => {
    const clock = orgClock(org(DUBAI, "upCarrera", "Asia/Dubai"), FRI);
    expect(taskKindFor("2026-09-25", clock)).toBeNull(); // due today: the digest covers it
    expect(taskKindFor("2026-09-24", clock)).toBe("overdue_alert");
    expect(taskKindFor("2026-09-23", clock)).toBeNull();
    expect(taskKindFor("2026-09-28", clock)).toBe("due_reminder");
  });
});

describe("idempotence", () => {
  test("every tick in the window plans the same dedupe keys", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ dueDate: "2026-09-24" }),
        task({ dueDate: "2026-09-28" }),
        task({ assigneeId: DAN, dueDate: "2026-09-25" }),
      ],
    });
    const first = keys(planScheduledEmails(snapshot, at("2026-09-25T04:00:00Z")));
    const later = keys(planScheduledEmails(snapshot, at("2026-09-25T06:55:00Z")));
    expect(first.length).toBeGreaterThan(0);
    expect(later).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  test("digest dedupe keys are per person and local date", () => {
    const snapshot = baseSnapshot({ tasks: [task({ dueDate: "2026-09-25" })] });
    const [digest] = ofKind(planScheduledEmails(snapshot, FRI), "daily_digest");
    expect(digest.dedupeKey).toBe(`daily_digest:${MAYA}:2026-09-25`);
    expect(digest.payload).toEqual({ localDate: "2026-09-25", timezone: "Asia/Dubai" });
    expect(digest.taskId).toBeNull();
  });
});

describe("preferences and organization toggles", () => {
  const tasks = () => [task({ dueDate: "2026-09-28" }), task({ dueDate: "2026-09-24" })];

  test("a person's preference switches a kind off for them only", () => {
    const snapshot = mayaOnly(tasks(), {
      preferences: [{ userId: MAYA, ...allKinds(), due_reminder: false, daily_digest: false }],
    });
    expect(kinds(planScheduledEmails(snapshot, FRI))).toEqual(["overdue_alert"]);
  });

  test("an organization toggle switches a kind off for everyone in it", () => {
    const snapshot = mayaOnly(tasks(), {
      organizations: [org(DUBAI, "upCarrera", "Asia/Dubai", { overdue_alert: false })],
    });
    expect(kinds(planScheduledEmails(snapshot, FRI))).toEqual(["daily_digest", "due_reminder"]);
  });

  test("the organization master switch stops everything", () => {
    const snapshot = mayaOnly(tasks(), {
      organizations: [org(DUBAI, "upCarrera", "Asia/Dubai", { enabled: false })],
    });
    expect(planScheduledEmails(snapshot, FRI)).toEqual([]);
  });
});

describe("who can receive", () => {
  test("inactive people and people without an email get nothing", () => {
    const tasks = [
      task({ dueDate: "2026-09-28" }),
      task({ assigneeId: DAN, dueDate: "2026-09-28" }),
    ];
    const snapshot = baseSnapshot({
      people: [
        person(MAYA, "Maya Chen", "maya@x.test", "inactive"),
        person(DAN, "Dan Okafor", null),
      ],
      tasks,
    });
    expect(planScheduledEmails(snapshot, FRI)).toEqual([]);
  });

  test("a task in an organization the assignee has left sends nothing", () => {
    const base = baseSnapshot();
    const snapshot = mayaOnly([task({ dueDate: "2026-09-28" })], {
      memberships: base.memberships.map((m) =>
        m.userId === MAYA ? { ...m, status: "inactive" } : m,
      ),
    });
    expect(planScheduledEmails(snapshot, FRI)).toEqual([]);
  });

  test("empty digests are not queued", () => {
    const rows = planScheduledEmails(baseSnapshot({ tasks: [] }), FRI);
    expect(ofKind(rows, "daily_digest")).toEqual([]);
  });
});

describe("per-person timing follows the primary organization", () => {
  // The lead is primary in Kolkata and also a Dubai employee with a Dubai task due today.
  const snapshot = () =>
    baseSnapshot({
      tasks: [task({ assigneeId: LEAD, dueDate: "2026-09-25", title: "Dubai task" })],
    });

  test("in Kolkata's window (and outside Dubai's) the digest goes out", () => {
    const rows = forUser(planScheduledEmails(snapshot(), at("2026-09-25T02:45:00Z")), LEAD); // 08:15 IST, 06:45 GST
    expect(kinds(rows)).toEqual(["daily_digest"]);
    expect(rows[0].organizationId).toBe(KOLKATA);
    expect(rows[0].expiresAt).toBe("2026-09-25T05:30:00.000Z");
  });

  test("in Dubai's window (and outside Kolkata's) it does not", () => {
    expect(forUser(planScheduledEmails(snapshot(), at("2026-09-25T05:45:00Z")), LEAD)).toEqual([]); // 11:15 IST
  });

  test("without an isPrimary flag, the first active membership by organization id decides", () => {
    const base = snapshot();
    const unflagged = {
      ...base,
      memberships: base.memberships.map((m) =>
        m.userId === LEAD ? { ...m, isPrimary: false } : m,
      ),
    };
    // DUBAI's id sorts before KOLKATA's, so Dubai's window now applies.
    expect(
      kinds(forUser(planScheduledEmails(unflagged, at("2026-09-25T05:45:00Z")), LEAD)),
    ).toEqual(["daily_digest"]);
    expect(forUser(planScheduledEmails(unflagged, at("2026-09-25T02:45:00Z")), LEAD)).toEqual([]);
  });

  test("the primary organization's calendar applies even when it has email switched off", () => {
    const base = snapshot();
    const disabled = {
      ...base,
      organizations: [
        org(DUBAI, "upCarrera", "Asia/Dubai"),
        org(KOLKATA, "TTI", "Asia/Kolkata", { enabled: false }),
      ],
    };
    expect(kinds(forUser(planScheduledEmails(disabled, at("2026-09-25T02:45:00Z")), LEAD))).toEqual(
      ["daily_digest"],
    );
  });
});

describe("management summaries", () => {
  const work = () => [
    task({ dueDate: "2026-09-24", title: "Dubai overdue" }),
    task({
      organizationId: KOLKATA,
      assigneeId: null,
      dueDate: "2026-09-25",
      title: "TTI unassigned",
    }),
  ];

  test("only admins, managers and team leads receive them", () => {
    const rows = ofKind(
      planScheduledEmails(baseSnapshot({ tasks: work() }), at("2026-09-25T04:15:00Z")),
      "daily_management",
    );
    // 08:15 Dubai is the admin's window; 09:45 IST is also inside the lead's.
    expect(rows.map((row) => row.recipientUserId).sort()).toEqual([ADMIN, LEAD].sort());
  });

  test("a role without an active membership does not count", () => {
    const base = baseSnapshot({ tasks: work() });
    const snapshot = {
      ...base,
      memberships: base.memberships.map((m) =>
        m.userId === ADMIN ? { ...m, status: "inactive" } : m,
      ),
    };
    expect(forUser(planScheduledEmails(snapshot, FRI), ADMIN)).toEqual([]);
  });

  test("nothing to report in the managed organization means no summary", () => {
    // The lead manages Kolkata only; with no Kolkata tasks there is nothing to summarise.
    const snapshot = baseSnapshot({ tasks: [task({ dueDate: "2026-09-24" })] });
    expect(ofKind(forUser(planScheduledEmails(snapshot, FRI), LEAD), "daily_management")).toEqual(
      [],
    );
  });

  test("weekly management goes out on the weekly day with a stable key", () => {
    const rows = ofKind(
      planScheduledEmails(baseSnapshot({ tasks: work() }), MON_0830_DUBAI),
      "weekly_management",
    );
    expect(rows.map((row) => row.dedupeKey)).toContain(`weekly_management:${ADMIN}:2026-09-28`);
  });
});

describe("one bad record cannot stop planning", () => {
  test("a due date with a typo'd five-digit year plans as no deadline instead of throwing", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({ title: "typo", dueDate: "20266-09-02", status: "review", assigneeId: null }),
        task({ title: "typo mine", dueDate: "20266-09-02", assigneeId: MAYA }),
        task({ dueDate: "2026-09-29", assigneeId: DAN }),
      ],
    });
    const skips: unknown[] = [];
    const rows = planScheduledEmails(snapshot, MON_0830_DUBAI, (skip) => skips.push(skip));
    expect(skips).toEqual([]);
    expect(kinds(forUser(rows, ADMIN))).toEqual(["daily_management", "weekly_management"]);
    expect(kinds(forUser(rows, MAYA))).toEqual(["weekly_digest"]);
    expect(kinds(forUser(rows, DAN))).toEqual(["daily_digest", "due_reminder", "weekly_digest"]);
  });

  test("a record that throws is reported and costs only the emails that read it", () => {
    const corrupt = task({ assigneeId: DAN, dueDate: "2026-09-26" });
    Object.defineProperty(corrupt, "title", {
      get() {
        throw new Error("corrupt title");
      },
    });
    const broken = task({ assigneeId: MAYA, dueDate: "2026-09-26" });
    Object.defineProperty(broken, "status", {
      get() {
        throw new Error("corrupt status");
      },
    });
    const snapshot = baseSnapshot({
      tasks: [corrupt, broken, task({ assigneeId: MAYA, dueDate: "2026-09-26" })],
    });
    const skips: { scope: string; id: string; error: unknown }[] = [];
    const rows = planScheduledEmails(snapshot, FRI, (skip) => skips.push(skip));
    const reported = skips.map(
      (skip) => `${skip.scope} ${skip.id}: ${(skip.error as Error).message}`,
    );
    // The reminder planner never reads a title, so for that task only Dan's digest (which lists
    // it) is lost; the unreadable status costs its own reminder and the digests that list it.
    expect(reported.sort()).toEqual(
      [
        `person ${ADMIN} daily_management: corrupt status`,
        `person ${DAN} daily_digest: corrupt title`,
        `person ${MAYA} daily_digest: corrupt status`,
        `task ${broken.id}: corrupt status`,
      ].sort(),
    );
    expect(ofKind(rows, "due_reminder").map((row) => row.taskId)).toEqual([
      corrupt.id,
      snapshot.tasks[2].id,
    ]);
  });
});
