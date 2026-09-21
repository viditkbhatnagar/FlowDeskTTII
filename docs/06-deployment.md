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
