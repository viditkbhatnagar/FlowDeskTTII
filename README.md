# FlowDesk

Internal task tracker for **upCarrera Education** — roughly 30–40 internal staff.
Server-rendered React on TanStack Start, with Supabase for data and authentication.

> **Before you build on this, read [`docs/08-feature-inventory.md`](docs/08-feature-inventory.md).**
> FlowDesk looks finished and is not. **Only tasks are actually saved.** Projects, Users,
> Teams & Departments, Roles and Task & Project Settings all render convincingly and
> discard everything on refresh — there are no database tables behind them. That is a
> manageable launch position, but only if you know it going in.

---

## Quick start

```bash
bun install
cp .env.example .env     # then fill in the Supabase values
bun run dev              # http://localhost:8080
```

Bun is required — the lockfile is `bun.lock`. Install it with
`curl -fsSL https://bun.sh/install | bash`. Node 20+ is needed for the production build.

```bash
bun run build                              # -> .output/server/index.mjs
PORT=3100 node .output/server/index.mjs    # production server
```

| Script | What it does |
|---|---|
| `bun run dev` | Vite dev server on :8080 |
| `bun run build` | Production build via nitro (`node-server` preset) |
| `bun run preview` | Serve the production build |
| `bun run lint` | ESLint |
| `bun run format` | Prettier |

---

## The stack

**TanStack Start** (SSR) · React 19 · Vite 7 · Tailwind 4 · shadcn/ui (Radix) ·
TanStack Router + Query · react-hook-form + zod · recharts · **Supabase**
(Postgres + auth + row-level security, 13 migrations) · **Bun**.

The app is **server-rendered**: a Node process renders every page, not just `/api`.
This matters for deployment — nginx must proxy everything, with no static root.

### Layout

```
src/routes/                      5 route files; _authenticated/ is the protected group
src/routes/_authenticated/index.tsx   the whole workspace — 9 screens switched by a
                                      React `nav` string, not by routing
src/components/workspace/        the 21 feature components
src/lib/workspace-data.tsx       the ONLY place that writes to Supabase
src/lib/organizations-data.tsx   orgs/users/departments/teams/roles — mostly seed data
src/lib/mock-data.ts             hardcoded sample data still rendered by some screens
src/integrations/supabase/       client (browser + server), auth middleware, types
supabase/migrations/             13 migrations — the real schema and all RLS policies
deploy/                          PM2 + nginx configs for the droplet
docs/                            decisions, requirements, deployment runbook, inventory
```

> Careful: `KanbanBoard.tsx`, `TaskListView.tsx`, `CalendarView.tsx`, `StatsCards.tsx`
> and `SidePanels.tsx` are **dead code** — the workspace uses its own inline versions.
> The file called `KanbanBoard.tsx` is not the Kanban board you see on screen.

---

## Configuration

Every variable is documented in [`.env.example`](.env.example). Six are required, all
Supabase.

**The one thing to remember:** `VITE_*` values are **baked into the client bundle at
build time**. Changing them on the server and restarting does nothing to the browser
bundle — you must rebuild and redeploy.

The publishable (`sb_publishable_…`) key is designed to be public and is protected by
row-level security. **Never** add a service-role key: it bypasses RLS and the app does
not need one.

---

## Security

Access control is enforced by **Supabase row-level security**, defined in
`supabase/migrations/`. Two `SECURITY DEFINER` predicates carry the model:

- `private.has_organization_access(user, org)` — active membership?
- `private.has_management_access(user, org)` — role is `admin`, `manager` or `team_lead`?

This was verified: signed out, every table returns an empty result rather than data.

**Treat those policies as load-bearing security code.** If you change the schema,
re-check the policies, and never disable RLS to make a query work.

Note that the *interface* enforces almost nothing — there is one permission flag in the
whole front end (`canManageUsers`). The five-role matrix on the Roles screen is not
wired to anything. The real boundary is RLS, and RLS is sound; the risk is staff
believing they have configured permissions when they have not. See `docs/08`.

---

## Deployment

FlowDesk is deployed to the existing upCarrera **DigitalOcean droplet**
(`168.144.188.190`) under PM2 behind nginx. The full runbook is
[`docs/06-deployment.md`](docs/06-deployment.md).

```
deploy/ecosystem.config.cjs      PM2 app `flowdesk`, port 3100, loopback only
deploy/nginx/flowdesk.conf       its own vhost — proxies every request (SSR)
```

> The PM2 config is `.cjs`, **not** `.js` as `docs/06` shows. `package.json` sets
> `"type": "module"`, so a `.js` config is parsed as ESM and its `module.exports`
> silently yields no apps. This was caught before deploying; use the `.cjs` file.

Build **locally** and `rsync` `.output/` to the droplet. Do not build on the box — it
has 4 GB and the live CRM shares it.

### The rules that are not negotiable

That droplet runs the **live upCarrera CRM**, serving real users. Breaking it is far
worse than shipping FlowDesk late.

1. Never edit the CRM's nginx vhosts (`admin.upcarrera.com`, `admissions.upcarrera.com`).
   FlowDesk gets its own file.
2. Never touch, restart or reload the CRM's PM2 process (`upcarrera-api`).
3. Never run a schema command against the CRM database.
4. Always run `nginx -t` before `systemctl reload nginx` — a bad config takes the CRM
   down too.
5. FlowDesk lives only in `/opt/flowdesk`. `/opt/upcarrera` belongs to the CRM.
6. No secrets in git.

Ports: CRM API `3000` · **FlowDesk `3100`** · FlowDesk dev `8080`.

### Rollback

```bash
pm2 stop flowdesk && pm2 delete flowdesk && pm2 save
rm -f /etc/nginx/sites-enabled/flowdesk.conf
nginx -t && systemctl reload nginx
```

FlowDesk disappears; the CRM is untouched throughout.

---

## Decisions already settled

Do not re-litigate these — reasoning in [`docs/00-decisions.md`](docs/00-decisions.md).

| | Decision | Why |
|---|---|---|
| **D1** | Host on the **DigitalOcean droplet**, not Cloudflare | The manager asked for the DO space. Required re-targeting nitro to `node-server`. |
| **D2** | **Keep Supabase** | Replacing it means rebuilding auth and every access rule — days of work on the riskiest code, for under 1 GB of data. |
| **D3** | Launch on a **temporary sslip.io URL** | `flowdesk.upcarrera.com` depends on a third party. `flowdesk.168-144-188-190.sslip.io` gives real HTTPS today. |

---

## Still needs a human

1. **DNS** — `flowdesk` A record → `168.144.188.190`, from the Site5 administrator.
2. **A company-owned Supabase project** before staff use it, plus a nightly `pg_dump`
   onto the droplet (both are conditions of D2).
3. **Email notifications (R5)** — not built. Also blocks password recovery. Confirm
   with Naji whether he is finishing it.
4. **Rotate or delete the `test@gmail.com` account.** Its password shipped inside
   `flowdeskupc.zip`; treat it as compromised.
5. **Decide what to do about the admin screens** — build persistence, or hide them so
   nobody configures something that is silently discarded.

---

## Documentation

| File | Purpose |
|---|---|
| [`docs/00-decisions.md`](docs/00-decisions.md) | Settled decisions — read first |
| [`docs/01-context.md`](docs/01-context.md) | Background, people, infrastructure facts |
| [`docs/02-requirements.md`](docs/02-requirements.md) | Confirmed / assumed / unknown |
| [`docs/03-open-questions.md`](docs/03-open-questions.md) | Blockers, and a message to send |
| [`docs/05-build-plan.md`](docs/05-build-plan.md) | Phases with verifiable criteria |
| [`docs/06-deployment.md`](docs/06-deployment.md) | Droplet runbook, SSR-aware |
| [`docs/07-stack-findings.md`](docs/07-stack-findings.md) | What the stack audit found |
| [`docs/08-feature-inventory.md`](docs/08-feature-inventory.md) | **What actually works — read this** |

Origin: the prototype was built in [Lovable](https://lovable.dev) by Naji, and that
prototype is the product specification.
