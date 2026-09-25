// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import { composeEmail, type ComposeResult, type ComposedEmail } from "./compose";
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
  allKinds,
  baseSnapshot,
  claimed,
  membership,
  org,
  person,
  project,
  task,
} from "./fixtures";
import type { ClaimedEmail, EmailSnapshot } from "./snapshot";

const ctx = { appUrl: APP, now: FRIDAY_0830_DUBAI };

function sent(result: ComposeResult): ComposedEmail {
  if (result.outcome !== "send") throw new Error(`expected send, got suppress: ${result.reason}`);
  return result;
}

function reason(result: ComposeResult): string {
  if (result.outcome !== "suppress") throw new Error(`expected suppress, got "${result.subject}"`);
  return result.reason;
}

const compose = (row: ClaimedEmail, snapshot: EmailSnapshot) => composeEmail(row, snapshot, ctx);

describe("recipient checks (every kind)", () => {
  const t = task({ dueDate: "2026-09-28" });
  const row = claimed({ kind: "task_assigned", taskId: t.id });

  test("missing recipient", () => {
    expect(reason(compose({ ...row, recipientUserId: null }, baseSnapshot({ tasks: [t] })))).toBe(
      "recipient no longer exists",
    );
    expect(
      reason(compose({ ...row, recipientUserId: "nobody" }, baseSnapshot({ tasks: [t] }))),
    ).toBe("recipient no longer exists");
  });

  test("inactive recipient", () => {
    const snapshot = baseSnapshot({
      tasks: [t],
      people: [person(MAYA, "Maya", "maya@x.test", "inactive")],
    });
    expect(reason(compose(row, snapshot))).toBe("recipient is inactive");
  });

  test("recipient without an email", () => {
    const snapshot = baseSnapshot({ tasks: [t], people: [person(MAYA, "Maya", "  ")] });
    expect(reason(compose(row, snapshot))).toBe("recipient has no email address");
  });

  test("recipient who left the organization", () => {
    const base = baseSnapshot({ tasks: [t] });
    const snapshot = { ...base, memberships: base.memberships.filter((m) => m.userId !== MAYA) };
    expect(reason(compose(row, snapshot))).toBe(
      "recipient is no longer an active member of the organization",
    );
  });

  test("unknown kind", () => {
    const odd = { ...row, kind: "newsletter" } as unknown as ClaimedEmail;
    expect(reason(compose(odd, baseSnapshot()))).toBe("unknown email kind: newsletter");
  });
});

describe("account_access", () => {
  const row = claimed({ kind: "account_access", organizationId: null, actorId: null });

  test("links to the reset flow with the email prefilled, and never contains a password", () => {
    const email = sent(compose(row, baseSnapshot()));
    expect(email.to).toBe("maya@upcarrera.test");
    expect(email.toName).toBe("Maya Chen");
    expect(email.subject).toBe("Your Flowdesk account is ready");
    expect(email.html).toContain(`${APP}/auth?mode=reset&amp;email=maya%40upcarrera.test`);
    expect(email.html).toContain(`href="${APP}/auth"`);
    expect(email.html.toLowerCase()).not.toContain("password:");
    expect(email.html).toContain("Hi Maya,");
  });

  test("cannot be switched off by preferences or organization settings", () => {
    const snapshot = baseSnapshot({
      preferences: [{ userId: MAYA, ...allKinds(false) }],
      organizations: [org(DUBAI, "upCarrera", "Asia/Dubai", { enabled: false })],
    });
    expect(compose(row, snapshot).outcome).toBe("send");
  });

  test("still needs a live, active recipient", () => {
    const snapshot = baseSnapshot({ people: [person(MAYA, "Maya", "maya@x.test", "inactive")] });
    expect(reason(compose(row, snapshot))).toBe("recipient is inactive");
  });

  test("is withdrawn when the person no longer belongs to any organization", () => {
    const removed = baseSnapshot({ memberships: [] });
    expect(reason(compose(row, removed))).toBe("recipient no longer belongs to any organization");
    const inactive = baseSnapshot();
    const only = inactive.memberships.map((m) =>
      m.userId === MAYA ? { ...m, status: "inactive" } : m,
    );
    expect(reason(compose(row, { ...inactive, memberships: only }))).toBe(
      "recipient no longer belongs to any organization",
    );
  });

  test("falls back to the sign-up name, then the email's local part", () => {
    const snapshot = baseSnapshot({ people: [person(MAYA, null, "maya.chen@x.test")] });
    const named = sent(compose({ ...row, payload: { fullName: "Maya Chen" } }, snapshot));
    expect(named.html).toContain("Hi Maya,");
    expect(named.toName).toBe("Maya Chen");
    const bare = sent(compose(row, snapshot));
    expect(bare.html).toContain("Hi maya.chen,");
    expect(bare.toName).toBe("");
  });
});

describe("task_assigned", () => {
  const t = task({
    title: "Upload fee reconciliation",
    dueDate: "2026-09-28",
    priority: "critical",
    projectId: PROJECT,
  });
  const row = claimed({ kind: "task_assigned", taskId: t.id, projectId: PROJECT });

  test("formats every field", () => {
    const email = sent(compose(row, baseSnapshot({ tasks: [t] })));
    expect(email.subject).toBe("Task assigned to you: Upload fee reconciliation");
    expect(email.html).toContain("Test Admin has assigned you a task");
    expect(email.html).toContain("Mon, 28 Sep 2026");
    expect(email.html).toContain(">Critical<");
    expect(email.html).toContain(">October Admissions Drive<");
    expect(email.html).toContain(">upCarrera<");
    expect(email.html).toContain(`href="${APP}/my-tasks?task=${t.id}"`);
  });

  test("uses the organization's priority label when it has one", () => {
    const snapshot = baseSnapshot({
      tasks: [t],
      priorityLabels: [{ organizationId: DUBAI, value: "critical", label: "P1 Urgent" }],
    });
    expect(sent(compose(row, snapshot)).html).toContain(">P1 Urgent<");
  });

  test("an unknown or missing actor reads 'A teammate'; no project leaves the row out; no due date reads 'Not set'", () => {
    const loose = task({ projectId: null, dueDate: null });
    const email = sent(
      compose({ ...row, taskId: loose.id, actorId: null }, baseSnapshot({ tasks: [loose] })),
    );
    expect(email.html).toContain("A teammate has assigned you a task");
    expect(email.html).not.toContain(">Project<");
    expect(email.html).toContain(">Not set<");
  });

  test("an actor with no full name is shown by username, as in the app", () => {
    const snapshot = baseSnapshot({
      tasks: [t],
      people: [
        ...baseSnapshot().people.filter((p) => p.userId !== ADMIN),
        person(ADMIN, null, "test@upcarrera.test", "active", "test"),
      ],
    });
    expect(sent(compose(row, snapshot)).html).toContain("test has assigned you a task");
  });

  test("an actor with no full name or username is 'A teammate', not their email", () => {
    const snapshot = baseSnapshot({
      tasks: [t],
      people: [
        ...baseSnapshot().people.filter((p) => p.userId !== ADMIN),
        person(ADMIN, null, "test@upcarrera.test"),
      ],
    });
    expect(sent(compose(row, snapshot)).html).toContain("A teammate has assigned you a task");
  });

  test("suppressed when the task is gone, closed or reassigned", () => {
    expect(reason(compose(row, baseSnapshot()))).toBe("task no longer exists or is archived");
    expect(reason(compose(row, baseSnapshot({ tasks: [{ ...t, status: "done" }] })))).toBe(
      "task is done",
    );
    expect(reason(compose(row, baseSnapshot({ tasks: [{ ...t, status: "cancelled" }] })))).toBe(
      "task is cancelled",
    );
    expect(reason(compose(row, baseSnapshot({ tasks: [{ ...t, assigneeId: DAN }] })))).toBe(
      "task was reassigned",
    );
  });

  test("suppressed by the recipient's preference or the organization's switches", () => {
    const prefs = baseSnapshot({
      tasks: [t],
      preferences: [{ userId: MAYA, ...allKinds(), task_assigned: false }],
    });
    expect(reason(compose(row, prefs))).toBe("recipient turned off task_assigned");
    const toggled = baseSnapshot({
      tasks: [t],
      organizations: [org(DUBAI, "upCarrera", "Asia/Dubai", { task_assigned: false })],
    });
    expect(reason(compose(row, toggled))).toBe("task_assigned is switched off for upCarrera");
    const off = baseSnapshot({
      tasks: [t],
      organizations: [org(DUBAI, "upCarrera", "Asia/Dubai", { enabled: false })],
    });
    expect(reason(compose(row, off))).toBe("task_assigned is switched off for upCarrera");
  });
});

describe("due_reminder and overdue_alert", () => {
  const upcoming = task({ title: "Q3 OKR planning doc", dueDate: "2026-09-28" });
  const reminder = claimed({
    kind: "due_reminder",
    taskId: upcoming.id,
    payload: { due: "2026-09-28" },
  });

  test("a reminder renders the due date", () => {
    const email = sent(compose(reminder, baseSnapshot({ tasks: [upcoming] })));
    expect(email.subject).toBe("Due soon: Q3 OKR planning doc");
    expect(email.html).toContain("Mon, 28 Sep 2026");
    expect(email.html).toContain(">Medium<");
  });

  test("suppressed when the due date moved or the task changed hands", () => {
    const moved = baseSnapshot({ tasks: [{ ...upcoming, dueDate: "2026-10-02" }] });
    expect(reason(compose(reminder, moved))).toBe("due date changed since the email was planned");
    const cleared = baseSnapshot({ tasks: [{ ...upcoming, dueDate: null }] });
    expect(reason(compose(reminder, cleared))).toBe("due date changed since the email was planned");
    const handed = baseSnapshot({ tasks: [{ ...upcoming, assigneeId: DAN }] });
    expect(reason(compose(reminder, handed))).toBe("task was reassigned");
  });

  test("an overdue alert says how long it has been overdue", () => {
    const late = task({ title: "Payment retry UX copy", dueDate: "2026-09-24" });
    const oneDay = claimed({
      kind: "overdue_alert",
      taskId: late.id,
      payload: { due: "2026-09-24" },
    });
    const email = sent(compose(oneDay, baseSnapshot({ tasks: [late] })));
    expect(email.subject).toBe("Overdue task: Payment retry UX copy");
    expect(email.html).toContain("Overdue · 1 day");
    const older = { ...late, dueDate: "2026-09-22" };
    const threeDays = { ...oneDay, payload: { due: "2026-09-22" } };
    expect(sent(compose(threeDays, baseSnapshot({ tasks: [older] }))).html).toContain(
      "Overdue · 3 days",
    );
  });

  test("overdue alerts respect their own switches", () => {
    const late = task({ dueDate: "2026-09-24" });
    const row = claimed({ kind: "overdue_alert", taskId: late.id, payload: { due: "2026-09-24" } });
    const prefs = baseSnapshot({
      tasks: [late],
      preferences: [{ userId: MAYA, ...allKinds(), overdue_alert: false }],
    });
    expect(reason(compose(row, prefs))).toBe("recipient turned off overdue_alert");
  });
});

describe("project_invitation", () => {
  const row = claimed({
    kind: "project_invitation",
    projectId: PROJECT,
    payload: { roleLabel: "Coordinator" },
  });

  test("renders the project, the inviter and the role", () => {
    const email = sent(compose(row, baseSnapshot()));
    expect(email.subject).toBe("You've been invited to October Admissions Drive on Flowdesk");
    expect(email.html).toContain(
      "Test Admin has invited you to collaborate on October Admissions Drive",
    );
    expect(email.html).toContain(">Coordinator<");
    expect(email.html).toContain(`href="${APP}/projects?project=${PROJECT}"`);
  });

  test("role falls back to the current membership label, then 'Team member'", () => {
    const base = baseSnapshot();
    expect(sent(compose({ ...row, payload: { roleLabel: null } }, base)).html).toContain(
      ">Coordinator<",
    );
    const unlabeled = {
      ...base,
      projectMembers: [{ projectId: PROJECT, userId: MAYA, roleLabel: null }],
    };
    expect(sent(compose({ ...row, payload: {} }, unlabeled)).html).toContain(">Team member<");
  });

  test("suppressed when the project is gone, archived or cancelled, or the person was removed", () => {
    expect(reason(compose(row, baseSnapshot({ projects: [] })))).toBe(
      "project no longer exists or is archived",
    );
    expect(
      reason(compose(row, baseSnapshot({ projects: [project({ status: "archived" })] }))),
    ).toBe("project no longer exists or is archived");
    expect(
      reason(compose(row, baseSnapshot({ projects: [project({ status: "cancelled" })] }))),
    ).toBe("project was cancelled");
    expect(reason(compose(row, baseSnapshot({ projectMembers: [] })))).toBe(
      "recipient is no longer a project member",
    );
  });

  test("suppressed by preference", () => {
    const snapshot = baseSnapshot({
      preferences: [{ userId: MAYA, ...allKinds(), project_invitation: false }],
    });
    expect(reason(compose(row, snapshot))).toBe("recipient turned off project_invitation");
  });
});

describe("digests and summaries", () => {
  test("a daily digest renders with the recipient's tasks and links", () => {
    const t = task({ title: "Upload fee reconciliation", dueDate: "2026-09-24" });
    const email = sent(compose(claimed({ kind: "daily_digest" }), baseSnapshot({ tasks: [t] })));
    expect(email.subject).toBe("Your Flowdesk daily task summary — Fri, 25 Sep 2026");
    expect(email.html).toContain("Upload fee reconciliation");
    expect(email.html).toContain(`href="${APP}/my-tasks?task=${t.id}"`);
    expect(email.html).toContain(`href="${APP}/my-tasks"`);
  });

  test("an empty digest is suppressed as nothing to report", () => {
    expect(reason(compose(claimed({ kind: "daily_digest" }), baseSnapshot()))).toBe(
      "nothing to report",
    );
    expect(reason(compose(claimed({ kind: "weekly_digest" }), baseSnapshot()))).toBe(
      "nothing to report",
    );
  });

  test("a digest switched off in every organization says so", () => {
    const snapshot = baseSnapshot({
      tasks: [task({ dueDate: "2026-09-24" })],
      organizations: [
        org(DUBAI, "upCarrera", "Asia/Dubai", { daily_digest: false }),
        org(KOLKATA, "TTI", "Asia/Kolkata"),
      ],
    });
    expect(reason(compose(claimed({ kind: "daily_digest" }), snapshot))).toBe(
      "daily_digest is switched off for every organization of the recipient",
    );
  });

  test("preferences suppress digests too", () => {
    const snapshot = baseSnapshot({
      tasks: [task({ dueDate: "2026-09-24" })],
      preferences: [{ userId: MAYA, ...allKinds(), daily_digest: false }],
    });
    expect(reason(compose(claimed({ kind: "daily_digest" }), snapshot))).toBe(
      "recipient turned off daily_digest",
    );
  });

  test("a management summary for someone who manages nothing is suppressed", () => {
    const snapshot = baseSnapshot({ tasks: [task({ dueDate: "2026-09-24" })] });
    expect(reason(compose(claimed({ kind: "daily_management" }), snapshot))).toBe(
      "daily_management: recipient manages no organization with it switched on",
    );
  });

  test("a management summary links tasks to the team view", () => {
    const t = task({
      title: "Renew SOC 2 controls review",
      dueDate: "2026-09-24",
      priority: "critical",
    });
    const row = claimed({ kind: "daily_management", recipientUserId: ADMIN });
    const email = sent(compose(row, baseSnapshot({ tasks: [t] })));
    expect(email.subject).toBe("Flowdesk daily management summary — Fri, 25 Sep 2026");
    expect(email.html).toContain(`href="${APP}/team?task=${t.id}"`);
    expect(email.html).toContain(`href="${APP}/"`);
    expect(email.html).toContain("Maya Chen");
  });

  test("the weekly summary covers the previous seven days", () => {
    const done = task({
      status: "done",
      completedAt: "2026-09-23T09:00:00Z",
      title: "Launch assets approved",
    });
    const row = claimed({ kind: "weekly_management", recipientUserId: ADMIN });
    const email = sent(compose(row, baseSnapshot({ tasks: [done] })));
    expect(email.subject).toBe(
      "Flowdesk weekly management summary — Fri, 18 Sep – Thu, 24 Sep 2026",
    );
    expect(email.html).toContain("Launch assets approved");
  });

  test("the lead's summary never contains Dubai tasks, where they are only an employee", () => {
    const snapshot = baseSnapshot({
      tasks: [
        task({
          organizationId: KOLKATA,
          assigneeId: null,
          dueDate: "2026-09-24",
          title: "TTI unassigned work",
        }),
        task({
          organizationId: DUBAI,
          assigneeId: DAN,
          dueDate: "2026-09-24",
          title: "Dubai private work",
        }),
      ],
    });
    const email = sent(
      compose(claimed({ kind: "daily_management", recipientUserId: LEAD }), snapshot),
    );
    expect(email.html).toContain("TTI unassigned work");
    expect(email.html).not.toContain("Dubai private work");
    expect(email.html).not.toContain(">upCarrera<");
  });
});

describe("a scheduled row belongs to its planned day", () => {
  // Planned Fri 25 Sep in Dubai; 00:03 Saturday in Dubai is 2026-09-25T20:03Z.
  const SAT_0003_DUBAI = new Date("2026-09-25T20:03:00Z");
  const FRI_2358_DUBAI = new Date("2026-09-25T19:58:00Z");
  const planned = { localDate: "2026-09-25", timezone: "Asia/Dubai" };
  const due = task({ title: "Friday deadline", dueDate: "2026-09-25" });
  const overdue = task({ title: "Thursday deadline", dueDate: "2026-09-24" });
  const snapshot = baseSnapshot({ tasks: [due, overdue] });
  const at = (row: ClaimedEmail, now: Date) => composeEmail(row, snapshot, { appUrl: APP, now });

  test("until local midnight it is sent with that day's content", () => {
    const email = sent(at(claimed({ kind: "daily_digest", payload: planned }), FRI_2358_DUBAI));
    expect(email.subject).toBe("Your Flowdesk daily task summary — Fri, 25 Sep 2026");
  });

  test("after local midnight it is suppressed rather than sent with the next day's tasks", () => {
    const expected = "planned for 2026-09-25, but it is now 2026-09-26 in Asia/Dubai";
    for (const kind of ["daily_digest", "weekly_digest", "daily_management"] as const) {
      const row = claimed({ kind, recipientUserId: ADMIN, payload: planned });
      expect(reason(at(row, SAT_0003_DUBAI))).toBe(expected);
    }
    const alert = claimed({
      kind: "overdue_alert",
      taskId: overdue.id,
      payload: { ...planned, due: "2026-09-24" },
    });
    expect(sent(at(alert, FRI_2358_DUBAI)).html).toContain("1 day");
    expect(reason(at(alert, SAT_0003_DUBAI))).toBe(expected);
  });

  test("without a timezone in the payload, the row's organization decides", () => {
    const row = claimed({ kind: "daily_digest", payload: { localDate: "2026-09-25" } });
    expect(reason(at(row, SAT_0003_DUBAI))).toContain("now 2026-09-26 in Asia/Dubai");
  });

  test("event emails are not tied to a day", () => {
    const row = claimed({ kind: "task_assigned", taskId: due.id, payload: planned });
    expect(at(row, SAT_0003_DUBAI).outcome).toBe("send");
  });
});

describe("management summaries show what the app shows", () => {
  const PRIYA = "50000000-0000-4000-8000-000000000005";

  test("the review status carries the organization's label", () => {
    const snapshot = baseSnapshot({
      tasks: [task({ title: "Brochure copy", status: "review", dueDate: "2026-09-30" })],
      statusLabels: [{ organizationId: DUBAI, value: "review", label: "Waiting Approval" }],
    });
    const row = claimed({ kind: "weekly_management", recipientUserId: ADMIN });
    expect(sent(compose(row, snapshot)).html).toContain("Waiting Approval");
    const daily = sent(
      compose(claimed({ kind: "daily_management", recipientUserId: ADMIN }), snapshot),
    );
    expect(daily.html).toContain('color:#1452ad;">Waiting Approval</span>');
    expect(daily.html).not.toContain(">Review</span>");
    expect(daily.html).not.toContain("Awaiting review");
  });

  test("an assignee from an organization the recipient is not in is not named", () => {
    const base = baseSnapshot();
    const snapshot = baseSnapshot({
      people: [...base.people, person(PRIYA, "Priya TTII-Only Sharma", "priya@tti.test")],
      memberships: [...base.memberships, membership(PRIYA, KOLKATA)],
      tasks: [task({ title: "Cross-org work", assigneeId: PRIYA, dueDate: "2026-09-24" })],
    });
    for (const kind of ["daily_management", "weekly_management"] as const) {
      const html = sent(compose(claimed({ kind, recipientUserId: ADMIN }), snapshot)).html;
      expect(html).toContain("Cross-org work");
      expect(html).toContain("A teammate");
      expect(html).not.toContain("Priya");
    }
  });
});

describe("escaping", () => {
  test("hostile task titles and names are escaped, never injected", () => {
    const t = task({ title: `<img src=x onerror=alert(1)>`, dueDate: "2026-09-28" });
    const snapshot = baseSnapshot({
      tasks: [t],
      people: [
        person(MAYA, `<script>x</script>`, "maya@x.test"),
        person(ADMIN, `"><b>`, "a@x.test"),
      ],
    });
    const email = sent(compose(claimed({ kind: "task_assigned", taskId: t.id }), snapshot));
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).not.toContain("<script>x");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(email.subject).toBe("Task assigned to you: <img src=x onerror=alert(1)>");
  });
});
