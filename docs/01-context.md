# 01 — Context

## The product

**FlowDesk** — an internal task tracker for upCarrera Education.

- **Users:** ~30–40 people, **internal staff only**. Not student-facing, not public.
- **Purpose:** internal task management (assign work, track status, chase items).
- **Domain:** `flowdesk.upcarrera.com`
- **Scale:** small. This is an internal tool, not a product with growth requirements.
  Do not over-engineer for scale that will never arrive.

## People

| Who | Role |
|---|---|
| **Vidit Bhatnagar** | Owner of this repo. Builds, deploys and maintains FlowDesk. |
| **Naji** | Built the original prototype in Lovable. Also stated he is "currently building" email notifications — **confirm scope with him to avoid duplicated work.** |
| **Manager** | Requested the tool. Approved using the existing DigitalOcean space. |
| **Site5 DNS administrator** | Unidentified. Holds the DNS zone. **Required to unblock the domain.** Zone contact per public WHOIS: `777rafeeq@gmail.com`. |

## How this project arrived

The manager asked for "a simple task tracker". A requirements and access document was sent
(`~/Desktop/task-tracker-requirements.docx`). Naji replied over WhatsApp confirming:

- The Lovable build is **complete**, and "all info related to the task manager [is]
  available in lovable code now" — **the Lovable code is the specification**
- Use the existing upCarrera DigitalOcean space
- Domain: `flowdesk.upcarrera.com`
- Database: "we can go with free option, and change or upgrade later"
- ~30–40 internal users
- Email notifications **are** required
- On delegating DNS to DigitalOcean: "need more understanding about this from u" —
  **not approved, still open**

## Verified infrastructure facts

Everything below was checked directly, not assumed. Re-verify anything that looks stale.

### The droplet

| Item | Value |
|---|---|
| IP | `168.144.188.190` |
| Provider | DigitalOcean (confirmed via WHOIS) |
| OS / web server | Ubuntu, nginx `1.24.0` |
| SSH | Port 22 open and reachable |
| Existing workload | upCarrera CRM — **live and business-critical** |
| CRM architecture | nginx serves a static SPA; NestJS API under PM2 on `127.0.0.1:3000` |
| CRM hostnames | `admin.upcarrera.com`, `admissions.upcarrera.com` (both HTTPS, Let's Encrypt) |

> The CRM API reported ~89 days uptime when last checked, i.e. it has been running
> untouched for months. **Treat that stability as something to protect.**

### DNS — the blocker

| Item | Value |
|---|---|
| Registrar | GoDaddy |
| Nameservers | `dns.site5.com`, `dns2.site5.com` |
| Managed at DigitalOcean? | **No** |
| `flowdesk.upcarrera.com` | **Does not resolve** |
| `admin.upcarrera.com` | Resolves → `168.144.188.190` |

**Consequence:** no DigitalOcean API token can create this subdomain. The DNS zone is
administered at Site5, by a third party. A record must be added there. See `docs/03`.

### Access held locally

| Item | Status |
|---|---|
| SSH key | `~/.ssh/upcarrera_deploy` — present, `0600`, fingerprint `SHA256:2AxloTru87s05bJBHWwQhJWpCLbHOA72xsjvkR03yYY` |
| Key still authorised on server? | **Unverified** |
| `doctl` (DigitalOcean CLI) | Installed at `/opt/homebrew/bin/doctl` |
| `doctl` authentication | **Fails — `401 Unable to authenticate`.** No API token stored. |

> Naji stated "you have already access to upCarrera Digitalocean account". This most
> likely means **web console** access rather than an API token. If console access works,
> an API token can be generated self-service — see `docs/03`.

### Local toolchain

Node `v24.10.0` · pnpm `9.15.4` · git `2.46.2` · Docker available · MySQL client available

## Related system — read it

The existing CRM is at **`~/codes/upcarrera-v2`**. It deploys to this same droplet and is a
working reference for the whole deployment path. Of particular value:

- **`DEPLOY.md`** — the complete DigitalOcean runbook, already proven on this server
- **`deploy/deploy.sh`**, **`deploy/nginx/upcarrera.conf`**, **`ecosystem.config.js`**
- It also has a **Microsoft 365 (Graph) email integration** already working — likely
  reusable for FlowDesk's email notifications rather than adding a new provider.

FlowDesk is a **separate application**. Reuse the *patterns*, not the codebase, and keep
the two systems isolated at runtime (separate process, separate database, separate nginx
server block).
