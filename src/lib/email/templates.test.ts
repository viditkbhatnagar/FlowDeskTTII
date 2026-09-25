// @ts-expect-error -- bun-types is not installed; `bun test` provides this module at runtime.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as render from "./render";
import type { RenderContext, RenderedEmail } from "./render";
import { buildSupabaseResetPasswordHtml } from "./templates/password-reset-otp";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ctx: RenderContext = { assetBaseUrl: "https://flowdesk.upcarrera.com" };
const APP = "https://flowdesk.upcarrera.com";
const EVIL = `<script>alert("x")</script>'&`;
const EVIL_URL = "javascript:alert(document.cookie)";

type Sample = Record<string, unknown>;
type Case = { name: string; sample: Sample; render: (v: never, c: RenderContext) => RenderedEmail };

const task = (title: string, extra: Sample = {}) => ({
  title,
  url: `${APP}/my-tasks?task=${title.length}`,
  dateLabel: "Due Fri, 25 Sep 2026",
  ...extra,
});

const CASES: Case[] = [
  {
    name: "account_access",
    render: render.renderAccountAccess,
    sample: {
      firstName: "Maya",
      emailAddress: "maya@upcarrera.com",
      setPasswordUrl: `${APP}/auth?mode=reset&email=maya%40upcarrera.com`,
      signInUrl: `${APP}/auth`,
    },
  },
  {
    name: "project_invitation",
    render: render.renderProjectInvitation,
    sample: {
      firstName: "Dan",
      inviterName: "Maya Sharma",
      organizationName: "upCarrera",
      projectName: "October Admissions Drive",
      projectRole: "Counsellor",
      projectUrl: `${APP}/projects?project=p1`,
    },
  },
  {
    name: "task_assigned",
    render: render.renderTaskAssigned,
    sample: {
      firstName: "Dan",
      assignedBy: "Maya Sharma",
      taskTitle: "Call back webinar leads",
      organizationName: "upCarrera",
      projectName: "October Admissions Drive",
      priority: "High",
      dueDate: "Thu, 1 Oct 2026",
      taskUrl: `${APP}/my-tasks?task=t1`,
    },
  },
  {
    name: "due_reminder",
    render: render.renderDueReminder,
    sample: {
      firstName: "Dan",
      taskTitle: "Send offer letters",
      organizationName: "upCarrera",
      projectName: "",
      priority: "Critical",
      dueDate: "Mon, 28 Sep 2026",
      taskUrl: `${APP}/my-tasks?task=t2`,
    },
  },
  {
    name: "overdue_alert",
    render: render.renderOverdueAlert,
    sample: {
      firstName: "Dan",
      taskTitle: "Upload fee reconciliation",
      organizationName: "upCarrera",
      projectName: "Finance Ops",
      priority: "Medium",
      dueDate: "Thu, 24 Sep 2026",
      overdueDuration: "1 day",
      taskUrl: `${APP}/my-tasks?task=t3`,
    },
  },
  {
    name: "daily_digest",
    render: render.renderDailyDigest,
    sample: {
      firstName: "Dan",
      date: "Fri, 25 Sep 2026",
      overdueCount: "1",
      dueTodayCount: "1",
      upcomingCount: "0",
      completedCount: "0",
      myTasksUrl: `${APP}/my-tasks`,
      organizations: [
        {
          name: "upCarrera",
          groups: [
            { label: "Overdue", tasks: [task("Chase transcripts", { projectName: "Ops" })] },
            { label: "Due Today", tasks: [task("Open-day slides")], viewAllUrl: `${APP}/my-tasks` },
          ],
        },
      ],
    },
  },
  {
    name: "weekly_digest",
    render: render.renderWeeklyDigest,
    sample: {
      firstName: "Maya",
      dateRange: "Fri, 18 Sep – Thu, 24 Sep 2026",
      completedCount: "1",
      openCount: "2",
      overdueCount: "0",
      nextWeekCount: "1",
      myTasksUrl: `${APP}/my-tasks`,
      organizations: [
        {
          name: "upCarrera",
          groups: [
            { label: "Completed", tasks: [task("Counsellor rota", { projectName: "Ops" })] },
          ],
        },
      ],
    },
  },
  {
    name: "daily_management",
    render: render.renderDailyManagement,
    sample: {
      firstName: "Maya",
      date: "Fri, 25 Sep 2026",
      completedCount: "1",
      dueTodayCount: "1",
      overdueCount: "1",
      blockedCount: "0",
      reviewCount: "0",
      unassignedCount: "1",
      dashboardUrl: `${APP}/`,
      organizations: [
        {
          name: "upCarrera",
          summary: "4 open tasks · 1 needs attention · 1 completed",
          groups: [
            {
              label: "Needs Attention",
              tasks: [
                task("Fee reconciliation", {
                  url: `${APP}/team?task=t4`,
                  assignee: "Dan Okafor",
                  projectName: "Finance Ops",
                  badges: ["Critical", "Overdue"],
                }),
              ],
            },
          ],
        },
      ],
    },
  },
  {
    name: "weekly_management",
    render: render.renderWeeklyManagement,
    sample: {
      firstName: "Maya",
      dateRange: "Fri, 18 Sep – Thu, 24 Sep 2026",
      completedCount: "3",
      overdueCount: "1",
      blockedCount: "0",
      reviewCount: "1",
      attentionProjectCount: "1",
      nextWeekCount: "2",
      dashboardUrl: `${APP}/`,
      organizations: [
        {
          name: "upCarrera",
          summary: "4 open tasks · 1 project needs attention · 3 completed",
          sections: [
            {
              label: "Project Health",
              items: [
                {
                  title: "Admissions Drive",
                  url: `${APP}/projects?project=p1`,
                  meta: "42% complete",
                  badge: "At risk",
                },
              ],
            },
            { label: "Team Workload", items: [{ title: "Dan Okafor", meta: "7 open tasks" }] },
          ],
        },
      ],
    },
  },
];

const isUrlKey = (key: string) => /url$/i.test(key);

/** Replace every string leaf: URL fields with `url`, everything else with `text`. */
function poison(value: unknown, text: string, url: string, key = ""): unknown {
  if (typeof value === "string") return isUrlKey(key) ? url : text;
  if (Array.isArray(value)) return value.map((item) => poison(item, text, url, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, poison(v, text, url, k)]));
  }
  return value;
}

const run = (c: Case, sample: Sample = c.sample) => c.render(sample as never, ctx);
const byName = (name: string) => CASES.find((c) => c.name === name)!;

/** One test per email kind; `%s` in the title is the kind. */
const eachKind = (title: string, fn: (c: Case) => void) =>
  test.each(CASES.map((c) => [c.name, c]))(title, (_: string, c: Case) => fn(c));
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe("every email kind", () => {
  eachKind("%s escapes every string field", (c) => {
    const { html } = run(c, poison(c.sample, EVIL, EVIL) as Sample);
    expect(html).not.toContain("<script");
    expect(html).not.toContain('alert("x")');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#039;&amp;");
  });

  eachKind("%s neutralises javascript: links", (c) => {
    const { html } = run(c, poison(c.sample, "Plain text", EVIL_URL) as Sample);
    expect(html).not.toContain("javascript:");
    const links = hrefs(html);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) expect(href).toBe("#");
  });

  eachKind("%s keeps only http(s) links", (c) => {
    const { html } = run(c);
    for (const href of hrefs(html)) expect(href).toMatch(/^https:\/\/flowdesk\.upcarrera\.com\//);
  });

  eachKind("%s has no CSS filter", (c) => {
    expect(run(c).html).not.toContain("filter:");
    expect(run(c, poison(c.sample, EVIL, EVIL) as Sample).html).not.toContain("filter:");
  });

  eachKind("%s uses the pre-rendered header", (c) => {
    const { html } = run(c);
    expect(html).toContain(
      '<img src="https://flowdesk.upcarrera.com/brand/flowdesk-email-header.png" width="180" height="60"',
    );
    expect(html.match(/<img /g)?.length).toBe(1);
  });

  // A long unbroken token (a pasted URL in a title) otherwise widens the whole table on a phone.
  eachKind("%s wraps unbroken words inside the content cell", (c) => {
    expect(run(c).html).toContain(
      '<td class="email-pad" style="padding:44px 44px 40px;word-break:break-word;overflow-wrap:anywhere;">',
    );
  });

  eachKind("%s keeps stacked mobile panel cells inside the panel", (c) => {
    const { html } = run(c);
    for (const rule of html.match(/[.\w-]+ td \{ display: block[^}]*\}/g) ?? []) {
      expect(rule).toContain("box-sizing: border-box !important;");
    }
  });
});

describe("links", () => {
  const assigned = byName("task_assigned");

  test("attribute-breaking characters inside an https URL are escaped", () => {
    const { html } = run(assigned, {
      ...assigned.sample,
      taskUrl: 'https://flowdesk.upcarrera.com/my-tasks?task="><script>x</script>',
    });
    expect(html).toContain(
      'href="https://flowdesk.upcarrera.com/my-tasks?task=&quot;&gt;&lt;script&gt;x&lt;/script&gt;"',
    );
  });

  test.each([
    "data:text/html,<b>x</b>",
    " JavaScript:alert(1)",
    "java\nscript:alert(1)",
    "vbscript:msgbox(1)",
    "/relative/path",
    "mailto:a@b.c",
    "",
  ])("rejects %j", (url: string) => {
    const { html } = run(assigned, { ...assigned.sample, taskUrl: url });
    expect(hrefs(html)).toEqual(["#"]);
  });

  test("a trailing slash on assetBaseUrl does not double the slash", () => {
    const { html } = render.renderTaskAssigned(assigned.sample as never, {
      assetBaseUrl: "https://flowdesk.upcarrera.com/",
    });
    expect(html).toContain('src="https://flowdesk.upcarrera.com/brand/flowdesk-email-header.png"');
  });
});

describe("subjects", () => {
  const expected: Record<string, string> = {
    account_access: "Your Flowdesk account is ready",
    project_invitation: "You've been invited to October Admissions Drive on Flowdesk",
    task_assigned: "Task assigned to you: Call back webinar leads",
    due_reminder: "Due soon: Send offer letters",
    overdue_alert: "Overdue task: Upload fee reconciliation",
    daily_digest: "Your Flowdesk daily task summary — Fri, 25 Sep 2026",
    weekly_digest: "Your Flowdesk weekly summary — Fri, 18 Sep – Thu, 24 Sep 2026",
    daily_management: "Flowdesk daily management summary — Fri, 25 Sep 2026",
    weekly_management: "Flowdesk weekly management summary — Fri, 18 Sep – Thu, 24 Sep 2026",
  };

  eachKind("%s subject matches its title", (c) => {
    const { subject, html } = run(c);
    expect(subject).toBe(expected[c.name]);
    const title = html.match(/<title>(.*)<\/title>/)?.[1];
    expect(title).toBe(subject.replaceAll("'", "&#039;"));
  });

  test("subjects are plain text on one line", () => {
    const assigned = byName("task_assigned");
    const { subject } = run(assigned, { ...assigned.sample, taskTitle: "Fix <b>&\r\nBcc: x@y.z" });
    expect(subject).toBe("Task assigned to you: Fix <b>& Bcc: x@y.z");
  });
});

describe("account_access", () => {
  const c = byName("account_access");
  const { html } = run(c);

  test("never carries a password", () => {
    expect(html.toLowerCase()).not.toContain("password:");
    expect(html).not.toContain("Temporary password");
    expect(html).not.toMatch(/generated|credentials/i);
  });

  test("links the set-password flow and sign-in page", () => {
    expect(html).toContain(
      'href="https://flowdesk.upcarrera.com/auth?mode=reset&amp;email=maya%40upcarrera.com"',
    );
    expect(html).toContain(">Set your password</a>");
    expect(html).toContain('href="https://flowdesk.upcarrera.com/auth"');
    expect(html).toContain("maya@upcarrera.com");
    expect(html).toContain("Flowdesk will never ask for your password by email.");
  });
});

describe("transactional details", () => {
  test("the Project row is omitted when there is no project", () => {
    const c = byName("due_reminder");
    expect(run(c).html).not.toContain(">Project</td>");
    expect(run(c, { ...c.sample, projectName: "Ops" }).html).toContain(">Project</td>");
  });

  test("task_assigned shows Not set for a blank due date", () => {
    const c = byName("task_assigned");
    expect(run(c, { ...c.sample, dueDate: "  " }).html).toContain(">Not set</td>");
  });
});

describe("digest and summary sections", () => {
  const daily = byName("daily_digest");
  const many = (n: number) => Array.from({ length: n }, (_, i) => task(`Task number ${i + 1}`));
  const withGroups = (groups: unknown[]) => ({
    ...daily.sample,
    organizations: [{ name: "upCarrera", groups }],
  });

  test("shows five rows per group and a View all link only past five", () => {
    const six = run(
      daily,
      withGroups([{ label: "Upcoming", tasks: many(6), viewAllUrl: `${APP}/my-tasks` }]),
    ).html;
    expect(six).toContain("Task number 5");
    expect(six).not.toContain("Task number 6");
    expect(six).toContain(">View all upcoming</a>");

    const five = run(
      daily,
      withGroups([{ label: "Upcoming", tasks: many(5), viewAllUrl: `${APP}/my-tasks` }]),
    ).html;
    expect(five).not.toContain("View all");
  });

  test("skips empty groups", () => {
    const html = run(
      daily,
      withGroups([
        { label: "Overdue", tasks: [] },
        { label: "Upcoming", tasks: many(1) },
      ]),
    ).html;
    expect(html).not.toContain(">Overdue</p>");
    expect(html).toContain(">Upcoming</p>");
  });

  test("management rows fall back to Unassigned and ignore unknown badges", () => {
    const c = byName("daily_management");
    const html = run(c, {
      ...c.sample,
      organizations: [
        {
          name: "upCarrera",
          summary: "",
          groups: [
            {
              label: "Needs Attention",
              tasks: [task("Book venue", { badges: ["Unassigned", "Bogus"] })],
            },
          ],
        },
      ],
    }).html;
    expect(html).toContain("Unassigned · Due Fri, 25 Sep 2026");
    expect(html).toContain('text-transform:uppercase;">Bogus</span>');
    expect(html).not.toContain("undefined");
  });

  test("a labelled badge reads its label in its tone's colour, and the review tile is renamed", () => {
    const c = byName("daily_management");
    const html = run(c, {
      ...c.sample,
      reviewLabel: "Waiting <Approval>",
      organizations: [
        {
          name: "upCarrera",
          summary: "",
          groups: [
            {
              label: "Needs Attention",
              tasks: [
                task("Brochure", { badges: [{ tone: "Review", label: "Waiting Approval" }] }),
              ],
            },
          ],
        },
      ],
    }).html;
    expect(html).toContain('background:#eaf1ff;color:#1452ad;">Waiting Approval</span>');
    expect(html).toContain(">Waiting &lt;Approval&gt;</span>");
    expect(html).not.toContain("Awaiting review");
  });

  test("without a review label the tiles still read Awaiting review", () => {
    for (const name of ["daily_management", "weekly_management"]) {
      expect(run(byName(name)).html).toContain(">Awaiting review</span>");
    }
  });

  test("a weekly badge is coloured by its tone, not its text", () => {
    const c = byName("weekly_management");
    const item = { title: "Brochure", url: `${APP}/team?task=t9`, meta: "Due soon" };
    const html = run(c, {
      ...c.sample,
      reviewLabel: "Waiting Approval",
      organizations: [
        {
          name: "upCarrera",
          summary: "",
          sections: [
            {
              label: "Needs Attention",
              items: [{ ...item, badge: "Completed", badgeTone: "Review" }],
            },
          ],
        },
      ],
    }).html;
    expect(html).toContain('background:#eaf1ff;color:#1452ad;">Completed</span>');
    expect(html).toContain(">Waiting Approval</span>");
  });

  test("weekly management items without a url render as plain text", () => {
    const c = byName("weekly_management");
    expect(run(c).html).toContain(
      '<span style="font-size:14px;font-weight:700;line-height:21px;color:#101b36;">Dan Okafor</span>',
    );
  });
});

describe("Supabase reset-password template", () => {
  const file = readFileSync(join(ROOT, "deploy/email/supabase-reset-password.html"), "utf8");

  test("the committed file matches the template source", () => {
    expect(file).toBe(`${buildSupabaseResetPasswordHtml()}\n`);
  });

  test("uses Supabase placeholders and the absolute logo URL", () => {
    expect(file).toContain(">{{ .Token }}</span>");
    expect(file).toContain("{{ .Email }}");
    expect(file).toContain("This code expires in 1 hour.");
    expect(file).toContain(
      'src="https://flowdesk.upcarrera.com/brand/flowdesk-email-header.png" width="180" height="60"',
    );
    expect(file).not.toContain("filter:");
    expect(file.match(/\{\{[^}]*\}\}/g)).toEqual(["{{ .Email }}", "{{ .Token }}"]);
  });
});

describe("brand assets", () => {
  const pngSize = (rel: string) => {
    const buf = readFileSync(join(ROOT, "public", rel));
    expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
  };

  test.each([
    ["favicon.png", 64, 64],
    ["apple-touch-icon.png", 180, 180],
    ["brand/flowdesk-symbol.png", 128, 128],
    ["brand/flowdesk-email-header.png", 360, 120],
  ])("%s is %dx%d and small", (rel: string, width: number, height: number) => {
    const size = pngSize(rel);
    expect([size.width, size.height]).toEqual([width, height]);
    expect(size.bytes).toBeLessThan(40 * 1024);
  });

  test("brand/flowdesk-horizontal.png is 440 wide and small", () => {
    const size = pngSize("brand/flowdesk-horizontal.png");
    expect(size.width).toBe(440);
    expect(size.bytes).toBeLessThan(40 * 1024);
  });
});
