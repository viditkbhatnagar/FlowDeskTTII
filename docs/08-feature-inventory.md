# 08 — Feature Inventory

_Phase B. Written 22 September 2026, against the Lovable export in `flowdeskupc.zip`,
running as a **production `node-server` build** (not the dev server) on `127.0.0.1:3100`,
signed in as the real Supabase account `test@gmail.com`._

> **Read the "Headline" first.** It is the one thing that changes what you do next.

---

## Headline

FlowDesk looks finished and is not. The interface is genuinely good — polished, coherent,
responsive, and it renders real data from Supabase on the screens that matter most. But
**only tasks are actually saved.**

| Area | Saved to the database? |
|---|---|
| **Tasks** — create, edit, status, progress, blocked, recurrence | ✅ **Yes** |
| **Dashboard** — every card, panel and chart | ✅ Yes (reads live data) |
| **Projects** — create, edit, archive, delete, milestones, documents | ❌ **No** |
| **Users** — add, edit, deactivate, assign role | ❌ **No** |
| **Teams & Departments** | ❌ **No** |
| **Roles & Permissions** | ❌ **No** |
| **Task & Project Settings** — statuses, priorities, categories, tags | ❌ **No** |
| **Organizations** — the list is read live; edits are not saved | ⚠️ Read-only |

The proof is one line of evidence: across all 15,776 lines of source, the **only** writes
to Supabase are three calls in `src/lib/workspace-data.tsx` — an insert into
`task_recurrences`, an insert into `work_tasks`, and an update of `work_tasks`. There is
no insert or update anywhere for `work_projects`, `organizations`, `profiles`,
`user_roles`, `project_milestones` or `work_activity`, and there are **no tables at all**
for departments, teams or roles.

Everything in the "No" rows is React state. It looks like it worked — a toast appears, the
row shows up in the table — and it is gone on refresh.

**What this means practically:** FlowDesk today is a working *task tracker* wrapped in a
convincing but non-functional *admin console*. That is a perfectly reasonable thing to
launch, provided nobody is told the admin screens work. It is not a reason to delay — it
is a reason to be precise about what staff are given on day one.

---

## How this was verified

Not by reading the code alone. Every claim below rests on at least one of:

1. **A real browser against the real production build.** Playwright drove Chromium
   against `node .output/server/index.mjs`, signed in with real credentials, and walked
   all nine screens at 1440, 768 and 375 px. 30 screenshots are in
   [`docs/screenshots/`](screenshots/).
2. **Direct queries against the live Supabase project**, signed in as a real user and
   again anonymously, to establish what data exists and what row-level security allows.
3. **Write journeys executed for real** — a project created through the UI, a task created
   through the UI, a task moved across the board — each followed by a direct database
   read to see whether anything landed.
4. **A nine-way parallel source audit**, with every defect claim then handed to an
   independent agent instructed to *refute* it. That pass rejected 30 of the 59 claims it
   reached — including one that would have been wrong in this document. Claims that were
   not reached by the refutation pass are marked **(unverified)** and should be treated as
   leads, not findings.

### The three write journeys, in full

| Journey | UI said | Database said |
|---|---|---|
| Create project "Verify Run L1" (all 8 required fields) | Created; navigated into the new project workspace | **Nothing.** `work_projects` still held its original 5 rows |
| Create task "Verify Task L1" | Created | **`HTTP 201`** — row present, survives reload ✅ |
| Move "Q3 OKR planning doc" To Do → In Progress | Moved | **`HTTP 204`** — `status: "progress"`, still there after reload ✅ |

---

## Screen by screen

Nine screens, all under a single route (`/_authenticated/`), switched by a React `nav`
string in [`src/routes/_authenticated/index.tsx:54`](../src/routes/_authenticated/index.tsx#L54)
— there are only five route files in the whole app.

Legend: ✅ works · ⚠️ partly works · ❌ broken or cosmetic

| # | Screen | State | Data | Notes |
|---|---|---|---|---|
| 1 | **Sign in** (`/auth`) | ✅ | Live | Real Supabase password auth. Password reset sends a recovery OTP — **blocked on email delivery** (the one open roadmap item). |
| 2 | **Dashboard** | ⚠️ | Live | The best screen in the app. Six stat cards, Needs Attention, Upcoming Deadlines, Project Health, Team Workload, Completion Trend, Recent Activity — all from a real server function with real role checks. Caveats below. |
| 3 | **My Tasks** | ⚠️ | Live tasks | Kanban / List / Priority. Real tasks, real status writes. **But it is not filtered to you** — see D1. |
| 4 | **Team Tasks** | ⚠️ | Live tasks + invented metadata | Real task rows, but department, "Backlog vs Assigned", workload and productivity are fabricated. |
| 5 | **Projects** | ❌ | **Mock** | Renders 5 hardcoded projects from `mock-data.ts`, not the 5 real rows in `work_projects`. Creating, editing, archiving and deleting all persist nothing. |
| 6 | **Organizations** | ⚠️ | Live read | The list is read from Supabase correctly. "Add Organization" cannot work — the RLS policy is `INSERT WITH CHECK (false)` by design. |
| 7 | **Users** | ❌ | **Mock** | Shows 8 invented employees (Alex Morgan, Priya Shah…) with invented emails, phone numbers and employee IDs. The database holds 3 real profiles, which this screen never reads. |
| 8 | **Teams & Departments** | ❌ | **Mock** | No `departments` or `teams` table exists. Every edit is lost on refresh. |
| 9 | **Roles & Permissions** | ❌ | **Mock** | No `roles` table exists. The permission matrix is a picture of a permission system. Real roles live in `user_roles` and are read-only here. |
| 10 | **Task & Project Settings** | ❌ | **Mock** | `src/lib/task-settings-data.tsx` contains zero Supabase calls. Statuses, priorities, categories and tags are local state. |

Screenshots: [dashboard](screenshots/02-dashboard.png) ·
[my tasks](screenshots/03-my-tasks.png) · [team tasks](screenshots/04-team-tasks.png) ·
[projects](screenshots/05-projects.png) · [users](screenshots/07-users.png) ·
[roles](screenshots/09-roles.png) — each also at `-768.png` and `-375.png`.

### Screens that exist in the code but are not reachable

`StatsCards.tsx`, `SidePanels.tsx`, `TaskListView.tsx`, `KanbanBoard.tsx` and
`CalendarView.tsx` are never rendered — the workspace uses its own inline implementations.
`TaskListView.tsx` and `SidePanels.tsx` read directly from `mock-data.ts`. This is dead
code, not a live defect, but it is a trap for the next person: **the file named
`KanbanBoard.tsx` is not the Kanban board you see.**

---

## The task model — what actually persists

`work_tasks`, from `supabase/migrations/20260920095458_*.sql`:

| Column | Type | Written by the app? |
|---|---|---|
| `id` | uuid PK | auto |
| `organization_id` | uuid NOT NULL → organizations | ✅ from first active membership |
| `project_id` | uuid → work_projects (SET NULL) | ✅ resolved from project *name* |
| `title` | text NOT NULL | ✅ required |
| `description` | text | ✅ |
| `status` | enum `todo·progress·review·done·cancelled` | ✅ |
| `priority` | enum `low·medium·high·critical` | ✅ |
| `assignee_id` | uuid, **no FK** | ⚠️ always written as the creator |
| `reviewer_id` | uuid, **no FK** | ✅ when status = review |
| `created_by` | uuid NOT NULL, **no FK** | ✅ |
| `due_at` / `due_date` | timestamptz / date | ✅ `due_date` only |
| `blocked` / `blocked_reason` | bool / text | ✅ |
| `progress` | smallint `CHECK 0..100` | ✅ |
| `estimated_hours` | numeric(8,2) | ✅ |
| `tags` | text[] | ✅ |
| `completed_at` | timestamptz | set by a database trigger, not the client |
| `archived_at` | timestamptz | never written |

**Collected in the New Task form but never saved:** subtasks, dependencies and
attachments. All three render a full editing UI. None reaches the database.

**Four statuses in the UI, five in the database.** The board columns are To Do → In
Progress → Waiting Approval (`review`) → Completed (`done`). `cancelled` exists in the
enum and is filtered out on load, but nothing in the UI can set it.

---

## The permission model

This is the part most worth understanding, because the UI and the database disagree.

**In the database — real and load-bearing.** Two `SECURITY DEFINER` predicates carry the
whole model:

- `private.has_organization_access(user, org)` — is there an active membership?
- `private.has_management_access(user, org)` — is the role `admin`, `manager` or `team_lead`?

Every table has RLS enabled. `work_tasks` SELECT is limited to creator, assignee, reviewer
or management; `organizations` INSERT is `WITH CHECK (false)`. **I verified this holds**:
signed out, every table returns an empty array rather than data.

**In the interface — almost nothing.** There is exactly one permission flag in the entire
front end, `canManageUsers = roles.includes("admin")`
([`organizations-data.tsx:724`](../src/lib/organizations-data.tsx#L724)). It hides the
Settings nav group. `ProjectWorkspace.tsx:133` hardcodes
`{ createTasks: true, assignTasks: true, … }` for everyone.

The five-role matrix on the Roles screen (`admin · manager · team_lead · employee ·
viewer`) is **not connected to anything**. It describes a model that is not enforced.

**Why this is acceptable for launch anyway:** the real boundary is RLS, and RLS is sound.
A user who bypasses the UI still cannot read another organization's tasks. The risk is not
a data breach — it is staff believing they have configured permissions when they have not.

---

## Defects

### Verified — worth acting on

**D1 · "My Tasks" shows everyone's tasks.** `MyTasksPage.tsx:90` carries the comment
`// Treat all tasks as "mine" for the demo` and applies no ownership filter. My Tasks and
Team Tasks show the same 18 tasks. *This is the single most user-visible bug in the app.*

**D2 · Every task appears to be assigned to whoever is looking.**
`workspace-data.tsx:108` hardcodes `assignee: currentPerson`, discarding the real
`assignee_id` it just loaded. Every card on every board reads "Owned by <you>". Assignment
is therefore invisible, which matters because the Dashboard *is* correctly assignee-scoped
— so the Dashboard and the boards will disagree, and the Dashboard is right.

**D3 · Raw UUIDs are shown to users.** `MyTasksPage.tsx:643` and `:779` render
`{task.id} · {task.project}` — every card is headed by a 36-character UUID. Visible in
[the screenshot](screenshots/03-my-tasks.png). Cosmetic, trivial to fix, and the first
thing anyone will notice.

**D4 · Projects count says 5, grid shows 4.** The header reads "TOTAL 5" while four cards
render. Both numbers come from mock data, which is the underlying problem.

**D5 · The list and priority views can crash on an empty task list.**
`MyTasksPage.tsx:140` does `items.find(...) ?? items[0]`, which is `undefined` when there
are no tasks, and the panel renders it unguarded. A brand-new organization with zero tasks
hits this.

**D6 · Mock tasks appear if the task query fails.** The provider is seeded with 12
fabricated tasks (`workspace-data.tsx:78`) and the loader swallows every error
(`if (!active || error || !rows) return;`). A Supabase outage does not show an error — it
shows twelve convincing fake tasks.

**D7 · No loading or error state anywhere in the task views.** 1,771 lines across My Tasks
and Team Tasks contain no loading, error or retry handling.

**D8 · Team Tasks metadata is invented.** Department is assigned round-robin by array
index (`departments[index % departments.length]`); "Backlog" and "Assigned" are two
fabricated columns that both map to `todo`, so dragging between them does nothing; the
workload and productivity panels are literal arrays `[7,5,9,6,4]` and `[92,87,78,95,84]`.

**D9 · The sidebar "My Tasks" badge is a hardcoded `6`.** `Sidebar.tsx:11`.

**D10 · Dashboard deep links disagree with the cards they come from.** "Completed" counts
within a date range; the filter it opens has no date range. Cards are user-scoped; the
page they open is not (because of D1).

**D11 · Dates are computed in UTC.** `new Date().toISOString().slice(0,10)` everywhere.
The organization's timezone is fetched and then never used. For staff in Asia/Calcutta,
"due today" flips at 05:30 local.

**D12 · `NaN%` on Team Tasks with no tasks.** `TeamTasksPage.tsx:116` divides by
`items.length` with no guard.

**D13 · Two nested `<main>` landmarks** on the project workspace — an accessibility
violation, and it broke my own test tooling, which is a good sign of how a screen reader
would fare.

### Fixed in this repository

**D0 · A live credential was published in the sign-in page.** `src/routes/auth.tsx`
shipped a demo shim mapping the password `"123"` to the real account's actual password,
with both values prefilled as form state — so anyone loading `/auth` saw a working login
already typed in. **Removed before the first commit**, because this repository is public.
Normal password sign-in is unchanged and verified working.

> **This still needs a human decision.** The password for `test@gmail.com` was in the
> Lovable ZIP, which has been shared. Treat it as compromised: change it, or delete the
> account once real staff accounts exist.

### Reported but not independently verified

The refutation pass ran out of budget partway through. These are the remaining
high-severity leads, recorded so they are not lost — **each needs checking before you act
on it**, because the verification pass rejected roughly half of everything it examined:

- Recurrence: nothing in the app ever calls `process_scheduled_task_recurrences()`, and
  `task_recurrences` has 0 rows — the feature may never have run.
- The New Task assignee picker lists five fictional people, so assignment may be
  unreachable even in principle.
- Kanban drag may not work on touch devices or in Firefox.
- `user_roles` is queried without an organization filter, so an admin in one org may be
  treated as an admin everywhere (harmless today — there is one organization).
- The Users screen's "Send Login Details" button sends nothing.

### Deliberately rejected

Recorded so nobody re-reports them: the `_authenticated` guard being client-side is
intended TanStack behaviour, not a hole; storing the session in `localStorage` is standard
Supabase; `completed_at` *is* recorded (by a trigger); the "Organization Overview" panel
is progressive disclosure, not a broken panel; and the build no longer targets Cloudflare.

---

## Against `docs/02-requirements.md`

| | Requirement | Status |
|---|---|---|
| R1 | Internal task tracker | ✅ Met, and then some |
| R2 | 30–40 internal users | ✅ Architecture is fine at this size |
| R3 | `flowdesk.upcarrera.com` | ⏳ DNS pending — launching on sslip.io per D3 |
| R4 | On the DigitalOcean droplet | ✅ Build re-targeted to `node-server` |
| R5 | **Email notifications** | ❌ **Not built.** No mail transport exists. This also blocks password recovery. |
| R6 | Free database tier | ✅ Supabase free tier |
| R7 | Scope = whatever Lovable implements | ⚠️ See the headline — less is implemented than it appears |

**Unexpected, not in `docs/02`:** multi-organization support with an org switcher, a
recurring-task engine, a milestone model, and an activity feed. A1 (no student PII) still
holds — the task data is internal operational work.

**A3 is wrong.** `docs/02` assumed "a lightweight admin role may exist". There is a
five-role model in the database with real RLS behind it — more than assumed — but the
screens for managing it do not work.

---

## What has to be true before staff use this

1. **Fix D1 and D2** (~half a day). Without them "My Tasks" is meaningless and assignment
   is invisible. Everything else on this list can wait; these two cannot.
2. **Decide what to do about the admin screens.** Either build persistence for
   projects/users/roles, or hide those nav items so nobody configures something that
   silently discards their work. Hiding them is one line and is the honest option for a
   day-one launch.
3. **Email delivery (R5)** — still blocked on domain configuration, still the open item on
   Naji's roadmap. Confirm with Naji whether he is finishing it.
4. **A company-owned Supabase project** (D2 condition 1) and a **nightly `pg_dump`**
   (D2 condition 2).
5. **Rotate or remove the `test@gmail.com` account.**

None of the above blocks deploying to the temporary URL for testing — which is the point
of D3.
