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

**Build against the hosted project, not local Supabase.** Vite bakes `VITE_SUPABASE_*` into
the browser bundle at build time, and `.env.local` (used for local development) overrides
`.env`. A plain `bun run build` on a machine with `.env.local` pointing at `127.0.0.1` ships
a site whose browser code calls your laptop. Values already in the shell environment win
over both files, so build with the hosted ones set explicitly (they are the public URL and
publishable key from `.env`), then check the bundle:

```bash
set -a; . ./.env; set +a                          # hosted SUPABASE/VITE_SUPABASE values
bun run build
grep -rl 'azrpqltfpvbfnjawqxbp' .output/public >/dev/null && echo "hosted: ok"
grep -rl '127.0.0.1:544' .output >/dev/null && echo "LOCAL URL IN BUILD — do not deploy"
```

```bash
rsync -az --delete -e "ssh -i ~/.ssh/upcarrera_deploy" \
  .output/ root@168.144.188.190:/opt/flowdesk/.output/
ssh -i ~/.ssh/upcarrera_deploy root@168.144.188.190 \
  'chown -R root:root /opt/flowdesk/.output && pm2 restart flowdesk'
```

**`pm2 restart flowdesk` — never `pm2 restart all`.** That would bounce the live CRM.

That restart reuses the environment PM2 captured at the last start. It does **not** re-read
`/opt/flowdesk/.env`. After any change to `.env`, restart through the ecosystem file
instead: `pm2 restart /opt/flowdesk/ecosystem.config.cjs --only flowdesk && pm2 save`.

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

- **Creating a new user account or organization from the browser.** Built since:
  Settings → Users → Add User and Settings → Organizations → Add Organization work
  once the onboarding migration is applied. See "Adding people and organizations
  from the browser" at the end of this document.
- **Adding a sixth task status or a new priority.** Those are Postgres enums on
  columns the board and dashboard key off; their presentation is editable, the
  set is not.
- **Email.** Built since; it needs its own migration and settings — see "Email
  notifications" below.

---

# Email notifications

FlowDesk sends nine kinds of email: account access, added to a project, task assigned,
due-date reminder, overdue alert, and the daily/weekly task digests and management
summaries. The database queues them in `email_outbox`, and a worker inside the SSR process
sends them through Microsoft Graph. Supabase Auth sends the password-reset code itself,
using the template in `deploy/email/`. Rehearsed end to end against local Supabase,
including the built server (`node .output/server/index.mjs`) with the log transport.

**Nothing is sent until `EMAIL_WORKER_ENABLED=true` and every Microsoft Graph credential
below is set.** Until then the worker logs `[email] worker not started: <reason>` once at
boot, and the site carries on. That line goes to `out.log` when the worker is simply off,
and to `error.log` when it is switched on but a setting is missing or wrong. The database
triggers still queue events in the meantime. When the worker first starts, it sends
queued rows that have not yet expired: task/project emails from the last 48 hours and
account-access emails from the last 7 days. To start clean, first run
`delete from public.email_outbox where status = 'pending';` in the SQL editor.

Rules the system enforces, so nobody is surprised by them:

- **The welcome (account access) email goes out when a person is first given an
  organization, and only if they have never signed in.** A login created in Lovable Cloud
  sends nothing until it gets an organization; Add User creates both at once. It goes out
  once per person: adding a second organization, or removing and re-adding one, sends
  nothing more. The only way to send another is an admin's **Resend welcome email** on the
  person's page, which works until they first sign in (see "Adding people and
  organizations from the browser"). It is withdrawn if every membership is removed again
  before it goes out. Only an admin can add a person or a membership, so no one else can
  make FlowDesk send a welcome email, even if sign-ups were ever switched on. An admin can
  send one to any address they type; the abuse limits in "Adding people and organizations
  from the browser" cap how many, per admin and for all admins together.

  **Onboarding a new colleague:** once the onboarding migration is applied, use
  **Settings → Users → Add User**. Their welcome email carries a one-time link to choose a
  password. The SQL route below is the **fallback**, for when the browser route is not
  available. Its welcome email links to the reset-password page instead, which sends a
  6-digit code. A brand-new login has no organization yet, so it does not appear in
  FlowDesk → Settings → Users until step 2:
  1. Lovable Cloud → Users → add the user with their email (and a temporary password if
     asked; they will set their own through the welcome email).
  2. Lovable Cloud → SQL editor, with their email and the organization code (`UPC` for
     upCarrera, `TTII` for Teachers' Training Institute of India):

     ```sql
     insert into public.organization_memberships (user_id, organization_id, is_primary, status)
     select u.id, o.id, true, 'active' from auth.users u, public.organizations o
     where u.email = 'new.person@upcarrera.com' and o.code = 'UPC';
     insert into public.user_roles (user_id, organization_id, role)
     select u.id, o.id, 'employee' from auth.users u, public.organizations o
     where u.email = 'new.person@upcarrera.com' and o.code = 'UPC';
     ```

  3. The welcome email goes out within about five minutes. The person now appears in
     FlowDesk → Settings → Users, where you set their department, team and role.
- **Email always goes to the sign-in address** (`auth.users.email`). `profiles.email` is a
  display copy, and users cannot change it. To change where someone's email goes, change
  their sign-in email. People also cannot change their own active/inactive status; only an
  admin can.
- **One account can queue at most 50 event emails an hour** (task assigned and added to a
  project, counted together, including requests made in parallel; welcome emails are
  neither capped nor counted). Past that, the write still succeeds but no email is queued.
  The work still appears in the digests, and Postgres logs a `WARNING … reached the hourly
  email cap; not queued`. An admin assigning more than 50 tasks in one sitting will hit
  this. The limit is the literal `50` in `private.email_actor_over_cap`. Email never costs
  anyone a save: if the cap check has to wait more than a second, that one email is skipped
  (`WARNING … lock timeout`) and the write goes through.
- **At most 10 due-date reminders and 10 overdue alerts per person per day**, the most
  urgent first (priority, then due date), counted across the whole day's ticks. The daily
  digest still lists every task. The limit is `TASK_EMAILS_PER_DAY` in
  `src/lib/email/schedule.ts` and the literal `10` in `public.email_worker_enqueue`; change
  both together.
- **A Microsoft outage never uses up an email's last attempt.** Such an email waits and
  retries; one Microsoft keeps refusing ends as `expired` (with its error) rather than
  `failed` when its time runs out.
- **Notification settings take effect within an hour.** Between send windows the worker
  decides whether to plan from organization settings it refreshes at least hourly, so a
  change to an organization's send hour or working days can take up to 60 minutes to apply.
  Per-person email preferences apply to the next email.

## Where the worker logs

PM2 writes FlowDesk's stdout and stderr to two different files, with a timestamp on every
line. Always check both.

| File | `[email]` lines |
|---|---|
| `/var/log/flowdesk/out.log` | `worker started (…)`, `worker not started: EMAIL_WORKER_ENABLED is not "true"`, `tick N: <counts>` (the first tick, then only ticks that planned, claimed or sent something), and on a restart mid-batch `stopping: N email(s) put back for the next start` (they go out about 30 s after the new process starts) |
| `/var/log/flowdesk/error.log` | `worker not started: <missing or wrong setting>`, `tick N failed: …` (for example `unauthorized`), `planning failed` / `enqueue failed`, `planning skipped <scope> <id>: …` (one person, task or organization whose data could not be planned; everyone else is still planned), `compose failed for …`, and one `<n> x <outcome>: <reason>` line per distinct send failure in a tick |

```bash
grep '\[email\]' /var/log/flowdesk/out.log   | tail -n 5
grep '\[email\]' /var/log/flowdesk/error.log | tail -n 5
```

## How the sender is set up (Microsoft 365)

These are facts about the Microsoft 365 tenant, kept here for whoever maintains this
next. No secret appears here, and nothing here needs changing for a normal deploy.

- **From:** `flowdesk@upcarrera.com`, a shared mailbox named **Flowdesk**. Microsoft
  ignores the display name that FlowDesk sends and uses the mailbox's own display name. So
  `MAIL_FROM_NAME` has no visible effect. To change the name people see, rename the
  mailbox in the Exchange admin center.
- **Reply-To:** `hello@upcarrera.com` (`MAIL_REPLY_TO`), so replies reach a monitored
  inbox.
- **App registration:** the Entra app **upCarrera Mailer**, application (client) ID
  `af15433e-11ae-4754-9907-45712db2be94` (this is `MS_CLIENT_ID`). It holds the Microsoft
  Graph `Mail.Send` *application* permission. `MS_TENANT_ID` is the Directory (tenant) ID
  on the app's Overview page.
- **Its own client secret:** FlowDesk uses the client secret named **`flowdesk`**
  (`MS_CLIENT_SECRET` is that secret's *Value*, not its ID). The CRM uses a separate secret
  on the same app, **`crm-mailer`**. Rotating or deleting one never breaks the other, so
  never copy the CRM's secret into FlowDesk. Client secrets expire, so note the expiry of
  `flowdesk`. To rotate it:
  1. Add a new secret under the app's Certificates & secrets.
  2. Put its Value in `MS_CLIENT_SECRET`.
  3. Restart through the ecosystem file, with no rebuild:
     `pm2 restart /opt/flowdesk/ecosystem.config.cjs --only flowdesk && pm2 save`.
     Then check the logs as in Step 4.
  4. Then delete the old secret.
- **Who it may send as:** an Exchange Application Access Policy lets the app send only
  as members of the mail-enabled group **upCarrera Mailer Scope**. Today those are
  `hello@upcarrera.com` and `flowdesk@upcarrera.com`. Sending as any other address fails
  with `403 ErrorAccessDenied` in `error.log`. To use a new sender mailbox:
  1. Add it to that group first.
  2. Allow up to about an hour for Microsoft to honour the change.
  3. Confirm with `Test-ApplicationAccessPolicy -Identity <mailbox> -AppId af15433e-11ae-4754-9907-45712db2be94`
     in Exchange Online PowerShell. It should report `Granted`.
  4. Only then change `MAIL_FROM_ADDRESS`.

## Step 1 — apply the migration (SQL editor)

This needs `20260922000000_admin_persistence.sql` and `20260925000000_task_collaboration.sql`
applied first (`deploy/supabase/build-hosted-upgrade.sh`). The bundle stops with a clear
error if they are missing.

```bash
bash deploy/supabase/build-email-upgrade.sh > email-upgrade.sql   # locally
```

Paste `email-upgrade.sql` into the SQL editor and run it. It is idempotent and runs as a
single transaction.

## Step 2 — the worker secret

The server keeps the secret, and the database keeps only its SHA-256. Generate the secret
**on the droplet, as root** (`ssh -i ~/.ssh/upcarrera_deploy root@168.144.188.190`). The
block below writes it straight into FlowDesk's own `.env` and prints only the hash. It
touches nothing else on the box.

```bash
F=/opt/flowdesk/.env
cp -p "$F" "$F.bak.$(date +%Y%m%d%H%M%S)"          # chmod 600 copy; removed after Step 4
sed -i '/^EMAIL_WORKER_SECRET=/d' "$F"             # drop any old or empty line
[ -z "$(tail -c1 "$F")" ] || echo >> "$F"          # make sure the file ends in a newline
echo "EMAIL_WORKER_SECRET=$(openssl rand -hex 32)" >> "$F"
grep -c '^EMAIL_WORKER_SECRET=' "$F"               # expect 1
sed -n 's/^EMAIL_WORKER_SECRET=//p' "$F" | tr -d '\n' | sha256sum
```

The last line prints a 64-character hash followed by `  -`. Copy only the hash.

> **If the hash starts with `e3b0c442`, stop.** That is the SHA-256 of an *empty* string
> (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`). It means the
> secret line is missing or blank. Storing that hash makes every tick fail with
> `unauthorized`. Run the block again.

Then run this in the SQL editor with that hash:

```sql
INSERT INTO private.email_worker_config (id, secret_sha256)
VALUES (1, decode('<64 hex chars>', 'hex'))
ON CONFLICT (id) DO UPDATE SET secret_sha256 = EXCLUDED.secret_sha256, updated_at = now();

select encode(secret_sha256, 'hex') from private.email_worker_config;
-- must equal the hash above, and must not start with e3b0c442
```

Until this row exists, or while it does not match, every tick fails and `error.log` shows
`[email] tick N failed: … unauthorized`. To rotate the secret later, repeat this step, then
restart with no rebuild:
`pm2 restart /opt/flowdesk/ecosystem.config.cjs --only flowdesk && pm2 save`. In between,
ticks fail with `unauthorized` and emails simply wait in the queue.

## Step 3 — the rest of `/opt/flowdesk/.env`

Add these with an editor (`nano /opt/flowdesk/.env`). Secret values live only on the
server. `EMAIL_WORKER_SECRET` is already there from Step 2. Do not add a second, empty
copy, because the last line for a key wins.

```
EMAIL_WORKER_ENABLED=true
EMAIL_TRANSPORT=graph
MS_TENANT_ID=
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MAIL_FROM_ADDRESS=flowdesk@upcarrera.com
MAIL_FROM_NAME=Flowdesk
MAIL_REPLY_TO=hello@upcarrera.com
APP_URL=https://flowdesk.upcarrera.com
```

"How the sender is set up" above says where each `MS_*` value comes from.
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are already in the file, and the worker uses
them. `EMAIL_WORKER_INTERVAL_MS` is optional (default 300000).

**Set `EMAIL_WORKER_ENABLED=true` only once every `MS_*` value is in.** Until then, leave
it out or set it to `false`. The worker stays off and the triggers keep queuing.

**Never use `EMAIL_TRANSPORT=log` on the server.** The log transport writes each email to
an `.html` file and then marks it *sent* in whatever database `SUPABASE_URL` points at.
On the droplet, that is production. That day's digests, and every queued account-access,
invitation and assignment email, would be marked sent and never delivered. Names,
addresses and task titles would also be left on disk. Use it only against local Supabase
(`supabase start`). The worker refuses it under `NODE_ENV=production`, which
`ecosystem.config.cjs` always sets. It logs `worker not started` to `error.log` instead.
The override for that, `EMAIL_LOG_ALLOW_PRODUCTION`, must never be set on the droplet.

`ecosystem.config.cjs` reads this file only when PM2 evaluates the ecosystem file. That
happens at `pm2 start` and at `pm2 restart /opt/flowdesk/ecosystem.config.cjs`. **It does
not happen at `pm2 restart flowdesk`**, with or without `--update-env`. That command reuses
the environment captured at the last start.

## Step 4 — rebuild, redeploy, restart, verify

The build must include `public/brand/`, because every email loads its logo from
`$APP_URL/brand/`. Because `.env` changed, restart **through the ecosystem file**. Never
use `pm2 restart all`, and never touch `upcarrera-api`. Build against the hosted project
exactly as in [Redeploying](#redeploying), never with a plain `bun run build` while
`.env.local` points at local Supabase. Then:

```bash
rsync -az --delete -e "ssh -i ~/.ssh/upcarrera_deploy" \
  .output/ root@168.144.188.190:/opt/flowdesk/.output/
ssh -i ~/.ssh/upcarrera_deploy root@168.144.188.190 \
  'chown -R root:root /opt/flowdesk/.output && pm2 restart /opt/flowdesk/ecosystem.config.cjs --only flowdesk && pm2 save && pm2 list'
```

`pm2 list` must still show `upcarrera-api` online with its previous uptime. Then:

```bash
curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' \
  https://flowdesk.upcarrera.com/brand/flowdesk-email-header.png   # 200 image/png
curl -fsS -o /dev/null -w '%{http_code}\n' https://admin.upcarrera.com/        # CRM: 200
curl -fsS -o /dev/null -w '%{http_code}\n' https://admissions.upcarrera.com/   # CRM: 200
```

About a minute after the restart, on the droplet:

```bash
grep '\[email\]' /var/log/flowdesk/out.log   | tail -n 5
# expect exactly one "[email] worker started (transport=graph as flowdesk@upcarrera.com
# (reply-to hello@upcarrera.com), app=https://flowdesk.upcarrera.com, …)" for this
# restart, then "[email] tick 1: …" about 30 s later
grep '\[email\]' /var/log/flowdesk/error.log | tail -n 5
# expect nothing new since the restart (check the timestamps)
```

What the lines mean:

- **`worker not started: EMAIL_WORKER_ENABLED is not "true"`** in `out.log` right after
  this restart means `.env` was not re-read. Restart through the ecosystem file, as above.
- **`worker not started: <setting> …`** in `error.log` names the missing or wrong
  setting. Fix it in `.env`, then restart through the ecosystem file.
- **`tick N failed: … unauthorized`** means the Step 2 hash does not match the secret in
  `.env`.
- **`403` / `ErrorAccessDenied`** means `MAIL_FROM_ADDRESS` is not in upCarrera Mailer
  Scope yet, or Microsoft has not yet picked up the change.
- **An `AADSTS7000215` / `AADSTS7000222` token error** means the client secret is wrong
  (often the secret's ID instead of its Value) or has expired.
- **`<n> x defer: paused 900s, check the Graph credentials and sender: …`** is how the two
  problems above show up in a tick: sending stops and the queue waits 15 minutes. No
  retries are used up. Rows still expire as usual (48 hours for task and project emails,
  the end of the send window for digests), so fix it the same day.
- **`<n> x defer: paused <s>s, Graph is throttling or unavailable: …`** means Microsoft
  answered 429 or 5xx. The worker waits as long as Graph asks (at most an hour), then
  carries on. No retries are used up.
- **`<n> x failed: Graph sendMail 400 …`** means Graph refused that one message, usually its
  recipient address. It is not retried.

The worker sends at most 20 emails per tick, 2.5 s apart, so a busy morning drains over
several ticks. That keeps it well under Exchange Online's 30 messages a minute for the
mailbox. Any other failed send is retried with backoff, up to 5 attempts. To see what is
queued, in the SQL editor:

```sql
select status, count(*) from public.email_outbox group by status;
select kind, attempts, last_error from public.email_outbox
 where last_error is not null order by created_at desc limit 10;
```

Once everything checks out, remove the Step 2 backup: `rm /opt/flowdesk/.env.bak.*`.

Scheduled email goes out from each organization's send hour (default 08:00 local) for three
hours, on its working days. Admins change this under Settings → Notifications.

## Turning email off

Set `EMAIL_WORKER_ENABLED=false` in `/opt/flowdesk/.env`, then run
`pm2 restart /opt/flowdesk/ecosystem.config.cjs --only flowdesk && pm2 save`. **Change the
value. Do not just delete the line.** PM2 merges the new environment into the old one on
restart, so a deleted key keeps its previous value. The triggers keep queuing. Unsent
event rows expire on their own after 48 hours (7 days for account access), and scheduled
ones at the end of their send window.

## Step 5 — the password-reset template (Lovable Cloud)

Paste `deploy/email/supabase-reset-password.html` into **Lovable Cloud → Emails → Reset
password**, with the subject `Your Flowdesk password reset code`. `deploy/email/README.md`
has the details. Do this after Step 4, so the logo URL already resolves.

---

# Adding people and organizations from the browser

Naji reported that **Settings → Users → Add User** and **Settings → Organizations → Add
Organization** did nothing. A login cannot be created with the browser key, and the hosted
project has no service-role key: SQL pasted into its editor is the only way in. So both
now run inside the database, in functions that check the caller is an admin before doing
anything. Migration: `supabase/migrations/20260927000000_admin_onboarding.sql`.

- **Add User** (admins only) creates the login with a random password nobody knows, gives
  it its first organization, department, team, manager and role, and adds any further
  organizations you picked. The welcome email carries a **one-time link**,
  `https://flowdesk.upcarrera.com/welcome#token=…`. There the person chooses a password
  and is signed straight in. The secret is after the `#`: browsers never send that part to
  a server, so it is not in the nginx access log or in any Referer, and the page removes it
  from the address bar as soon as it opens.
- **Resend welcome email** (a button on the person's page in Settings → Users) sends a
  fresh link. Every earlier link stops working at once.
- **Add Organization** (admins only) creates the organization with the default roles and
  settings, and makes you its admin. It is not made your primary organization.

Rules, so nobody is surprised by them:

- **A welcome link works once and expires after 7 days.** The database keeps only its
  SHA-256, and the link leaves the email queue as soon as the email is sent. An expired,
  used or superseded link shows "This link has expired or was already used", with **Reset
  your password** and **Go to sign in**.
- **Resend works only until the person first signs in.** After that the button answers
  "They have already signed in — they can use Forgot password". It also refuses an
  inactive account.
- **A link that went to the wrong person can be taken back.** Deactivate the account
  (Settings → Users → the person → Deactivate), or remove their last organization. Every
  unused link of theirs stops working at once, and a welcome email still waiting to go out
  is withdrawn. Reactivating does not bring an old link back; use **Resend welcome email**
  for a new one. The link page also refuses anyone who is inactive or has no active
  organization.
- **Deactivate really switches a person off.** Their access to every organization is
  switched off and they are signed out. If they sign in again (for example through Forgot
  password, which still works), they see only "Your Flowdesk account is deactivated" and a
  Sign out button, never the workspace, and the database gives them nothing: not even the
  tasks they created or were assigned, their comments or their files. **Activate** gives
  back exactly the organizations they had. Giving a deactivated person another
  organization, or saving their details, keeps that access switched off too until
  Activate. Nobody can deactivate or reactivate their own account, admins included.
  Someone who signs in but is in no organization sees "You haven't been added to an
  organization yet" instead.
- **Every organization always keeps at least one active admin**: someone with the Admin
  permission, an active membership there and an active account. The database refuses
  anything that would leave an organization with none, and the screen shows its reason,
  for example "There must always be at least one active admin in upCarrera. Make someone
  else admin first." That covers deactivating that person, giving them a role without
  admin rights, moving a custom admin role off "All Organizations", and removing or
  switching off their access to the organization. The fix is always the same: make someone
  else Admin there first, then try again. People are counted by the permission they
  actually hold, not by the role name shown, so a sole admin whose role reads "Employee"
  (see Step 5) still counts. **In the SQL editor**, removing a person's permission
  (`user_roles`) is refused the same way while their membership is active: delete their
  `organization_memberships` row first (the SQL editor may do that; the browser may not),
  or delete the whole login in Lovable Cloud → Users. Deleting the last admin's login is
  allowed, and leaves that organization with no admin until you make someone else Admin.
- **Add User needs a department in that organization** (create one under Teams &
  Departments first). New people can only be given organizations **you** administer.
- **Organization codes are 2 to 8 letters or digits**, stored in capitals. Names and codes
  must be unique, ignoring case. The time zone must be a real one from the list;
  `posix/…`, `right/…` and `Factory` copies are refused, because the app and the email
  engine would silently treat them as UTC.
- **Abuse limits**, for each admin and for all admins together:
  - new people: 30 an hour per admin; 60 an hour and 150 a day in all;
  - resent welcome emails: 5 a day per person; 60 an hour in all;
  - new organizations: 10 a day per admin; 20 a day in all.

  Past a limit, the screen says so and nothing is created. Only an admin whose own account
  is active can use Add User, Resend welcome email or Add Organization. The "in all"
  limits are shared, so one hostile admin can use them up and block everyone else until
  the hour or day has passed, which we accept because it also caps what one compromised
  admin can do.
- **Passwords chosen on /welcome must be 8 to 72 characters.** The database writes the
  password itself, so Lovable Cloud's own password rules (for example leaked-password
  protection, if it is ever switched on) are not applied to this first password.

## Step 1 — apply the migration (SQL editor)

This needs the email migration applied first (`build-email-upgrade.sh`, above). If it is
missing, the bundle stops with a clear error before changing anything.

```bash
bash deploy/supabase/build-onboarding-upgrade.sh > onboarding-upgrade.sql   # locally
```

Paste `onboarding-upgrade.sql` into the Lovable Cloud SQL editor and run it once. It runs
as a single transaction and is safe to re-run. **Apply it before deploying the new
build.** Without it, Add User and Add Organization answer "That didn't go through. Check
your connection and try again.", because the functions they call do not exist yet.

**The result grid is not empty: read it and keep a copy.** The script ends by repairing
people's permissions, switching off the access of anyone deactivated before this release,
and listing every change it made (Step 5 explains what the rows mean). Copy the grid into
the release notes, or take a screenshot, before you close the editor. It is shown once;
running the script again lists only what is still left to do.

## Step 2 — confirm it took

```sql
select proname from pg_proc
 where proname in ('admin_create_user', 'admin_resend_welcome',
                   'complete_account_setup', 'admin_create_organization');
-- expect 4 rows
```

## Step 3 — rebuild and redeploy

The new screens, the `/welcome` page and the new welcome-email link all ship in the build.
No `.env` change is needed. Build against the hosted project exactly as in
[Redeploying](#redeploying): never with a plain `bun run build` while `.env.local` points
at local Supabase. Then rsync and `pm2 restart flowdesk`, and check that `upcarrera-api` is
still online.

## Step 4 — verify

1. Sign in as an admin. Settings → Users → **Add User**, for a real colleague who needs an
   account: name, email, designation, organization, department, role. Expect the toast
   "Welcome email on its way to …", and the person listed straight away.
2. Within about five minutes the welcome email arrives. Its **Set your password** button
   opens `https://flowdesk.upcarrera.com/welcome#token=…`, and the address bar then shows
   just `/welcome`. Choosing a password there signs them in to the dashboard.
3. In the SQL editor, the email is recorded as sent and no link is left behind:

   ```sql
   select status, payload ? 'setupToken' as still_has_link, created_at
     from public.email_outbox where kind = 'account_access'
    order by created_at desc limit 5;
   -- the new row: sent / false
   ```

## Step 5 — the automatic repair of existing roles (read its result)

Before this release, every role change made in the browser saved the role's **name** but
failed to save the **permission** it grants (the write did not match the table's unique
key). So someone shown as "Employee" could still hold admin rights, and people added
through Add Existing User could have no permission at all. Opening the person and saving
their role again did not fix it either: the page skipped the permission write whenever the
name looked unchanged.

The migration repairs this itself, in the same transaction. Each person's permission in an
organization is made exactly what their role there stands for: a wrong permission is
changed, an extra one removed, a missing one added. The role name is what an admin chose,
so it wins. A membership with no role recorded is never touched. From then on the database
keeps the two in step on every role change, and Edit User always writes the permission on
save. The one exception is a membership that points at another organization's role, which
the repair also leaves alone: the Users page shows it as the role matching the permission
the person really holds, and a save that keeps that role leaves the permission as it is. Changing a custom role's access level (Settings → Roles & Permissions) changes the
permission of everyone who holds that role, at once.

The grid the script ends with lists what the repair did, one row per person and
organization:

| Column | Meaning |
|---|---|
| `email`, `organization` | Who, and in which organization (its code). |
| `role_shown` | The role FlowDesk shows for them there. "(inactive membership)" means that access is switched off. |
| `permission_before` | What row-level security enforced before. `(none)`: they had no permission there. |
| `permission_after` | What it enforces now. |
| `what_happened` | `changed to match the role shown`, `extra permission removed`, `added: they had no permission in this organization`, `NOT changed: …` (below), and for accounts deactivated before this release `access switched off: …` or `NOT switched off: …` (below). |

- **One row reading `(nobody)` / "Nothing to repair"**: every permission already matched,
  and no deactivated account still had access. Nothing changed.
- **`access switched off: their account was deactivated before this release`**
  (`role_shown` ends in "(account deactivated)"): before this release Deactivate did not
  switch off the person's organizations, so they kept access. Now it does. **Activate**
  on their page gives it back if that was a mistake.
- **`NOT switched off: they are the only admin … has left`**: that deactivated person still
  holds the only admin permission of that organization, so their access there was left
  on. Make someone else Admin there, then run the bundle again.
- **`admin` → something else**: that person has lost admin rights they should not have
  had. Tell the organization's admins, in case someone relied on them.
- **`NOT changed: that would leave … with no active admin`**: the repair never removes the
  last working admin of an organization. Make the right person Admin there (Settings →
  Roles & Permissions, or Edit User), then run the bundle again. It changes nothing else
  the second time and lists only the rows still left. Until then, saving that person with
  the non-admin role they are shown is refused, with a message saying why, so nobody can
  lock the organization out by accident.

To check again later (read-only; expect 0 rows, or only rows the repair reported as NOT
changed):

```sql
select u.email, o.code as organization, r.name as role_shown, r.base_role as should_be,
       coalesce(string_agg(ur.role::text, ', ' order by ur.role), '(none)') as actually_is
  from public.organization_memberships m
  join auth.users u on u.id = m.user_id
  join public.organizations o on o.id = m.organization_id
  join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
  left join public.user_roles ur on ur.user_id = m.user_id and ur.organization_id = m.organization_id
 group by u.email, o.code, r.name, r.base_role
having array_agg(ur.role order by ur.role) filter (where ur.role is not null)
       is distinct from array[r.base_role]
 order by 1, 2;
```

## Notes

- **The welcome link is a secret until it is used**, and it stays out of every log: the
  secret travels after the `#`, which browsers never send to a server, and the page drops
  it from the address bar before loading anything else. No nginx change is needed.
- **Task & Project Settings now shows one organization at a time.** Each organization has
  its own statuses, categories and tags, and someone in several organizations used to see
  them all merged (every tag twice, for instance). The page edits the organization picked
  in its **Organization** menu, which is the same choice as the organization switcher in
  the header. New Task offers the tags of the organization the task will belong to: its
  project's, or the creator's primary organization.
- **Fallback:** the SQL route in "Onboarding a new colleague" (Email notifications, above)
  still works with this migration applied.
