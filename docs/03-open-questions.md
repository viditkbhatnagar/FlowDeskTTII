# 03 — Open Questions & Blockers

Sorted by what they block. **None of these prevent local development from starting.**
They block *deployment*, and one blocks the auth design.

---

## BLOCKER 1 — DNS (blocks going live)

**Status:** unresolved. `flowdesk.upcarrera.com` does not resolve.

`upcarrera.com` uses Site5 nameservers (`dns.site5.com`, `dns2.site5.com`), not
DigitalOcean. **No DigitalOcean API token can create this subdomain.** Someone with the
Site5 (or GoDaddy) control panel must add the record.

Naji has not yet named that person. Public WHOIS lists the zone contact as
`777rafeeq@gmail.com`.

### The ask — Option B (recommended)

> Please add one DNS A record:
> **Host:** `flowdesk`  **Type:** `A`  **Value:** `168.144.188.190`  **TTL:** default
>
> This is the same thing that was done for `admin.upcarrera.com` and
> `admissions.upcarrera.com`, which point at the same server.

One record, five minutes, no effect on anything else.

### Option C — only if several more subdomains are expected

Delegate **only** `flowdesk.upcarrera.com` to DigitalOcean by adding NS records for that
subdomain. The parent zone and every existing record (admin, admissions, website, email)
stay at Site5, untouched. After that, any host under `flowdesk.upcarrera.com` can be
managed from DigitalOcean directly, with no further requests.

Naji asked for "more understanding" of this. **For a single subdomain, Option B is simpler
and is the honest recommendation.** Option C only pays off across several future apps.

### Until DNS exists

You can still build, test and fully prepare the release. You can even deploy to the server
and test over the raw IP or a local `hosts` entry. You **cannot** obtain a TLS certificate
— Let's Encrypt validates over public DNS — so do not attempt `certbot` before the record
is live and propagated.

---

## BLOCKER 2 — DigitalOcean API token (blocks provisioning)

**Status:** `doctl account get` → `401 Unable to authenticate`.

Naji said "you have already access to upCarrera Digitalocean account". That most likely
means **web console** access, not an API token.

### Try this first — it may be self-service

1. Log in at `cloud.digitalocean.com` with the upCarrera account
2. **API → Tokens → Generate New Token**
3. Scope: **Read and Write**; expiry: no expiry, or 1 year
4. `doctl auth init` and paste it
5. Verify: `doctl account get`

If console login fails, ask Naji for it.

**Note:** a token is only needed for *provisioning* (managed databases, firewalls,
resizing). Deploying over SSH needs no token. If the database ends up on the droplet
itself, this may never become blocking.

---

## BLOCKER 3 — SSH key authorisation (blocks deployment)

**Status:** unverified. Key exists locally; unknown whether the server still accepts it.

```
~/.ssh/upcarrera_deploy
SHA256:2AxloTru87s05bJBHWwQhJWpCLbHOA72xsjvkR03yYY
```

Verify with a harmless read-only command — **ask the user before connecting to
production**, and never run anything that changes state:

```bash
ssh -i ~/.ssh/upcarrera_deploy -o BatchMode=yes -o ConnectTimeout=10 \
    root@168.144.188.190 'whoami; free -m; df -h /; nproc'
```

That also answers the capacity question in `docs/02` — **capture the output**, because it
determines whether a database can safely live on this droplet.

If the key is rejected, ask for the public key to be added, or for the correct username.

---

## BLOCKER 4 — Authentication model (blocks the auth build)

**Status:** unanswered, and the most consequential open question.

Do users get **their own FlowDesk accounts**, or do they sign in with **their existing
upCarrera CRM credentials**?

- Separate accounts: simple, self-contained, another password for staff to manage
- CRM SSO: better experience, significantly more work, couples FlowDesk to the CRM

**Retrofitting SSO later is expensive.** Get this answered before building auth.

The Lovable prototype will already have made *some* choice — Phase 0 will reveal it. That
choice is a strong default, but confirm it is what the business actually wants.

---

## Non-blocking, still needed

| # | Question | Needed by |
|---|---|---|
| Q-A | Who is building email notifications — Naji or us? | Before the email phase |
| Q-B | Where should the git repo live? | Before first push |
| Q-C | Deadline | For sequencing |
| Q-D | Does anything replace an existing spreadsheet? If so, get a copy | Before UX decisions |
| Q-E | Confirm no student PII will be stored | Before choosing the backup policy |

---

## Suggested single message to Naji

> Morning — a few things to unblock FlowDesk:
>
> 1. **DNS:** who manages DNS at Site5? We need one A record: `flowdesk` →
>    `168.144.188.190`. Same as admin/admissions. Five-minute job, nothing else affected.
> 2. **DigitalOcean:** `doctl` says my token is unauthenticated. Do I have console login
>    so I can generate an API token myself, or can you send one?
> 3. **Login:** should staff get their own FlowDesk accounts, or sign in with their
>    existing upCarrera CRM login?
> 4. **Email notifications:** you mentioned you're building those — are you finishing that
>    in Lovable, or should I take it from here? Want to avoid doing it twice.
>
> Also — re: delegating DNS to DigitalOcean, for one subdomain it isn't worth it. One A
> record is simpler. Happy to explain on a call if useful.
