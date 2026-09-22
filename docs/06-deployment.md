# 06 — Deployment

> **The target server runs the live upCarrera CRM.** Re-read the hard rules in
> `CLAUDE.md`. **Never touch the server without explicit approval from the owner in that
> session.**

Decisions that shape this document: **D1** (droplet, not Cloudflare), **D3** (temporary
URL first) — see `docs/00-decisions.md`.

## This is NOT a static SPA — read this first

The CRM next door is a static SPA plus a separate API. **FlowDesk is different.** It is
**TanStack Start with server-side rendering**, so there is a Node process that serves
*every* request — pages included, not just `/api`.

Two consequences:

1. **nginx proxies everything to the Node process.** There is no `root` directory of
   static files to serve. Do not copy the CRM's nginx config verbatim.
2. **Nitro must be re-targeted from Cloudflare to `node-server`.** The project ships with
   `@cloudflare/vite-plugin` and `wrangler.jsonc`. That output will not run under PM2.

## Step 1 — Re-target the build (do this locally, first)

Inspect `vite.config.ts` — it uses `@lovable.dev/vite-tanstack-config`, so read that
wrapper before assuming where the preset is set.

The goal is a Node server bundle, conventionally at `.output/server/index.mjs`:

```bash
bun install
# set the nitro preset to node-server (via vite.config.ts, or NITRO_PRESET=node-server)
bun run build
ls -la .output/server/index.mjs     # must exist before going further
PORT=3100 node .output/server/index.mjs   # must serve locally
```

**Do not proceed to the server until this runs locally.** Removing `wrangler.jsonc` and
the Cloudflare plugin is reasonable once Node output is confirmed — but verify first.

> Bun is the project's package manager (`bun.lock`). Install it locally and on the droplet,
> or convert the lockfile deliberately. Do not mix package managers.

## Step 2 — Measure the droplet before installing anything

```bash
ssh -i ~/.ssh/upcarrera_deploy root@168.144.188.190 \
  'free -m; df -h /; nproc; pm2 list; nginx -v'
```

The CRM's notes call the box's 4 GB *adequate* for its own builds. **If memory is already
tight, do not build on the droplet** — build locally and rsync `.output/`. Report the
numbers to the owner rather than pressing on.

## Step 3 — Place the code

```bash
mkdir -p /opt/flowdesk
# rsync the built .output/ plus package.json, or clone and build — per Step 2
```

FlowDesk lives **only** in `/opt/flowdesk`. `/opt/upcarrera` belongs to the CRM — never
write there.

## Step 4 — Environment

```bash
cat > /opt/flowdesk/.env <<'EOF'
NODE_ENV=production
PORT=3100
HOST=127.0.0.1
SUPABASE_URL=...
SUPABASE_PROJECT_ID=...
SUPABASE_PUBLISHABLE_KEY=...
VITE_SUPABASE_URL=...
VITE_SUPABASE_PROJECT_ID=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
EOF
chmod 600 /opt/flowdesk/.env
```

Use the **company-owned** Supabase project here if it exists yet (D2 condition 1).
`VITE_*` values are baked into the client bundle at build time — they must be set **before
`bun run build`**, not only at runtime.

## Step 5 — PM2

```js
// /opt/flowdesk/ecosystem.config.js
module.exports = {
  apps: [{
    name: 'flowdesk',                    // NOT upcarrera-api
    cwd: '/opt/flowdesk',
    script: '.output/server/index.mjs',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production', PORT: '3100', HOST: '127.0.0.1' },
  }],
};
```

```bash
pm2 start ecosystem.config.js && pm2 save
pm2 list      # CONFIRM upcarrera-api IS STILL ONLINE
```

## Step 6 — nginx (SSR: proxy everything)

```nginx
# /etc/nginx/sites-available/flowdesk.conf
upstream flowdesk_app { server 127.0.0.1:3100; keepalive 16; }

server {
  listen 80;
  listen [::]:80;
  server_name flowdesk.168-144-188-190.sslip.io;   # add flowdesk.upcarrera.com when DNS lands

  client_max_body_size 25m;

  # SSR — every request goes to the Node process, including pages.
  location / {
    proxy_pass http://flowdesk_app;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    proxy_cache_bypass $http_upgrade;
  }

  # Hashed build assets — safe to cache hard.
  location /_build/ {
    proxy_pass http://flowdesk_app;
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

```bash
ln -sf /etc/nginx/sites-available/flowdesk.conf /etc/nginx/sites-enabled/flowdesk.conf
nginx -t                                  # MUST pass — a bad config takes the CRM down too
systemctl reload nginx
curl -I https://admin.upcarrera.com/      # CRM must still return 200
```

**Never edit the CRM's vhost.** FlowDesk's config is its own file.

## Step 7 — TLS on the temporary hostname

`sslip.io` resolves `flowdesk.168-144-188-190.sslip.io` to `168.144.188.190` with no
registration, so Let's Encrypt can validate it immediately — no waiting on Site5.

```bash
dig +short flowdesk.168-144-188-190.sslip.io    # expect 168.144.188.190
certbot --nginx -d flowdesk.168-144-188-190.sslip.io
```

Pass **only** FlowDesk's hostname. Never re-issue the CRM's certificate.

## Step 8 — Verify (all of it)

```bash
curl -fsS -I https://flowdesk.168-144-188-190.sslip.io/   # FlowDesk up
curl -fsS -I https://admin.upcarrera.com/                 # CRM UNAFFECTED
curl -fsS -I https://admissions.upcarrera.com/            # CRM UNAFFECTED
pm2 list                                                  # both apps online
free -m                                                   # memory still healthy
```

Then log in through a browser and walk the real journey: sign in → create a project →
create a task → assign it → move it across the Kanban board → check the dashboard updates.

**Confirming the CRM is still healthy is the most important test on this page.**

## Step 9 — Cut over to the real domain (once DNS exists)

```bash
dig +short flowdesk.upcarrera.com         # must return 168.144.188.190 first
# add flowdesk.upcarrera.com to server_name, then:
nginx -t && systemctl reload nginx
certbot --nginx -d flowdesk.upcarrera.com
```

Rebuild if any `VITE_*` value or absolute URL references the temporary hostname. Keep the
sslip.io name working for a while as a fallback.

## Rollback

```bash
pm2 stop flowdesk && pm2 delete flowdesk && pm2 save
rm -f /etc/nginx/sites-enabled/flowdesk.conf
nginx -t && systemctl reload nginx
```

FlowDesk disappears; the CRM is untouched throughout. **Know this before you deploy.**

## Backups (D2 condition 2 — not optional)

Supabase's free tier gives no point-in-time recovery, so keep an in-house copy:

```bash
# nightly cron on the droplet
pg_dump "$SUPABASE_DB_URL" | gzip > /opt/flowdesk/backups/flowdesk-$(date +\%F).sql.gz
```

Retain ~30 days, and **restore one into a scratch database to prove the backup works**
before relying on it.

---

# As actually deployed — 22 September 2026

FlowDesk is **live** at **https://flowdesk.168-144-188-190.sslip.io** (D3 temporary
hostname, real Let's Encrypt certificate, expires 20 December 2026).

The steps above are correct, with **two corrections found by deploying, not by reading**.
Both are already fixed in `deploy/ecosystem.config.cjs`.

## Correction 1 — the PM2 config must be `.cjs`, not `.js`

`package.json` sets `"type": "module"`, so `ecosystem.config.js` is parsed as ESM and its
`module.exports` silently yields a config with **no apps**. Use
`deploy/ecosystem.config.cjs`. Caught locally by loading the file before shipping it.

## Correction 2 — FlowDesk needs its own Node 22 runtime

The droplet ships **Node 20**, and the live CRM runs on it, so it must not be upgraded.
But `@supabase/supabase-js` requires a global `WebSocket`, which only exists from Node 22.
Under Node 20 every server function failed with:

```
Node.js detected but native WebSocket not found.
```

**This surfaced as a permanently empty Dashboard while all eight other screens looked
completely fine** — a smoke test on `/` would have reported success. Only the Dashboard
uses a server function.

FlowDesk therefore runs under its own interpreter. `/usr/bin/node` stays at v20 and the
CRM is untouched:

```bash
VER=v22.23.2
curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/$VER/node-$VER-linux-x64.tar.xz"
mkdir -p /opt/flowdesk/node
tar -xJf /tmp/node.tar.xz -C /opt/flowdesk/node --strip-components=1
/opt/flowdesk/node/bin/node -v          # v22.23.2
/usr/bin/node -v                        # v20.20.2 — unchanged, CRM's runtime
```

`ecosystem.config.cjs` sets `interpreter: '/opt/flowdesk/node/bin/node'`.

## Correction 3 — PM2's `env_file` does not work

On PM2 7.0.1 `env_file` is recorded in the process metadata but **never injected**. The
app booted without `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` and every server function
failed with `[Supabase] Missing Supabase environment variable(s)`. `ecosystem.config.cjs`
now parses `/opt/flowdesk/.env` itself and merges it into `env`, with the
`PORT`/`HOST`/`NODE_ENV` literals last so they always win.

## Measured before installing anything

| | Before | After |
|---|---|---|
| Memory available | 3256 MB of 3916 | 3228 MB |
| Disk | 6.6 G used, 70 G free (9%) | 6.8 G used, 70 G free (9%) |
| CPU | 2 cores | — |
| `upcarrera-api` | online, pid 88928, 3M uptime | **online, same pid, same uptime** |

FlowDesk idles at ~65–95 MB. There was never any memory pressure.

## Verified after deploying

- All nine screens walked in a real browser against the live HTTPS URL — zero console
  errors, Dashboard showing real figures.
- Full journey: sign in → create a task → move it across the Kanban board → confirmed in
  the database, then reverted. `work_tasks` returned to 18 rows.
- `https://admin.upcarrera.com/` and `https://admissions.upcarrera.com/` both **200**,
  before and after every change.
- `nginx -t` passed before each reload. The CRM's certificate was never re-issued.

## What is on the droplet

```
/opt/flowdesk/.output/              the build (rsynced, ~6 MB)
/opt/flowdesk/node/                 FlowDesk's own Node 22 runtime
/opt/flowdesk/ecosystem.config.cjs  PM2 definition
/opt/flowdesk/.env                  chmod 600, root-owned
/var/log/flowdesk/                  out.log, error.log
/etc/nginx/sites-available/flowdesk.conf   + symlink in sites-enabled/
```

Nothing was written outside those paths.

## Redeploying

```bash
bun run build                                     # locally
rsync -az --delete -e "ssh -i ~/.ssh/upcarrera_deploy" \
  .output/ root@168.144.188.190:/opt/flowdesk/.output/
ssh -i ~/.ssh/upcarrera_deploy root@168.144.188.190 \
  'chown -R root:root /opt/flowdesk/.output && pm2 restart flowdesk'
```

**`pm2 restart flowdesk` — never `pm2 restart all`.** That would bounce the live CRM.

---

# Taking the admin screens live

The admin screens (Projects, Users, Teams & Departments, Roles, Settings) now read
and write the database, but that needs migration `20260922000000_admin_persistence.sql`
applied. **Until it is, the deployed site still runs the earlier build and those
screens still discard edits.**

Everything below has been rehearsed end to end against a local Supabase stack
(`supabase start`) with the real data imported. What is missing is only the
credential for a real project.

## Step 1 — apply the migration

Any one of these; they do the same thing.

**With the Supabase CLI** (needs a personal access token from
supabase.com/dashboard/account/tokens):

```bash
supabase link --project-ref <project-ref>
supabase db push
supabase gen types typescript --linked > src/integrations/supabase/types.ts
```

**With psql** (needs the database connection string from Project Settings →
Database):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260922000000_admin_persistence.sql
```

**By hand:** paste that file into the Supabase SQL editor and run it. It is
idempotent — running it twice changes nothing.

## Step 2 — confirm it took

```sql
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('departments','teams','roles','project_categories',
                      'task_tags','task_status_settings','project_members');
-- expect 7 rows

select name, base_role from public.roles order by name;
-- expect the five seeded roles per organization
```

If `roles` is empty, the seed trigger did not run — re-apply; the backfill block
at the end of the migration covers existing organizations.

## Step 3 — rebuild and redeploy

`VITE_*` values are baked in at build time, so this is a rebuild.

```bash
bun run build
rsync -az --delete -e "ssh -i ~/.ssh/upcarrera_deploy" \
  .output/ root@168.144.188.190:/opt/flowdesk/.output/
ssh -i ~/.ssh/upcarrera_deploy root@168.144.188.190 \
  'chown -R root:root /opt/flowdesk/.output && pm2 restart flowdesk'
```

**`pm2 restart flowdesk` — never `pm2 restart all`.**

## Step 4 — verify

```bash
curl -fsS -I https://flowdesk.168-144-188-190.sslip.io/
curl -fsS -I https://admin.upcarrera.com/        # CRM must still be 200
curl -fsS -I https://admissions.upcarrera.com/   # CRM must still be 200
```

Then sign in and create a department under Teams & Departments, **reload the
page**, and confirm it is still there. That single check is what separates this
build from the previous one.

## What still will not work afterwards

- **Creating a new user account from the browser.** Minting accounts needs
  privileges the public key must never have. Editing, deactivating and
  role-assigning existing people all persist; inviting someone new needs a
  server-side step that does not exist yet.
- **Adding a sixth task status or a new priority.** Those are Postgres enums on
  columns the board and dashboard key off; their presentation is editable, the
  set is not.
- **Email**, including password recovery. Not built. See `docs/03`.
