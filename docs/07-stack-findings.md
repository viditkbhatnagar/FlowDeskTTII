# 07 — Stack Findings (audit already done)

> **Phase 0 of `docs/04` has already been completed.** These are the verified findings.
> Do not repeat the audit from scratch — read this, spot-check anything you depend on,
> and get on with the build.

_Audited: 21 September 2026, from `flowdeskupc.zip` (130 files)._

## The stack

| Layer | What it is |
|---|---|
| Framework | **TanStack Start** — SSR React, `nitro` server runtime |
| UI | React 19, Vite 7, Tailwind 4, shadcn/ui (Radix), lucide icons |
| Router | TanStack Router, file-based (`src/routes/`), generated `routeTree.gen.ts` |
| Data fetching | TanStack Query |
| Database + auth | **Supabase** (`@supabase/supabase-js`), 13 SQL migrations |
| Forms / validation | react-hook-form + zod |
| Charts | recharts |
| Package manager | **Bun** (`bun.lock`, `bunfig.toml`) |
| Original deploy target | **Cloudflare Workers** (`wrangler.jsonc`, `@cloudflare/vite-plugin`) |

Proprietary Lovable packages are used — `@lovable.dev/cloud-auth-js` and
`@lovable.dev/vite-tanstack-config`. **Both are public on npm** (verified: 1.2.1 and
2.23.1 respectively), so the project installs outside Lovable.

## Key paths

```
src/routes/                     file-based routes; _authenticated/ is the protected group
src/router.tsx, src/server.ts, src/start.ts    app + SSR entrypoints
src/integrations/supabase/      client, auth middleware, generated types
src/components/workspace/       all 19 feature components
src/lib/                        dashboard logic, recurrence, mock data, workspace data
supabase/migrations/            13 migrations — the real schema
vite.config.ts                  currently wired for Cloudflare — MUST CHANGE (see docs/06)
.env                            Supabase URL + publishable (anon) key
```

## Features already built

Organizations (multi-org with a switcher) · Projects · Tasks with a Kanban board, list
view and calendar view · Task detail drawer · Recurring tasks · Milestones · Activity feed
· Dashboard with stats cards, "needs attention", upcoming deadlines, project health, team
workload and a completion trend · My Tasks and Team Tasks · Users, Roles and Structure
admin pages.

**This is considerably more than "a simple task tracker."** Per `roadmap.md`, every item
is complete except one:

> `[ ] Connect an owned email domain for recovery-code delivery (blocked on domain configuration)`

That is the same DNS blocker tracked in `docs/03`, and it is what Naji meant by "I'm
currently building that".

## Security notes

- `.env` ships inside the ZIP. It holds `SUPABASE_URL`, `SUPABASE_PROJECT_ID` and
  `SUPABASE_PUBLISHABLE_KEY`. The publishable (anon) key **is designed to be public** and
  is protected by row-level security — so this is not an emergency. **No service-role key
  is present**, which is the one that would have been.
- Still: **never commit `.env`.** `.gitignore` already excludes it.
- Access control is enforced by **Supabase row-level security** defined in the migrations.
  Treat those policies as load-bearing security code — if you change the schema, re-check
  the policies, and never disable RLS to "make a query work".

## Why Supabase is staying

Supabase supplies the database **and** authentication **and** the org-scoped RLS policies.
Replacing it means rebuilding auth and reimplementing every access rule in application
code — days of work on the riskiest part of the system, for an app holding well under 1 GB.

**Decision: keep Supabase.** See `docs/02` for the conditions attached.
