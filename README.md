# FlowDesk

Internal task tracker for upCarrera Education. ~30–40 internal staff.
Target: **flowdesk.upcarrera.com**

## Status: audited, decisions made, ready to build

Built in **Lovable** by Naji. The ZIP (`flowdeskupc.zip`) has been audited and the stack is
known. The three architectural decisions are settled.

## How to build it

1. Open Claude Code in this folder
2. Paste **the main prompt** from `PROMPT.md`

It runs unattended from ZIP to a verified production build. Deployment is a separate,
explicit prompt — the live CRM shares that server.

## The stack (audited)

**TanStack Start** (SSR) · React 19 · Vite 7 · Tailwind 4 · shadcn/ui · **Supabase**
(database + auth + row-level security, 13 migrations) · **Bun** · originally built for
Cloudflare Workers.

Already built: organisations, projects, tasks with Kanban / list / calendar views,
recurring tasks, milestones, activity feed, a full dashboard, and users/roles admin.
**Considerably more than "a simple task tracker".**

## The three decisions

| | Decision | Why |
|---|---|---|
| **D1** | Host on the **DigitalOcean droplet**, not Cloudflare | Manager asked for the DO space. Requires re-targeting nitro to `node-server`. |
| **D2** | **Keep Supabase** | Replacing it means rebuilding auth and every access rule — days of work on the riskiest code, for under 1 GB of data. |
| **D3** | Launch on a **temporary sslip.io URL** | `flowdesk.upcarrera.com` depends on a third party. This gives real HTTPS today. |

Full reasoning and the conditions attached to D2: `docs/00-decisions.md`.

## What's here

```
CLAUDE.md                    Rules — loaded automatically by Claude Code
PROMPT.md                    The main build prompt, plus deploy and resume prompts
docs/
  00-decisions.md            Settled decisions  ← read first
  01-context.md              Background, people, verified infrastructure facts
  02-requirements.md         Confirmed / assumed / unknown
  03-open-questions.md       Blockers + a ready-to-send message for Naji
  04-lovable-intake.md       Audit method (already carried out)
  05-build-plan.md           Phases with verifiable done-when criteria
  06-deployment.md           Droplet runbook — SSR-aware, written to protect the CRM
  07-stack-findings.md       What the audit found  ← read first
```

## Needs a human (none of it blocks the build)

1. **DNS** — `flowdesk` A record → `168.144.188.190`, from the Site5 administrator
2. **A company-owned Supabase project** before staff use it (D2 condition)
3. **Your approval** to deploy to the production droplet
4. **Naji** — is he finishing email/recovery-code delivery, or are we?

## Important

FlowDesk deploys onto the **same droplet as the live upCarrera CRM**. The safety rules in
`CLAUDE.md` are not decorative — that box serves real users and has been up for months.
