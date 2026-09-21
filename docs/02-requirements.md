# 02 — Requirements

Three tiers: **confirmed**, **assumed** (proceed, but flag), **unknown** (must ask).

> **The Lovable prototype is the primary specification.** Naji: "all info related to the
> task manager [is] available in lovable code now." Where this document and the Lovable
> code disagree about *product* behaviour, the code wins — but record the discrepancy.
> Where they disagree about *infrastructure*, this document wins (Lovable knows nothing
> about our servers).

## Confirmed

| # | Requirement | Source |
|---|---|---|
| R1 | Internal task tracker for upCarrera staff | Manager |
| R2 | ~30–40 users, **internal only** — not student- or public-facing | Naji |
| R3 | Served at `flowdesk.upcarrera.com` | Naji |
| R4 | Hosted on the existing upCarrera DigitalOcean droplet | Naji |
| R5 | **Email notifications are required** | Naji |
| R6 | Database: start with the **free/zero-cost option**, upgrade later if needed | Naji |
| R7 | Functional scope is whatever the Lovable prototype implements | Naji |

## Assumed — proceed, but state the assumption

| # | Assumption | Why | Risk if wrong |
|---|---|---|---|
| A1 | No student PII or confidential data in tasks | "completely internal use case" | Would raise backup/encryption/access-control requirements |
| A2 | Desktop-first, but must be usable on a phone | Normal for internal tools | Rework of layout |
| A3 | All staff may see all tasks; a lightweight admin role may exist | Typical at this size | Permissions model rework |
| A4 | English-only interface | Existing CRM is English | Localisation work |
| A5 | No integration with the existing CRM database | Isolation is the safer default | If they want CRM data, that is a new project phase |

## Unknown — blocking the build, must be answered

| # | Question | Why it matters | Ask |
|---|---|---|---|
| Q1 | **How do users log in?** Own accounts, or the existing CRM login (SSO)? | Shapes the entire auth layer. Retrofitting SSO later is expensive. | Naji / manager |
| Q2 | **What does the Lovable app use for its database and auth?** | If Supabase, R6 "free option" may mean *Supabase free tier*, not our droplet — a very different plan | **Answered by Phase 0 audit** |
| Q3 | **Who is building email notifications?** Naji said he is "currently building that" | Risk of duplicated or conflicting work | Naji |
| Q4 | Deadline | Sequencing and scope | Manager |
| Q5 | Where should the git repository live? | Cannot push code anywhere yet | Manager |

## The database question — do not resolve this alone

R6 says "free option". That is ambiguous and the answer changes the architecture:

| Reading | Meaning | Implication |
|---|---|---|
| **(a)** Free tier of a hosted service | e.g. Supabase free tier, which Lovable apps commonly use | Almost no migration work; data lives outside our infrastructure; free tier has limits and can be paused |
| **(b)** No additional cost to us | Postgres/MySQL installed on the droplet we already pay for | Full control, data stays in-house; we own backups; migration work if the prototype uses Supabase |

**Phase 0 must determine what the prototype actually uses.** Then present both options
with real numbers and let the user decide. Do not silently pick one.

Note for reading (b): the CRM's own deployment notes describe the droplet's 4 GB as
*adequate* for its build process. Adding a database plus a second app may reduce that
headroom — **measure free memory and disk on the droplet before committing to it.**

## Explicit non-goals

Unless someone asks for them later, do **not** build:

- A mobile app
- Student- or customer-facing views
- Integration with the CRM database
- Multi-tenancy, billing, or public sign-up
- Real-time collaborative editing

At 30–40 internal users, simplicity is the correct engineering choice.
