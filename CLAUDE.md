# FlowDesk — Project Instructions

> **Read this first, then `docs/00-decisions.md` and `docs/07-stack-findings.md`.**
> Those two carry the settled decisions and the audit results. Everything else is context.

## What this project is

**FlowDesk** is an internal task tracker for upCarrera Education. ~30–40 internal staff.
It is a **new, standalone product** — not part of the existing upCarrera CRM.

A working prototype was already built in **Lovable** (an AI app builder) by a colleague,
Naji. That prototype is the de-facto specification. The owner of this repo downloads it as
a ZIP and drops it in this folder.

**Target URL:** `flowdesk.upcarrera.com`
**Hosting:** the existing upCarrera DigitalOcean droplet (shared with the live CRM)

## Current state

**The stack audit is done** (`docs/07-stack-findings.md`) and **the key decisions are
settled** (`docs/00-decisions.md`). Read those two first — do not redo the audit, and do
not reopen the decisions.

| | |
|---|---|
| Lovable code | `flowdeskupc.zip` in this folder — 130 files, audited |
| Stack | **TanStack Start (SSR)** + React 19 + Vite 7 + Tailwind 4 + shadcn/ui |
| Data + auth | **Supabase** — 13 migrations, row-level security. **Staying** (D2) |
| Package manager | **Bun** (`bun.lock`) |
| Built for | **Cloudflare Workers** — must be re-targeted to nitro `node-server` (D1) |
| Hosting | **The DigitalOcean droplet**, under PM2 behind nginx (D1) |
| First launch URL | `flowdesk.168-144-188-190.sslip.io` — real TLS, no third party (D3) |
| DNS | `flowdesk.upcarrera.com` does not resolve yet — **does not block anything** |

## Hard rules — production safety

The deployment target is a **live, business-critical server**. The upCarrera CRM runs on
it and serves real users. Breaking it is far worse than shipping FlowDesk late.

1. **Never modify the existing nginx config** for `admin.upcarrera.com` or
   `admissions.upcarrera.com`. FlowDesk gets its **own** server block in its own file.
2. **Never touch, restart, or reload the CRM's PM2 process** (`upcarrera-api`).
   FlowDesk runs as a separate PM2 app with a different name.
3. **Never run `prisma db push`, migrations, or any schema command against the CRM
   database.** FlowDesk gets its own database, fully isolated.
4. **Do not deploy anything without explicit approval from the user in that session.**
   Building, testing and preparing a release locally is fine. Touching the server is not.
5. **Always run `nginx -t` before any `systemctl reload nginx`.** A bad config takes the
   CRM down with it.
6. **No secrets in git.** No API keys, passwords, tokens or connection strings in any
   committed file. Use `.env`, and keep `.env.example` as the committed template.

## Port allocation

The droplet already uses some ports. Respect these:

| Service | Port | Notes |
|---|---|---|
| CRM API (existing — do not touch) | `127.0.0.1:3000` | PM2 app `upcarrera-api` |
| CRM web dev (local only) | `3001` | |
| **FlowDesk (SSR app)** | **`127.0.0.1:3100`** | PM2 app `flowdesk` — serves pages *and* API |
| **FlowDesk dev (local only)** | **`3000` or `5173`** | whatever `bun run dev` reports |

## Reference implementation

The existing CRM lives at **`~/codes/upcarrera-v2`** and is deployed to the same droplet.
It is a proven, working reference for this exact infrastructure. Read it before inventing
anything:

- `DEPLOY.md` — the full DigitalOcean runbook (architecture, bootstrap, TLS, verification)
- `deploy/deploy.sh` — idempotent build + PM2 restart
- `deploy/nginx/upcarrera.conf` — nginx static SPA + API proxy pattern
- `ecosystem.config.js` — PM2 process definition

**Copy the *operational* patterns** — PM2, TLS, the deploy/verify loop. They are proven on
this box.

> **But note an important difference:** the CRM is a *static SPA plus a separate API*.
> FlowDesk is *server-rendered*, so nginx must proxy **every** request to the Node process
> rather than serving files from disk. Do not copy the CRM's nginx config verbatim —
> `docs/06` has the correct one.

## Working style

- **Audit before building.** Phase 0 is a read-only investigation with a written report.
  Do not skip it, and do not start rewriting the Lovable code before reporting findings.
- **Ask before large rewrites.** If the Lovable code is 70% right, adapt it. Do not
  greenfield a replacement because the style differs from your preference.
- **Verify claims.** Run the code, curl the endpoint, read the output. Do not report
  something works because it should.
- **Flag blockers early.** Several dependencies sit with third parties (see `docs/03`).
  If you hit one, say so plainly and continue with everything that is not blocked.

## Documentation map

| File | Purpose |
|---|---|
| `docs/00-decisions.md` | **Settled decisions — read first, do not re-litigate** |
| `docs/01-context.md` | Background, stakeholders, verified infrastructure facts |
| `docs/02-requirements.md` | What is confirmed, assumed, and unknown |
| `docs/03-open-questions.md` | Blockers and the exact questions to ask |
| `docs/04-lovable-intake.md` | Phase 0 audit method — **already carried out**, see `docs/07` |
| `docs/05-build-plan.md` | Phased build plan with done-when criteria |
| `docs/06-deployment.md` | Deployment runbook for the droplet (SSR-aware) |
| `docs/07-stack-findings.md` | **What the audit found — read first** |
