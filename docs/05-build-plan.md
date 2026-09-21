# 05 — Build Plan

> **Do not start here.** Complete `docs/04` (Phase 0 intake) first and get the database
> and auth decisions from the user. This plan assumes those are settled.

Each phase has a **goal**, **steps**, and a **done-when** you can actually verify. Do not
advance until done-when is genuinely met — and say so honestly if it is not.

---

## Phase 1 — Establish the working project

**Goal:** the prototype runs locally from a clean, sensibly structured repository.

1. Decide the layout based on the intake report:
   - Frontend-only prototype needing an API → monorepo: `apps/web` + `apps/api`
   - Self-contained full-stack app → keep its structure, tidy only what is necessary
2. Move the code out of `lovable-export/` into the real project structure.
   Keep `lovable-export/` untouched as a reference until Phase 7.
3. `git init`, add a `.gitignore` (node_modules, `.env`, `dist`, `*.zip`), initial commit.
4. Create `.env.example` with every variable documented — **no real values**.
5. Write a `README.md`: what it is, how to run it, how to configure it.

**Done when:** a fresh `pnpm install && pnpm dev` starts the app and you have loaded it in
a browser. Not "it should work" — you have seen it.

---

## Phase 2 — Data layer

**Goal:** the app reads and writes real, persistent data in the agreed database.

Depends entirely on the Phase 0 decision.

**If keeping Supabase:** document the project, get credentials into `.env`, confirm the
schema matches the feature list, confirm whose account owns it (**a personal account is a
business-continuity risk — raise it**).

**If moving to our own database:**
1. Postgres in Docker locally (mirror what will run on the droplet)
2. Define the schema explicitly — ORM (Prisma/Drizzle) or SQL migrations, but **versioned
   in git either way**
3. Port queries off the Supabase client
4. Write a seed script with realistic sample data
5. Keep it **completely separate from the CRM database** — its own instance, own
   credentials

**Done when:** you can create a task in the UI, restart the app and the server, and the
task is still there.

---

## Phase 3 — Authentication

**Goal:** only upCarrera staff can get in, with the model the business chose (`docs/03`).

1. Implement the agreed model — separate accounts or CRM SSO
2. Sessions/tokens handled securely: `httpOnly` cookies or properly stored JWTs;
   passwords hashed with bcrypt or argon2 (**never plaintext, never reversible**)
3. Protect every route and every API endpoint. **Enforce on the server** — hiding a button
   is not access control
4. Roles only if the requirements call for them (`docs/02` A3). Do not invent a permission
   system nobody asked for
5. An account-creation path suited to 30–40 known staff — admin-invite is usually right;
   **open public sign-up is wrong for an internal tool**

**Done when:** signed out, you cannot reach any page or API endpoint with data on it —
verified by hitting an endpoint directly with `curl`, not just by clicking around.

---

## Phase 4 — Email notifications (R5)

**Goal:** people are told when something needs their attention.

**First, confirm with Naji who is building this (`docs/03` Q-A).**

1. Choose the transport. **The CRM already has a working Microsoft 365 / Graph
   integration** (`~/codes/upcarrera-v2`) — prefer reusing it over adding a new provider
2. Confirm which triggers are wanted: assignment, due date, status change, daily digest?
   **Ask rather than guessing — nothing sours an internal tool faster than noise**
3. Templates: plain, clear, with a direct link to the task
4. Send asynchronously. **An email failure must never fail the user's action**
5. Log every send and every failure
6. Provide an off switch — per-user preference, or at minimum a global env flag

**Done when:** a real email arrives in a real inbox from a real trigger, and a forced
failure of the mail provider does not break task creation.

---

## Phase 5 — Quality pass

**Goal:** it behaves like a product, not a prototype.

- **Validation** on both client and server. Never trust the client
- **Error handling:** clear user-facing messages; detailed server-side logs; nothing
  swallowed silently
- **Loading and empty states** on every screen that fetches
- **Accessibility:** keyboard navigation, labelled inputs, sensible contrast, focus states
- **Responsive:** verify at 375, 768, 1440 (assumption A2)
- **Security:** no secrets in the bundle, parameterised queries, output escaped, rate
  limiting on login

**Done when:** you have clicked through every screen looking for breakage, and fixed what
you found.

---

## Phase 6 — Tests

**Goal:** enough confidence to deploy without holding your breath.

Proportionate to an internal tool for 40 people — **not** a 90%-coverage exercise:

1. Unit tests for real logic (permissions, date handling, status transitions)
2. Integration tests for API endpoints, especially **auth boundaries**
3. One end-to-end test of the core journey: log in → create task → assign → complete
4. All tests green before deploying

**Done when:** the suite passes from clean, and it fails when you deliberately break
something.

---

## Phase 7 — Release preparation

**Goal:** a verified production build, ready to ship the moment DNS lands.

1. Production build; confirm no dev URLs or secrets in the bundle
2. Write `deploy/` artefacts — model them on `~/codes/upcarrera-v2` (see `docs/06`)
3. Document every required environment variable
4. Write the backup plan **now**, not after the first data loss
5. Remove `lovable-export/` once nothing references it
6. Final read of `docs/03` — confirm each blocker is cleared

**Done when:** the build runs locally against production-mode config, and `docs/06` has
been followed as far as it can go without touching the server.

---

## Then: deployment

See **`docs/06-deployment.md`**. **Do not deploy without explicit approval in that
session** (`CLAUDE.md`, rule 4).
