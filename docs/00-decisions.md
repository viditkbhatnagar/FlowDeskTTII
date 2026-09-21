# 00 — Decisions (settled — do not re-litigate)

These were decided by the project owner on 21 September 2026 after the stack audit
(`docs/07`). **Treat them as given.** If you believe one is wrong, say so once, briefly,
and then follow it anyway unless the owner changes their mind.

---

## D1 — Hosting: the DigitalOcean droplet

FlowDesk is deployed to the existing upCarrera droplet at `168.144.188.190`, under PM2
behind nginx — **not** to Cloudflare.

**Consequence you must handle:** the app currently targets Cloudflare Workers
(`wrangler.jsonc`, `@cloudflare/vite-plugin`). **Nitro must be re-targeted to the
`node-server` preset.** See `docs/06`.

**Rejected:** Cloudflare Workers. Technically the smoother path, but the manager asked for
the DigitalOcean space to be used.

---

## D2 — Data and auth: keep Supabase

Database, authentication and the row-level-security policies stay on Supabase.

**Rationale:** replacing Supabase means rebuilding authentication and reimplementing every
org-scoped access rule in application code — days of work on the most
security-sensitive part of the system, for a dataset under 1 GB. The app works today.

**Two conditions, both required before staff use it:**

1. **A company-owned Supabase project.** Develop against the existing project (credentials
   in the bundled `.env`) for now, but a project owned by an upCarrera account must exist
   before go-live. Running a production tool from a personal account is the real risk here.
2. **A nightly `pg_dump` onto the droplet.** Keeps a copy of the data inside upCarrera
   infrastructure. Cheap, and it answers the "our data sits outside our control"
   objection without any rewrite.

**Rejected:** Postgres on the droplet, and DigitalOcean Managed Postgres. Both require the
same auth and RLS rewrite. Revisit only if a data-residency policy demands it.

---

## D3 — Launch: ship to a temporary URL first

`flowdesk.upcarrera.com` does not resolve and depends on a third party (`docs/03`).
**Do not let that block deployment.**

Deploy to a working temporary address so the owner and Naji can test end to end, then
switch to the real hostname once the DNS record exists.

**Recommended temporary hostname:** an `sslip.io` address, which resolves to any IP with
no registration and works with Let's Encrypt:

```
flowdesk.168-144-188-190.sslip.io   →   168.144.188.190
```

This gives a **real HTTPS certificate**, which a bare IP cannot. Cutting over to
`flowdesk.upcarrera.com` later is a one-line nginx change plus a new certificate.

---

## Still open — does not block the build

| # | Question | Ask |
|---|---|---|
| O1 | Who administers DNS at Site5? Need `flowdesk` A → `168.144.188.190` | Naji |
| O2 | Is Naji still building email/recovery-code delivery, or do we own it? | Naji |
| O3 | Which upCarrera account will own the Supabase project (D2 condition 1)? | Manager |
| O4 | Where should the git repository live? | Manager |
| O5 | Deadline | Manager |

A ready-to-send message covering these is at the end of `docs/03`.
