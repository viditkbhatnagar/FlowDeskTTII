# 04 — Phase 0: Lovable Code Intake

> **This is the first thing you do. It is read-only investigation.**
> Do not modify, refactor or rewrite anything during this phase. The deliverable is a
> written report and a recommendation — not code.

## Why this phase exists

The Lovable prototype is the specification, and **its stack is unknown until inspected**.
Lovable apps are commonly React + Vite + TypeScript + Tailwind + shadcn/ui, frequently
with **Supabase** for database and auth — but that is a pattern, not a guarantee.

This matters because it decides the database question (`docs/02`), the auth question
(`docs/03`), and how much of the prototype survives. **Guessing here wastes days.**

## Step 1 — Locate and extract

The ZIP should be somewhere in this folder. Find it without assuming a filename:

```bash
cd ~/codes/flowdesk
find . -maxdepth 2 -iname "*.zip" -not -path "./node_modules/*"
```

Extract into a dedicated directory so the original archive stays pristine:

```bash
mkdir -p lovable-export
unzip -q "<the-zip>" -d lovable-export
find lovable-export -maxdepth 2 -type d -not -path "*/node_modules*" | head -40
```

Lovable ZIPs often contain a single top-level folder. If so, note the real project root —
every path below is relative to it.

**If no ZIP is present:** stop and tell the user. Do not begin building a replacement.

## Step 2 — Identify the stack

Read, do not assume:

```bash
cd lovable-export/<project-root>
cat package.json                      # framework, scripts, dependencies
ls                                    # config files at root
cat *.config.* 2>/dev/null | head -60 # vite/next/tailwind config
ls src 2>/dev/null || ls app 2>/dev/null
```

Answer explicitly:

- Build tool — Vite? Next.js? Something else?
- Language — TypeScript or JavaScript?
- UI — Tailwind? shadcn/ui? A component library?
- Router — React Router? TanStack Router? Next app router?
- **Backend — is there one at all, or is it frontend-only?**

## Step 3 — Find the data layer (the decisive question)

```bash
grep -rl "supabase" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" . | head -20
grep -rn "createClient\|DATABASE_URL\|prisma\|drizzle\|mongoose\|firebase" \
  --include="*.ts" --include="*.tsx" . | head -30
ls supabase/ 2>/dev/null && find supabase -type f | head -30
cat .env.example 2>/dev/null; ls -a | grep -i env
```

Determine:

1. **Which database/backend service** the prototype talks to
2. **Where the schema is defined** — Supabase migrations, SQL files, an ORM schema?
3. **Whether real credentials are committed** in the ZIP (Lovable often inlines a Supabase
   URL and anon key). **If you find live credentials, flag them — they must be rotated and
   must never be committed to our repository.**

### Decision tree

| What you find | What it means | Recommend |
|---|---|---|
| **Supabase** | Database *and* usually auth live in Supabase. "Free option" may have meant Supabase free tier. | Present both: keep Supabase (fast, external, free tier limits/pausing) vs migrate to Postgres on our droplet (in-house, we own backups, migration work). **User decides.** |
| **No backend — local/mock state only** | It is a UI prototype. Data layer must be built. | Build a small API + Postgres on the droplet. Reuse the CRM's NestJS patterns. |
| **Its own API + ORM** | Closest to a finished app. | Keep it; point it at our database. |
| **Firebase or other** | External dependency not previously discussed. | Flag to the user before proceeding. |

## Step 4 — Find the auth model

```bash
grep -rn "signIn\|signUp\|useAuth\|session\|jwt\|login" \
  --include="*.ts" --include="*.tsx" . | head -30
```

Does it use Supabase Auth? A custom login? No auth at all? This directly informs **Q1** in
`docs/02` — report what the prototype chose, then confirm it is what the business wants.

## Step 5 — Inventory the features

This is the real specification. Walk the routes/pages and list what exists:

```bash
find . -path ./node_modules -prune -o -type d \( -name pages -o -name routes -o -name app \) -print
find . -path ./node_modules -prune -o -name "*.tsx" -print | head -60
```

Produce a concrete feature list — every screen, and for tasks specifically: **which fields
exist, which statuses exist, whether comments/attachments/sub-tasks/priorities are
present**. Compare against `docs/02` and note anything surprising.

## Step 6 — Try to run it

```bash
pnpm install     # or npm install, matching any committed lockfile
pnpm dev         # check package.json for the real script name
```

Record: does it start? Does it render? What breaks without credentials? Screenshot or
describe the main screens. **Expect missing env vars — that is information, not failure.**

## Step 7 — Report back and stop

Write your findings to **`docs/07-intake-report.md`** using this structure, then **stop and
wait for the user**. Do not proceed to `docs/05` until the database and auth decisions
have been made.

```markdown
# 07 — Intake Report
_Date:_

## Stack
Framework / language / UI / router / backend

## Data layer
What it uses · where the schema lives · whether credentials were committed

## Auth
What the prototype does today

## Features found
Screens, task fields, statuses, extras

## Does it run?
Yes/no, what was needed, what broke

## Gaps vs requirements
What docs/02 wants that the prototype lacks (e.g. email notifications)

## Credentials/secrets found
**Anything live must be rotated. List it.**

## Recommendation
Keep / adapt / rebuild — and why.
Database options with honest trade-offs.
Estimated effort per option.

## Decisions needed from the user
1.
2.
```

## Rules for this phase

- **Read-only.** No edits to the extracted code.
- **No rewriting because you prefer a different style.** If it works, it stays.
- **Report facts, not impressions.** "Uses Supabase Auth with email/password, schema in
  `supabase/migrations/`" — not "auth looks fine".
- **Surface secrets immediately.** Do not commit them anywhere, not even once.
