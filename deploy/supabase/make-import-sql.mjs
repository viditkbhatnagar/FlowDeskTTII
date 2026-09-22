#!/usr/bin/env node
/**
 * Turn a JSON export of the old Supabase project into one import.sql for the
 * new self-hosted instance.
 *
 *   node make-import-sql.mjs <export-dir> [temp-password] > import.sql
 *
 * Why SQL and not the REST API:
 *
 *  - The 18 tasks and 5 projects reference their users by UUID (assignee_id,
 *    owner_id, created_by). Recreating users through the GoTrue admin API would
 *    mint new UUIDs and orphan every one of those references. Inserting into
 *    auth.users with the ORIGINAL UUIDs keeps the data intact.
 *
 *  - Passwords cannot be exported, so each account gets the same temporary
 *    password, hashed here by Postgres' own pgcrypto (bcrypt) so it is a real
 *    GoTrue-compatible hash. Everyone must change it on first sign-in.
 *
 *  - session_replication_role = replica turns off triggers and FK checks for the
 *    load. Without it the work_tasks activity trigger would fabricate a second
 *    set of work_activity rows on top of the 35 real ones being imported.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const tempPassword = process.argv[3] || 'FlowDesk-Change-Me-2026';
if (!dir) {
  console.error('usage: make-import-sql.mjs <export-dir> [temp-password] > import.sql');
  process.exit(1);
}

const load = (name) => {
  const p = join(dir, `${name}.json`);
  if (!existsSync(p)) return [];
  const rows = JSON.parse(readFileSync(p, 'utf8'));
  return Array.isArray(rows) ? rows : [];
};

/** Postgres literal for any JS value coming out of PostgREST JSON. */
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    if (v.length === 0) return `'{}'`;
    // text[] columns (tags, permissions)
    return `ARRAY[${v.map((x) => lit(x)).join(',')}]::text[]`;
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

/**
 * Insert rows, skipping anything already present.
 *
 * `ON CONFLICT DO NOTHING` with no target on purpose: it covers every unique
 * constraint, not just the primary key. organizations, for example, is UNIQUE on
 * both name and code, and migration 20260920090828 already seeds a row named
 * 'upCarrera' — targeting only (id) raised a duplicate-name error.
 */
function insert(table, rows, { schema = 'public' } = {}) {
  if (!rows.length) return `-- ${schema}.${table}: nothing to import\n`;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    // PostgREST embeds related objects; those are not real columns.
    .filter((c) => !rows.some((r) => r[c] !== null && typeof r[c] === 'object' && !Array.isArray(r[c])));
  const values = rows
    .map((r) => `  (${cols.map((c) => lit(r[c] ?? null)).join(', ')})`)
    .join(',\n');
  return (
    `-- ${schema}.${table}: ${rows.length} row(s)\n` +
    `INSERT INTO ${schema}.${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES\n${values}\n` +
    `ON CONFLICT DO NOTHING;\n`
  );
}

// ---------------------------------------------------------------------------

const organizations = load('organizations');
const memberships = load('organization_memberships');
const profiles = load('profiles');
const userRoles = load('user_roles');
const projects = load('work_projects');
const tasks = load('work_tasks');
const milestones = load('project_milestones');
const recurrences = load('task_recurrences');
const activity = load('work_activity');

// Every user UUID referenced anywhere. auth.users must contain all of them or
// the foreign keys dangle.
const userIds = new Set();
for (const m of memberships) if (m.user_id) userIds.add(m.user_id);
for (const p of profiles) if (p.user_id) userIds.add(p.user_id);
for (const r of userRoles) if (r.user_id) userIds.add(r.user_id);
for (const p of projects) for (const k of ['owner_id', 'manager_id']) if (p[k]) userIds.add(p[k]);
for (const t of tasks) for (const k of ['assignee_id', 'reviewer_id', 'created_by']) if (t[k]) userIds.add(t[k]);
for (const a of activity) if (a.actor_id) userIds.add(a.actor_id);

// A readable email per user, from the profile username where we have one.
const emailFor = (id) => {
  const p = profiles.find((x) => x.user_id === id);
  const handle = p?.username || p?.full_name?.toLowerCase().replace(/[^a-z0-9]+/g, '.') || `user-${id.slice(0, 8)}`;
  return `${handle}@upcarrera.com`;
};

const out = [];
out.push(`-- FlowDesk data import — generated ${new Date().toISOString()}
--
-- Source: JSON export of the Lovable-era Supabase project.
-- Target: the self-hosted Supabase instance, AFTER the 14 migrations are applied.
--
-- Run once:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f import.sql
--
-- Every statement is ON CONFLICT DO NOTHING, so re-running changes nothing.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Load data as data: no triggers, no FK ordering games.
SET session_replication_role = replica;
`);

out.push(`\n-- === auth.users (${userIds.size}) ===
-- Original UUIDs preserved so every assignee_id / owner_id / created_by still
-- resolves. Password is the same temporary one for everyone; bcrypt-hashed by
-- pgcrypto so GoTrue accepts it. THESE MUST BE CHANGED ON FIRST SIGN-IN.`);
for (const id of userIds) {
  out.push(`INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) VALUES (
  ${lit(id)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  ${lit(emailFor(id))}, crypt(${lit(tempPassword)}, gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  ${lit({ username: profiles.find((p) => p.user_id === id)?.username ?? null })}
) ON CONFLICT (id) DO NOTHING;`);
}

// GoTrue needs an identity row per user or password sign-in fails.
out.push(`\n-- === auth.identities ===
-- GoTrue resolves an email login through identities; without these the users
-- exist but cannot sign in.`);
for (const id of userIds) {
  out.push(`INSERT INTO auth.identities (
  id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
) VALUES (
  gen_random_uuid(), ${lit(id)},
  ${lit({ sub: id, email: emailFor(id), email_verified: true, phone_verified: false })},
  'email', ${lit(id)}, NULL, now(), now()
) ON CONFLICT DO NOTHING;`);
}

// -------------------------------------------------------------------------
// Organization id remap.
//
// Migration 20260920090828 seeds 'upCarrera' and 'Teachers' Training Institute
// of India' with gen_random_uuid(), so a fresh install invents NEW ids for them.
// The exported projects, tasks, memberships and activity all reference the OLD
// project's organization id. Left alone, every one of those rows would point at
// an organization that does not exist here.
//
// So before importing, re-point the freshly seeded organization (matched on its
// natural key, `code`) at the exported id, rewriting organization_id across
// every table that has one. FK triggers are off, so ordering is not a problem.
// -------------------------------------------------------------------------
out.push(`\n-- === organization id remap ===`);
for (const org of organizations) {
  out.push(`DO $remap$
DECLARE
  old_id uuid;
  new_id uuid := ${lit(org.id)};
  r record;
BEGIN
  SELECT id INTO old_id FROM public.organizations
   WHERE code = ${lit(org.code)} AND id <> new_id;

  IF old_id IS NOT NULL THEN
    RAISE NOTICE 'Remapping organization % from % to %', ${lit(org.code)}, old_id, new_id;
    FOR r IN
      SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'organization_id'
    LOOP
      EXECUTE format('UPDATE public.%I SET organization_id = $1 WHERE organization_id = $2', r.table_name)
        USING new_id, old_id;
    END LOOP;
    UPDATE public.organizations SET id = new_id WHERE id = old_id;
  END IF;
END
$remap$;`);
}

out.push('\n-- === application data, in dependency order ===');
out.push(insert('organizations', organizations));
out.push(insert('profiles', profiles));
out.push(insert('organization_memberships', memberships));
out.push(insert('user_roles', userRoles));
out.push(insert('work_projects', projects));
out.push(insert('task_recurrences', recurrences));
out.push(insert('work_tasks', tasks));
out.push(insert('project_milestones', milestones));
out.push(insert('work_activity', activity));

out.push(`
-- Named roles came from the migration's seed; point each user_roles row at its
-- match, exactly as the migration does for an in-place upgrade.
UPDATE public.user_roles ur SET role_id = r.id
FROM public.roles r
WHERE r.organization_id = ur.organization_id AND r.base_role = ur.role
  AND r.is_system = true AND ur.role_id IS NULL;

UPDATE public.organization_memberships m SET role_id = ur.role_id
FROM public.user_roles ur
WHERE ur.user_id = m.user_id AND ur.organization_id = m.organization_id
  AND m.role_id IS NULL;

SET session_replication_role = origin;
COMMIT;

-- What landed.
SELECT 'auth.users' AS table, count(*)::text AS rows FROM auth.users
UNION ALL SELECT 'organizations', count(*)::text FROM public.organizations
UNION ALL SELECT 'profiles', count(*)::text FROM public.profiles
UNION ALL SELECT 'memberships', count(*)::text FROM public.organization_memberships
UNION ALL SELECT 'user_roles', count(*)::text FROM public.user_roles
UNION ALL SELECT 'work_projects', count(*)::text FROM public.work_projects
UNION ALL SELECT 'work_tasks', count(*)::text FROM public.work_tasks
UNION ALL SELECT 'work_activity', count(*)::text FROM public.work_activity
UNION ALL SELECT 'roles (seeded)', count(*)::text FROM public.roles
ORDER BY 1;
`);

console.log(out.join('\n'));
console.error(`\nGenerated import.sql
  users recreated : ${userIds.size}  (${[...userIds].map(emailFor).join(', ')})
  temp password   : ${tempPassword}
  app rows        : ${organizations.length + profiles.length + memberships.length + userRoles.length + projects.length + tasks.length + milestones.length + recurrences.length + activity.length}
`);
