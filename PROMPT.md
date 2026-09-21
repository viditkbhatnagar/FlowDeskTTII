# Prompts for Claude Code

Run from `~/codes/flowdesk`. `CLAUDE.md` loads automatically.

The stack audit is already done (`docs/07`) and the three decisions are settled
(`docs/00`), so a fresh session has what it needs.

## What to paste

```
Read PROMPT.md and execute the FULL RUN section, end to end.
```

That's it. Everything below is the detail it will follow.

**Phases 0–E (build) run unattended.** **Phase F (deploy) will prompt for approval** even
in auto mode — production actions on `168.144.188.190` are escalated by design, because
the live CRM runs there. Be around for that part, or let it finish the build and deploy
later.

---

# FULL RUN — build, verify, deploy

Take FlowDesk from the ZIP to a live, working deployment. Work continuously through every
phase. **Only stop for the four conditions listed at the bottom.**

First read `CLAUDE.md`, `docs/00-decisions.md`, `docs/07-stack-findings.md`,
`docs/02-requirements.md` and `docs/06-deployment.md`.

Context you already have — do not re-derive it: TanStack Start (SSR) + React 19 + Vite +
Tailwind + shadcn/ui, data and auth on **Supabase**, package manager **Bun**, originally
built for **Cloudflare Workers**. We keep Supabase (D2). We deploy to the **DigitalOcean
droplet** (D1). We launch on a **temporary sslip.io hostname** because
`flowdesk.upcarrera.com` does not resolve yet (D3).

## Phase 0 — Prerequisites

- **Bun is not installed on this machine.** Install it:
  `curl -fsSL https://bun.sh/install | bash`, then confirm `bun --version`.
- Confirm `node -v` is ≥ 20 and `rsync` exists.

## Phase A — Get it running locally

1. Extract `flowdeskupc.zip` into `lovable-export/`, then move the project to the repo
   root as the working codebase. Keep `lovable-export/` as a reference until Phase E.
2. `git init`; `.gitignore` covering `.env`, `node_modules`, `.output`, `dist`, `*.zip`,
   `lovable-export/`; first commit.
3. `bun install`, then `bun run dev`.
4. Open it and **sign in**, using the Supabase credentials in the bundled `.env`. If
   sign-in fails, report the actual error — do not build a workaround or a mock.

## Phase B — Verify what is actually there

This is the "what is it building" check, and the owner wants to see it.

5. Walk **every** route. For each screen record: what it does, whether it loads, whether
   it shows real Supabase data or placeholder data, and anything broken or half-finished.
6. Write **`docs/08-feature-inventory.md`**: every screen, every task field, every status,
   the roles/permissions model, and a clear "works / partly works / broken" per screen.
7. If a browser automation tool is available, capture screenshots of the main screens into
   `docs/screenshots/` and reference them from the inventory.
8. Compare against `docs/02-requirements.md` and note anything missing or unexpected.

## Phase C — Re-target off Cloudflare

9. Read `vite.config.ts` and the `@lovable.dev/vite-tanstack-config` wrapper to find where
   the nitro preset is set. Switch it to **`node-server`** (see `docs/06` Step 1).
10. `bun run build`. It must produce **`.output/server/index.mjs`**.
11. Verify: `PORT=3100 node .output/server/index.mjs`, then load it in a browser and sign
    in again. **Do not assume the build works because the command exited 0.**
12. Fix whatever the migration breaks — Cloudflare-specific APIs, env handling and adapter
    imports are the usual casualties. Removing `wrangler.jsonc` and the Cloudflare plugin
    is fine *once* Node output is confirmed working.

## Phase D — Quality pass

13. Per `docs/05` Phase 5: loading and empty states, error handling, input validation,
    keyboard access, and a check at 375 / 768 / 1440 widths. Fix what you find.
14. **Do not redesign anything that already works.** Naji's app is the specification.

## Phase E — Release artefacts

15. Write `deploy/ecosystem.config.js` (PM2 app name **`flowdesk`**, port **3100**) and
    `deploy/nginx/flowdesk.conf` — **SSR: proxy every request, no static root**. Copy the
    config in `docs/06` Step 6 rather than adapting the CRM's.
16. Write `README.md` and `.env.example` — every variable documented, **no real values**.
17. Delete `lovable-export/` once nothing references it. Commit.

## Phase F — Deploy

> **Expect permission prompts here, even in auto mode.** Auto mode classifies anything
> touching `168.144.188.190` as a production action and escalates it — including
> *read-only* SSH. This is correct and expected: the live upCarrera CRM is on that box.
> The owner approves each step. Do not try to route around a denial, and do not switch to
> a different host or credential to avoid one. If the owner is not present, finish every
> local phase, commit, and report that deployment is pending their approval.

18. **Measure the droplet first:**
    ```
    ssh -i ~/.ssh/upcarrera_deploy root@168.144.188.190 'free -m; df -h /; nproc; pm2 list'
    ```
    Record the output. **Build locally and `rsync` `.output/` — do not build on the
    droplet**, so the running CRM is never starved of memory.
19. Create `/opt/flowdesk`, rsync the build, write `/opt/flowdesk/.env` (`chmod 600`) with
    the Supabase values. Remember `VITE_*` values are baked in at **build** time.
20. `pm2 start ecosystem.config.js`, `pm2 save`. Then `pm2 list` and **confirm
    `upcarrera-api` is still online**.
21. Install `deploy/nginx/flowdesk.conf` as its **own** file with
    `server_name flowdesk.168-144-188-190.sslip.io`. Run **`nginx -t`** — it must pass —
    then reload.
22. `certbot --nginx -d flowdesk.168-144-188-190.sslip.io` (that hostname **only**).

## Phase G — Verify everything

23. FlowDesk: `curl -fsS -I https://flowdesk.168-144-188-190.sslip.io/`
24. **The CRM is unaffected** — both must return 200:
    ```
    curl -fsS -I https://admin.upcarrera.com/
    curl -fsS -I https://admissions.upcarrera.com/
    ```
25. `pm2 list` (both apps online) and `free -m` (memory healthy).
26. In a browser on the live URL: sign in → create a project → create a task → assign it →
    move it across the Kanban board → confirm the dashboard updates.

## Final report

Tell the owner: the live URL · what works · what is broken or unfinished · what you changed
to get off Cloudflare · the droplet's memory and disk figures · and what is still needed
from a human.

---

## Stop and ask only if

1. **Droplet memory or disk is critically low** — report the numbers, do not install.
2. **The SSH key is rejected** — the key may have been rotated. Report; do not try others.
3. **Supabase sign-in is fundamentally broken** — e.g. the project is paused or the
   credentials are dead. Report the error.
4. **Anything would touch the CRM** — `/opt/upcarrera`, the `upcarrera-api` process, the
   CRM's nginx vhost or its certificates. Stop and ask. Never edit those.

Otherwise keep going. Prefer reporting a partial result honestly over stopping early.

## Hard rules (also in CLAUDE.md)

- Never edit the CRM's nginx config, process or database
- `nginx -t` before **every** reload — a bad config takes the CRM down too
- Never commit `.env` or any real credential
- Supabase row-level security is load-bearing security code — never disable a policy to
  make a query work
- Verify by running things, not by assuming

---

# Other prompts

**Cut over to the real domain (once DNS exists)**

```
flowdesk.upcarrera.com now resolves. Follow docs/06 Step 9: add the new server_name,
nginx -t, reload, issue a certificate for flowdesk.upcarrera.com only, and rebuild if any
VITE_* value references the sslip.io hostname. Verify both hostnames and confirm the CRM
is unaffected.
```

**Resume a later session**

```
Read CLAUDE.md and docs/. Check git log and docs/08-feature-inventory.md, then tell me
what's done, what's next and what's blocked — before doing any work.
```

**One phase only**

```
Read CLAUDE.md and docs/05-build-plan.md. Do Phase [N] only. Stop at its "done when" and
show me how you verified it.
```

---

# Still needs a human (none of it blocks the run above)

| | What | Who |
|---|---|---|
| 1 | DNS `flowdesk` A → `168.144.188.190` | Site5 admin, via Naji |
| 2 | A company-owned Supabase project before staff use it (D2) | Manager |
| 3 | Is Naji finishing email/recovery-code delivery, or are we? | Naji |
| 4 | Where the git repo should live | Manager |

`docs/03` ends with a ready-to-send message covering these.
