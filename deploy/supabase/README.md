# Self-hosted Supabase for FlowDesk

Runbook for moving FlowDesk off the hosted Supabase project onto a DigitalOcean
droplet you own, keeping the database, authentication and row-level security
exactly as they are.

> **This goes on a NEW droplet.** Not `168.144.188.190`. That box runs the live
> upCarrera CRM and FlowDesk, has 3.2 GB free, and would fight this stack for
> memory and for ports 80/443. `bootstrap.sh` refuses to run on that IP.

## Why self-hosting works here at all

FlowDesk's browser bundle talks straight to Supabase — there is no backend API
of our own, and exactly one server function. So Supabase is supplying four
things: Postgres, authentication, the RLS policies, and the REST API itself.

Self-hosting the **same** open-source stack keeps all four identical, which is
why **no application code changes**. Only two values move: `VITE_SUPABASE_URL`
and `VITE_SUPABASE_PUBLISHABLE_KEY`.

Swapping to a plain managed Postgres instead would mean building an API and an
auth system from scratch and reimplementing every access rule — which is why
`docs/00-decisions.md` D2 rejected it.

## What you need first

| | |
|---|---|
| A DigitalOcean API token | `doctl` uses it to create the droplet. Read/write scope. |
| An SSH key on that DO account | Otherwise you cannot log in to the new droplet. |
| ~$24–48/month | `s-4vcpu-8gb` is comfortable. `s-2vcpu-4gb` is the floor. |
| An SMTP sender | Only for password recovery — see [Email](#email). |

## The four steps

### 1. Create the droplet

```bash
export DIGITALOCEAN_ACCESS_TOKEN=dop_v1_...
bash deploy/supabase/provision.sh s-4vcpu-8gb blr1
```

It prints the new IP and the hostname Supabase will answer on:
`supabase.<ip-with-dashes>.sslip.io`. `sslip.io` resolves any IP with no
registration, so Let's Encrypt can issue a real certificate immediately — no
waiting on Site5, exactly as D3 does for FlowDesk itself.

### 2. Generate secrets and bootstrap

```bash
node deploy/supabase/gen-secrets.mjs supabase.<ip-with-dashes>.sslip.io > supabase.env
chmod 600 supabase.env          # SECRET. Never commit this.

scp supabase.env deploy/supabase/bootstrap.sh root@<NEW_IP>:/root/
ssh root@<NEW_IP> 'bash /root/bootstrap.sh <NEW_IP>'
```

`gen-secrets.mjs` mints the Postgres password, the JWT secret, and the `anon` and
`service_role` API keys. Those keys are just HS256 JWTs signed with the JWT
secret — nothing issues them for you when self-hosting, so they are signed
locally with node's crypto.

`bootstrap.sh` installs Docker, checks out the Supabase stack **pinned to commit
`1e444589`**, merges the config, starts the 13 containers, then puts nginx and a
Let's Encrypt certificate in front and closes the firewall to 22/80/443. Studio
sits behind HTTP basic auth as well as its own login.

### 3. Apply the schema and import the data

```bash
# On the droplet:
cd /opt/supabase
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < /root/migrations/<each file in order>
psql ... -f /root/import.sql
```

Generate `import.sql` locally from an export of the old project:

```bash
node deploy/supabase/make-import-sql.mjs ./export "FlowDesk-Temp-2026" > import.sql
```

**What the import does, and why it is not a plain `INSERT` script:**

- **User UUIDs are preserved.** The 18 tasks and 5 projects reference their
  people by UUID (`assignee_id`, `owner_id`, `created_by`). Recreating accounts
  through the GoTrue admin API would mint new UUIDs and orphan every reference,
  so the script inserts `auth.users` rows with the original ids, plus the
  matching `auth.identities` rows GoTrue needs for email sign-in to work.
- **Passwords cannot be exported**, so every account gets the same temporary
  password, bcrypt-hashed by Postgres' own `pgcrypto` so GoTrue accepts it.
  **Everyone must change it on first sign-in.**
- **The organization id is remapped.** Migration `20260920090828` seeds
  `upCarrera` with `gen_random_uuid()`, so a fresh install invents a *different*
  id from the one the exported rows point at. The script finds the seeded row by
  its `code` and re-points it — rewriting `organization_id` across every table
  that has one — before importing. Without this, every project and task would
  reference an organization that does not exist.
- Triggers and FK checks are off for the load (`session_replication_role =
  replica`), otherwise the `work_tasks` activity trigger would fabricate a
  second set of `work_activity` rows on top of the 35 real ones.

Everything is `ON CONFLICT DO NOTHING`, so re-running is safe.

### 4. Repoint FlowDesk and redeploy

`VITE_*` values are **baked into the client bundle at build time**, so this is a
rebuild, not a restart.

```bash
# locally, in .env
VITE_SUPABASE_URL=https://supabase.<ip-with-dashes>.sslip.io
VITE_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY from supabase.env>
SUPABASE_URL=https://supabase.<ip-with-dashes>.sslip.io
SUPABASE_PUBLISHABLE_KEY=<same ANON_KEY>

bun run build
rsync -az --delete -e "ssh -i ~/.ssh/upcarrera_deploy" \
  .output/ root@168.144.188.190:/opt/flowdesk/.output/
# update /opt/flowdesk/.env with the same values, then:
ssh root@168.144.188.190 'chown -R root:root /opt/flowdesk/.output && pm2 restart flowdesk'
```

**`pm2 restart flowdesk` — never `pm2 restart all`.** That would bounce the CRM.

## Email

Password recovery (`src/routes/auth.tsx`) asks Supabase to send a 6-digit code.
Self-hosted GoTrue needs SMTP for that; until it is set, codes are generated and
never delivered — the same blocker `docs/03` already tracks.

**DigitalOcean does not offer an email sending service**, and blocks outbound
SMTP on droplets, so it cannot come from there.

You already own the right answer: the CRM sends transactional mail through
**Microsoft Graph** as `hello@upcarrera.com`
(`~/codes/upcarrera-v2/apps/api/src/integrations/email.service.ts`), and
`upcarrera.com`'s MX and SPF already point at Outlook. Two ways to use it:

1. **Microsoft 365 SMTP** — set `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`
   and a mailbox credential in `supabase.env`. Simplest, but many tenants have
   basic SMTP auth disabled, so check first.
2. **Graph via a relay** — keep app-only OAuth2 (no password anywhere) by
   pointing GoTrue at a small SMTP-to-Graph relay, reusing the existing
   "upCarrera Mailer" Entra app and its `Mail.Send` permission.

Option 1 if it is enabled; option 2 is the more robust long-term answer.

## Operating it

You now own upgrades, backups and uptime. The minimum:

```bash
# nightly backup, on the Supabase droplet
docker compose exec -T db pg_dump -U postgres postgres | gzip \
  > /opt/supabase/backups/flowdesk-$(date +%F).sql.gz
```

Retain ~30 days, and **restore one into a scratch database to prove it works**
before relying on it. This replaces D2's condition 2 — the data now lives in
upCarrera infrastructure by default, but only if the backups are real.

`docker compose pull && docker compose up -d` in `/opt/supabase` takes upgrades;
read Supabase's release notes first, and snapshot the droplet before a major one.

## Rollback

The hosted project is untouched by any of this. To go back, restore the old
`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`, rebuild, redeploy. Keep
the old project alive until the self-hosted one has been through a full week.

## What was verified before any of this shipped

All 14 migrations plus `import.sql` were replayed against Postgres 16 in Docker
against a GoTrue-shaped `auth` schema:

- 14 migrations apply cleanly to a fresh database, and are idempotent.
- RLS holds: an org A admin sees only org A and is refused an insert into org B;
  an employee is refused a department insert; anonymous is denied outright.
- The import lands 3 users, 3 identities, 2 organizations, 5 projects, 18 tasks,
  35 activity rows and 10 seeded roles with **zero orphaned foreign keys** across
  ten separate integrity checks.
- The assignee split is preserved exactly (11 / 4 / 3).
- The generated password hashes are real bcrypt (`$2a$`, 60 chars), verify the
  right password and reject the wrong one.
- The generated `anon` and `service_role` JWTs carry the correct `role` claim and
  their HS256 signatures validate against the generated secret.

## Files

| | |
|---|---|
| `provision.sh` | Creates the droplet with `doctl`. Refuses to reuse an existing name. |
| `gen-secrets.mjs` | Mints every secret, including correctly signed API keys. |
| `bootstrap.sh` | Installs Docker + the pinned stack + nginx + TLS + firewall. |
| `make-import-sql.mjs` | Turns a JSON export into `import.sql`, with the user and organization remapping. |
| `nginx/supabase.conf` | Reference vhost; `bootstrap.sh` writes its own copy. |
