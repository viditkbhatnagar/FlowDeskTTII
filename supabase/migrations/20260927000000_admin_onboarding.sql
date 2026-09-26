-- ============================================================================
-- FlowDesk — add people and organizations from the browser.
--
-- Settings → Users → "Add User" and Settings → Organizations → "Add
-- Organization" could not work: a login cannot be minted with the browser key,
-- and production has no service-role key (the hosted project is managed for us;
-- SQL is the only way in). So both happen here, in SECURITY DEFINER functions
-- that check the caller is an admin before doing anything:
--
--   admin_create_user          an admin of an organization adds a person to it.
--                              The login is created with a random password
--                              nobody knows; the welcome email carries a
--                              single-use link to choose one.
--   admin_resend_welcome       a fresh link, for someone who never signed in.
--   complete_account_setup     the link's page: sets the password (anon may call).
--   admin_create_organization  an admin of any organization creates another and
--                              becomes its admin.
--
-- The welcome email is the account_access row that the existing trigger on
-- organization_memberships queues for a person's first membership. The link's
-- token is kept on that row only while it waits to be sent: the worker RPCs
-- (re-created in section 7) drop it the moment the row is sent, suppressed,
-- failed or expired. The database stores only the token's sha256.
--
-- Abuse guards, per caller and across all admins together:
--   new people        30 per admin per hour; 60 per hour and 150 per day in all
--   resent welcomes   5 per person per day; 60 per hour in all
--   new organizations 10 per admin per day; 20 per day in all
-- Only an admin whose own account is active may use the admin functions.
--
-- Deactivate really switches a person off (section 8): their active
-- memberships become inactive (remembered, so Reactivate restores exactly
-- those), their sign-in sessions end, every unused link burns and a welcome
-- still waiting to go out is withdrawn. Row-level security only lets active
-- members in, so a deactivated person who signs in again (say through Forgot
-- password) sees nothing and can do nothing: a membership written active
-- while their account is inactive stays off until Reactivate, and restrictive
-- policies close the few rows people could reach without a membership (their
-- own tasks, comments, files and activity). Nobody can change their own
-- account status. Removing a person's last active organization burns their
-- links too, and the link page refuses anyone inactive or without one.
--
-- Every organization keeps at least one active admin (the admin permission,
-- an active membership there and an active account): Deactivate, a role
-- change, a removed permission, or a signed-in admin removing, switching off
-- or moving away the last admin's membership, that would leave it with none
-- is refused with a message saying so (sections 8 and 9).
--
-- Section 9 keeps each person's permission (user_roles) in step with the role
-- their membership shows, section 10 repairs the rows that fell out of step
-- before this release, and section 11 switches off the memberships of people
-- deactivated before it. The script ends with a read-only list of everything
-- those two changed: in the SQL editor, that is the result shown.
--
-- Needs 20260926000000_email_notifications.sql. Idempotent throughout.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Prerequisites. Fail loudly and early rather than half-way through.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
  IF to_regclass('public.email_outbox') IS NULL
     OR to_regprocedure('private.enqueue_account_access_email()') IS NULL
     OR to_regprocedure('public.email_worker_complete(text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20260926000000_email_notifications.sql before the admin onboarding migration';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Private bookkeeping. RLS on, no policies, no grants: only the functions
--    below (running as the owner) read or write these.
-- ---------------------------------------------------------------------------

-- One row per set-password link. kind 'create' rows count towards the admin's
-- hourly cap, kind 'resend' rows towards the person's daily one.
CREATE TABLE IF NOT EXISTS private.account_setup_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_sha256  BYTEA NOT NULL UNIQUE CHECK (octet_length(token_sha256) = 32),
  kind          TEXT NOT NULL DEFAULT 'create' CHECK (kind IN ('create', 'resend')),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_setup_tokens_user_idx ON private.account_setup_tokens (user_id);
CREATE INDEX IF NOT EXISTS account_setup_tokens_creator_idx
  ON private.account_setup_tokens (created_by, created_at);
-- The caps across all admins count every link of one kind in a time window.
CREATE INDEX IF NOT EXISTS account_setup_tokens_kind_created_idx
  ON private.account_setup_tokens (kind, created_at);
REVOKE ALL ON private.account_setup_tokens FROM PUBLIC, anon, authenticated;
ALTER TABLE private.account_setup_tokens ENABLE ROW LEVEL SECURITY;

-- Who created which organization, for the daily cap. Kept here rather than on
-- public.organizations, where the new org's admin could rewrite it.
CREATE TABLE IF NOT EXISTS private.organization_creations (
  organization_id  UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by       UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_creations_creator_idx
  ON private.organization_creations (created_by, created_at);
CREATE INDEX IF NOT EXISTS organization_creations_created_idx
  ON private.organization_creations (created_at);
REVOKE ALL ON private.organization_creations FROM PUBLIC, anon, authenticated;
ALTER TABLE private.organization_creations ENABLE ROW LEVEL SECURITY;

-- The memberships Deactivate switched off, so Reactivate switches exactly those
-- back on (not one an admin had switched off separately). Section 8.
CREATE TABLE IF NOT EXISTS private.suspended_memberships (
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  suspended_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);
REVOKE ALL ON private.suspended_memberships FROM PUBLIC, anon, authenticated;
ALTER TABLE private.suspended_memberships ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- A practical address check (the sender rejects anything stranger). Expects
-- the address already trimmed and lower-cased.
CREATE OR REPLACE FUNCTION private.onboarding_email_ok(_email TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _email IS NOT NULL
     AND char_length(_email) <= 254
     AND char_length(split_part(_email, '@', 1)) <= 64
     AND _email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
$$;
REVOKE ALL ON FUNCTION private.onboarding_email_ok(TEXT) FROM PUBLIC, anon, authenticated;

-- An optional id from p_details: NULL when absent or blank, else a UUID.
CREATE OR REPLACE FUNCTION private.onboarding_uuid(_details JSONB, _key TEXT, _label TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw TEXT := NULLIF(btrim(_details->>_key), '');
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  IF raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Choose a valid %', _label USING ERRCODE = '22023';
  END IF;
  RETURN raw::UUID;
END;
$$;
REVOKE ALL ON FUNCTION private.onboarding_uuid(JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Issues a set-password link valid for 7 days. Returns the raw token (64 hex
-- characters); only its sha256 is stored.
CREATE OR REPLACE FUNCTION private.issue_account_setup_token(_user_id UUID, _created_by UUID, _kind TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw TEXT := encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
  INSERT INTO private.account_setup_tokens (user_id, token_sha256, kind, expires_at, created_by)
  VALUES (_user_id, extensions.digest(raw, 'sha256'), _kind, now() + interval '7 days', _created_by);
  RETURN raw;
END;
$$;
REVOKE ALL ON FUNCTION private.issue_account_setup_token(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Every organization keeps at least one active admin: someone with the admin
-- permission there (user_roles 'admin'), an active membership there and an
-- active account (the same test as the repair in section 10). Anything that
-- would take away the last one raises this error, under this constraint name,
-- which the sync triggers of section 9 let through (and nothing else).
--
-- Removing an admin takes the organization's lock first, so two transactions
-- removing its last two admins take turns and the second sees the first.
CREATE OR REPLACE FUNCTION private.lock_organization_admins(_organization_id UUID)
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('organization_admins:' || _organization_id, 0))
$$;
REVOKE ALL ON FUNCTION private.lock_organization_admins(UUID) FROM PUBLIC, anon, authenticated;

-- VOLATILE on purpose: called from row triggers, it must see the rows the same
-- statement already changed (a STABLE function would not, so one statement
-- removing two admins would pass both checks) and what a transaction it waited
-- for committed.
CREATE OR REPLACE FUNCTION private.org_has_other_active_admin(_organization_id UUID, _except_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.organization_memberships m
        ON m.user_id = ur.user_id AND m.organization_id = ur.organization_id AND m.status = 'active'
      JOIN public.profiles p ON p.user_id = ur.user_id AND p.status = 'active'
     WHERE ur.organization_id = _organization_id
       AND ur.role = 'admin'
       AND ur.user_id IS DISTINCT FROM _except_user
  )
$$;
REVOKE ALL ON FUNCTION private.org_has_other_active_admin(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_create_user
-- ---------------------------------------------------------------------------
-- The login is inserted the way GoTrue itself would (the same shape as
-- deploy/supabase/make-import-sql.mjs): auth.users plus an email identity.
-- GoTrue reads the token columns into plain strings, so a NULL in any of them
-- breaks every sign-in with "Database error querying schema"; which of them
-- exist differs between GoTrue versions, hence the lookup. Generated columns
-- (users.confirmed_at, identities.email) are never written.
--
-- handle_new_user and sync_profile_email create the profile and its email; the
-- membership insert queues the welcome email (actor = this admin), and the
-- link's token is then put on that row. No row means the person could never
-- get in, so the whole call fails and nothing is kept.
CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_email TEXT,
  p_full_name TEXT,
  p_organization_id UUID,
  p_role public.app_role,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_details JSONB := COALESCE(p_details, '{}'::jsonb);
  v_email TEXT := lower(btrim(p_email));
  v_name TEXT := btrim(p_full_name);
  v_department UUID;
  v_team UUID;
  v_manager UUID;
  v_role_id UUID;
  v_designation TEXT;
  v_employee_id TEXT;
  v_phone TEXT;
  v_joining_raw TEXT;
  v_joining DATE;
  v_user_id UUID := gen_random_uuid();
  v_token TEXT;
  v_set TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to add people' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Choose an organization' USING ERRCODE = '22023';
  END IF;
  IF NOT private.has_organization_role(v_caller, p_organization_id, 'admin') THEN
    RAISE EXCEPTION 'Only an admin of this organization can add people to it' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_caller AND p.status = 'active') THEN
    RAISE EXCEPTION 'Your account is inactive, so you cannot add people' USING ERRCODE = '42501';
  END IF;

  -- Who
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Enter an email address' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_email) > 254 THEN
    RAISE EXCEPTION 'An email address can be at most 254 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT private.onboarding_email_ok(v_email) THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'Enter their full name' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) > 200 THEN
    RAISE EXCEPTION 'A full name can be at most 200 characters' USING ERRCODE = '22023';
  END IF;
  IF v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Enter the full name on one line' USING ERRCODE = '22023';
  END IF;
  IF p_role IS NULL THEN
    RAISE EXCEPTION 'Choose a role' USING ERRCODE = '22023';
  END IF;

  -- Optional details, each of which must belong to this organization
  IF jsonb_typeof(v_details) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'p_details must be a JSON object' USING ERRCODE = '22023';
  END IF;
  v_department := private.onboarding_uuid(v_details, 'departmentId', 'department');
  IF v_department IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments d WHERE d.id = v_department AND d.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'That department is not part of this organization' USING ERRCODE = '22023';
  END IF;
  v_team := private.onboarding_uuid(v_details, 'teamId', 'team');
  IF v_team IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.teams t WHERE t.id = v_team AND t.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'That team is not part of this organization' USING ERRCODE = '22023';
  END IF;
  v_manager := private.onboarding_uuid(v_details, 'reportingManagerId', 'reporting manager');
  IF v_manager IS NOT NULL AND NOT private.has_organization_access(v_manager, p_organization_id) THEN
    RAISE EXCEPTION 'The reporting manager must be an active member of this organization' USING ERRCODE = '22023';
  END IF;
  v_role_id := private.onboarding_uuid(v_details, 'roleId', 'role');
  IF v_role_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = v_role_id AND r.organization_id = p_organization_id AND r.base_role = p_role
    ) THEN
      RAISE EXCEPTION 'That role is not part of this organization or does not match the chosen access level'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT r.id INTO v_role_id
      FROM public.roles r
     WHERE r.organization_id = p_organization_id AND r.base_role = p_role AND r.is_system
     ORDER BY r.created_at, r.id
     LIMIT 1;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION 'This organization has no % role yet; add one under Settings → Roles', p_role
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_designation := NULLIF(btrim(v_details->>'designation'), '');
  IF char_length(v_designation) > 120 THEN
    RAISE EXCEPTION 'A designation can be at most 120 characters' USING ERRCODE = '22023';
  END IF;
  v_employee_id := NULLIF(btrim(v_details->>'employeeId'), '');
  IF char_length(v_employee_id) > 60 THEN
    RAISE EXCEPTION 'An employee ID can be at most 60 characters' USING ERRCODE = '22023';
  END IF;
  v_phone := NULLIF(btrim(v_details->>'phone'), '');
  IF char_length(v_phone) > 40 THEN
    RAISE EXCEPTION 'A phone number can be at most 40 characters' USING ERRCODE = '22023';
  END IF;
  v_joining_raw := NULLIF(btrim(v_details->>'joiningDate'), '');
  IF v_joining_raw IS NOT NULL THEN
    IF v_joining_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Enter the joining date as YYYY-MM-DD, with a 4-digit year' USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_joining := v_joining_raw::DATE;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Enter a real joining date, with a 4-digit year' USING ERRCODE = '22023';
    END;
    IF v_joining NOT BETWEEN DATE '1000-01-01' AND DATE '9999-12-31' THEN
      RAISE EXCEPTION 'Enter a real joining date, with a 4-digit year' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- One admin, at most 30 new people an hour. The lock makes parallel calls by
  -- one admin take turns, so each count sees the previous turn's rows.
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding_create_user:' || v_caller, 0));
  IF (SELECT count(*) FROM (
        SELECT 1 FROM private.account_setup_tokens t
        WHERE t.created_by = v_caller AND t.kind = 'create' AND t.created_at > now() - interval '1 hour'
        LIMIT 30) recent) >= 30 THEN
    RAISE EXCEPTION 'You have added 30 people in the last hour. Try again later.' USING ERRCODE = 'PT429';
  END IF;

  -- All admins together, at most 60 new people an hour and 150 a day: a second
  -- admin (say one this admin just made) brings no fresh allowance. The lock
  -- makes every create take its turn here, so no two can both see room for one.
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding_create_user:global', 0));
  IF (SELECT count(*) FROM (
        SELECT 1 FROM private.account_setup_tokens t
        WHERE t.kind = 'create' AND t.created_at > now() - interval '1 hour'
        LIMIT 60) recent) >= 60 THEN
    RAISE EXCEPTION 'Flowdesk has added 60 people in the last hour, the most it allows across all admins. Try again later.'
      USING ERRCODE = 'PT429';
  END IF;
  IF (SELECT count(*) FROM (
        SELECT 1 FROM private.account_setup_tokens t
        WHERE t.kind = 'create' AND t.created_at > now() - interval '24 hours'
        LIMIT 150) recent) >= 150 THEN
    RAISE EXCEPTION 'Flowdesk has added 150 people in the last 24 hours, the most it allows across all admins. Try again tomorrow.'
      USING ERRCODE = 'PT429';
  END IF;

  -- One address, one account (whatever the case it was typed in).
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding_email:' || v_email, 0));
  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'This email already has an account' USING ERRCODE = '23505';
  END IF;

  BEGIN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
      extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 10)),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_name),
      now(), now()
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This email already has an account' USING ERRCODE = '23505';
  END;

  SELECT string_agg(format('%1$I = COALESCE(%1$I, %2$L)', c.column_name, ''), ', ')
    INTO v_set
    FROM information_schema.columns c
   WHERE c.table_schema = 'auth' AND c.table_name = 'users'
     AND c.column_name IN ('confirmation_token', 'recovery_token', 'email_change', 'email_change_token_new',
                           'email_change_token_current', 'phone_change', 'phone_change_token',
                           'reauthentication_token');
  IF v_set IS NOT NULL THEN
    EXECUTE format('UPDATE auth.users SET %s WHERE id = $1', v_set) USING v_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns c
             WHERE c.table_schema = 'auth' AND c.table_name = 'users'
               AND c.column_name = 'email_change_confirm_status') THEN
    EXECUTE 'UPDATE auth.users SET email_change_confirm_status = 0
              WHERE id = $1 AND email_change_confirm_status IS NULL' USING v_user_id;
  END IF;

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', v_user_id::text, NULL, now(), now()
  );

  UPDATE public.profiles
     SET employee_id = v_employee_id, phone = v_phone, joining_date = v_joining
   WHERE user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_create_user: the profile was not created (is handle_new_user missing?)';
  END IF;

  INSERT INTO public.organization_memberships
    (user_id, organization_id, is_primary, status, department_id, team_id, reporting_manager_id,
     designation, role_id)
  VALUES
    (v_user_id, p_organization_id, true, 'active', v_department, v_team, v_manager, v_designation, v_role_id);

  INSERT INTO public.user_roles (user_id, organization_id, role, role_id)
  VALUES (v_user_id, p_organization_id, p_role, v_role_id)
  ON CONFLICT (user_id, organization_id, role) DO NOTHING;

  v_token := private.issue_account_setup_token(v_user_id, v_caller, 'create');
  UPDATE public.email_outbox
     SET payload = payload || jsonb_build_object('setupToken', v_token)
   WHERE dedupe_key = 'account_access:' || v_user_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The welcome email could not be queued, so the account was not created. Try again.';
  END IF;

  RETURN v_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_user(TEXT, TEXT, UUID, public.app_role, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_user(TEXT, TEXT, UUID, public.app_role, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. admin_resend_welcome
-- ---------------------------------------------------------------------------
-- Only for someone who has never signed in (everyone else has Forgot password).
-- Earlier links stop working, and a welcome still waiting to be sent is
-- withdrawn, so the person only ever gets the link that works.
CREATE OR REPLACE FUNCTION public.admin_resend_welcome(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_org UUID;
  v_email TEXT;
  v_last_sign_in TIMESTAMPTZ;
  v_name TEXT;
  v_status TEXT;
  v_token TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to resend a welcome email' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Choose a person' USING ERRCODE = '22023';
  END IF;

  -- A first look, without locks: is the caller an admin of any organization of
  -- theirs (a deactivated person's memberships are all inactive)?
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
     WHERE m.user_id = p_user_id
       AND private.has_organization_role(v_caller, m.organization_id, 'admin')
  ) THEN
    RAISE EXCEPTION 'Only an admin of one of their organizations can resend their welcome email'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_caller AND p.status = 'active') THEN
    RAISE EXCEPTION 'Your account is inactive, so you cannot resend welcome emails' USING ERRCODE = '42501';
  END IF;

  -- Then the checks that matter, on locked rows: the profile first, then the
  -- membership, the order Deactivate writes them in. A Deactivate in flight
  -- makes this wait for it and then see the account inactive, so it can never
  -- leave a live link behind; a Deactivate that starts after this waits for
  -- it, and then burns the new link.
  SELECT p.status::text INTO v_status
    FROM public.profiles p
   WHERE p.user_id = p_user_id
   FOR SHARE;
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Their account is inactive. Make it active first, then resend.' USING ERRCODE = '22023';
  END IF;
  SELECT m.organization_id INTO v_org
    FROM public.organization_memberships m
   WHERE m.user_id = p_user_id AND m.status = 'active'
     AND private.has_organization_role(v_caller, m.organization_id, 'admin')
   ORDER BY m.is_primary DESC, m.created_at, m.organization_id
   LIMIT 1
   FOR SHARE OF m;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Only an admin of one of their organizations can resend their welcome email'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.email, u.last_sign_in_at,
         COALESCE(NULLIF(btrim(p.full_name), ''), u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
    INTO v_email, v_last_sign_in, v_name
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
   WHERE u.id = p_user_id;
  IF v_last_sign_in IS NOT NULL THEN
    RAISE EXCEPTION 'They have already signed in — they can use Forgot password' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NULL OR btrim(v_email) = '' THEN
    RAISE EXCEPTION 'They have no email address to send to' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding_resend:' || p_user_id, 0));
  IF (SELECT count(*) FROM (
        SELECT 1 FROM private.account_setup_tokens t
        WHERE t.user_id = p_user_id AND t.kind = 'resend' AND t.created_at > now() - interval '24 hours'
        LIMIT 5) recent) >= 5 THEN
    RAISE EXCEPTION 'Their welcome email has been resent 5 times in the last 24 hours. Try again tomorrow.'
      USING ERRCODE = 'PT429';
  END IF;
  -- All admins together, at most 60 resends an hour (same turn-taking as above).
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding_resend:global', 0));
  IF (SELECT count(*) FROM (
        SELECT 1 FROM private.account_setup_tokens t
        WHERE t.kind = 'resend' AND t.created_at > now() - interval '1 hour'
        LIMIT 60) recent) >= 60 THEN
    RAISE EXCEPTION 'Welcome emails have been resent 60 times in the last hour, the most Flowdesk allows across all admins. Try again later.'
      USING ERRCODE = 'PT429';
  END IF;

  UPDATE private.account_setup_tokens SET used_at = now()
   WHERE user_id = p_user_id AND used_at IS NULL;
  UPDATE public.email_outbox
     SET status = 'suppressed', last_error = 'superseded by a resent welcome email',
         payload = payload - 'setupToken', locked_at = NULL
   WHERE recipient_user_id = p_user_id AND kind = 'account_access' AND status = 'pending';

  v_token := private.issue_account_setup_token(p_user_id, v_caller, 'resend');
  INSERT INTO public.email_outbox
    (kind, dedupe_key, recipient_user_id, recipient_email, organization_id, actor_id, payload, expires_at)
  VALUES
    ('account_access',
     'account_access:' || p_user_id || ':' || (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT,
     p_user_id, v_email, v_org, v_caller,
     jsonb_build_object('fullName', v_name, 'setupToken', v_token),
     now() + interval '7 days');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_resend_welcome(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_resend_welcome(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. complete_account_setup — the welcome link's page, before anyone signs in
-- ---------------------------------------------------------------------------
-- The token is 256 random bits and works once. A link for someone who has
-- since signed in (say through Forgot password), whose account is inactive or
-- who has no active organization no longer works either.
-- POST only: over GET the password would sit in a URL, and from there in logs.
CREATE OR REPLACE FUNCTION public.complete_account_setup(p_token TEXT, p_password TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_id UUID;
  v_user_id UUID;
  v_email TEXT;
BEGIN
  IF COALESCE(current_setting('request.method', true), '') NOT IN ('', 'POST') THEN
    RAISE EXCEPTION 'complete_account_setup: call with POST' USING ERRCODE = '22023';
  END IF;
  IF p_token IS NULL OR btrim(p_token) !~* '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'This link is not valid. Check you opened the whole link from your welcome email.'
      USING ERRCODE = '22023';
  END IF;
  IF p_password IS NULL OR char_length(p_password) < 8 THEN
    RAISE EXCEPTION 'Use at least 8 characters for your password' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_password) > 72 THEN
    RAISE EXCEPTION 'Use at most 72 characters for your password' USING ERRCODE = '22023';
  END IF;

  SELECT t.id, t.user_id INTO v_token_id, v_user_id
    FROM private.account_setup_tokens t
   WHERE t.token_sha256 = extensions.digest(lower(btrim(p_token)), 'sha256')
     AND t.used_at IS NULL AND t.expires_at > now()
   FOR UPDATE;
  IF v_token_id IS NULL THEN
    RAISE EXCEPTION 'This link has expired or was already used' USING ERRCODE = 'P0001';
  END IF;

  SELECT u.email INTO v_email
    FROM auth.users u
   WHERE u.id = v_user_id AND u.last_sign_in_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This link has expired or was already used' USING ERRCODE = 'P0001';
  END IF;
  -- Switched off, or no longer in any organization: the link is dead, whoever
  -- holds it (say a welcome sent to a mistyped address). Same words as above,
  -- so the page gives nothing away.
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_user_id AND p.status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.organization_memberships m
                     WHERE m.user_id = v_user_id AND m.status = 'active') THEN
    RAISE EXCEPTION 'This link has expired or was already used' USING ERRCODE = 'P0001';
  END IF;

  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         email_confirmed_at = COALESCE(email_confirmed_at, now()),
         updated_at = now()
   WHERE id = v_user_id;

  UPDATE private.account_setup_tokens SET used_at = now()
   WHERE user_id = v_user_id AND used_at IS NULL;
  -- Any welcome still waiting to go out now carries a dead link.
  UPDATE public.email_outbox
     SET status = 'suppressed', last_error = 'account already set up',
         payload = payload - 'setupToken', locked_at = NULL
   WHERE recipient_user_id = v_user_id AND kind = 'account_access' AND status = 'pending';

  RETURN v_email;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_account_setup(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_account_setup(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. admin_create_organization
-- ---------------------------------------------------------------------------
-- Any admin (of any organization they are active in, with an active account)
-- may create one, and becomes its admin. seed_new_organization gives it the
-- five system roles and the default vocabularies. Codes are stored upper-case;
-- organizations.code allows 2 to 8 characters.
CREATE OR REPLACE FUNCTION public.admin_create_organization(
  p_name TEXT,
  p_code TEXT,
  p_country TEXT,
  p_timezone TEXT,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_details JSONB := COALESCE(p_details, '{}'::jsonb);
  v_name TEXT := btrim(p_name);
  v_code TEXT := upper(btrim(p_code));
  v_country TEXT := btrim(p_country);
  v_timezone TEXT := btrim(p_timezone);
  v_official_email TEXT;
  v_phone TEXT;
  v_website TEXT;
  v_logo TEXT;
  v_status TEXT;
  v_org UUID;
  v_admin_role UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to create an organization' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.user_roles r
      JOIN public.organization_memberships m
        ON m.user_id = r.user_id AND m.organization_id = r.organization_id
     WHERE r.user_id = v_caller AND r.role = 'admin' AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only an admin can create an organization' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_caller AND p.status = 'active') THEN
    RAISE EXCEPTION 'Your account is inactive, so you cannot create an organization' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'Enter the organization name' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'An organization name can be at most 120 characters' USING ERRCODE = '22023';
  END IF;
  IF v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Enter the organization name on one line' USING ERRCODE = '22023';
  END IF;
  IF v_code IS NULL OR v_code !~ '^[A-Z0-9]{2,8}$' THEN
    RAISE EXCEPTION 'Enter a code of 2 to 8 letters or digits' USING ERRCODE = '22023';
  END IF;
  IF v_country IS NULL OR v_country = '' THEN
    RAISE EXCEPTION 'Enter the country' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_country) > 80 THEN
    RAISE EXCEPTION 'A country can be at most 80 characters' USING ERRCODE = '22023';
  END IF;
  -- A real zone name, as the browser and the email engine know it. Postgres
  -- also lists posix/* and right/* copies and a few pseudo-zones, which they
  -- reject and would silently treat as UTC.
  IF v_timezone IS NULL OR v_timezone = ''
     OR v_timezone ~* '^(posix|right)/'
     OR lower(v_timezone) IN ('factory', 'localtime', 'posixrules')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_timezone) THEN
    RAISE EXCEPTION 'Choose a valid time zone' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_details) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'p_details must be a JSON object' USING ERRCODE = '22023';
  END IF;
  v_official_email := NULLIF(btrim(v_details->>'officialEmail'), '');
  IF v_official_email IS NOT NULL AND NOT private.onboarding_email_ok(lower(v_official_email)) THEN
    RAISE EXCEPTION 'Enter a valid official email' USING ERRCODE = '22023';
  END IF;
  v_phone := NULLIF(btrim(v_details->>'phone'), '');
  IF char_length(v_phone) > 40 THEN
    RAISE EXCEPTION 'A phone number can be at most 40 characters' USING ERRCODE = '22023';
  END IF;
  v_website := NULLIF(btrim(v_details->>'website'), '');
  IF v_website IS NOT NULL AND (v_website !~* '^https?://[^[:space:][:cntrl:]]+$' OR char_length(v_website) > 2048) THEN
    RAISE EXCEPTION 'Enter a website that starts with http:// or https://' USING ERRCODE = '22023';
  END IF;
  v_logo := NULLIF(btrim(v_details->>'logoUrl'), '');
  IF v_logo IS NOT NULL AND (v_logo !~* '^https?://[^[:space:][:cntrl:]]+$' OR char_length(v_logo) > 2048) THEN
    RAISE EXCEPTION 'The logo must be an http:// or https:// link' USING ERRCODE = '22023';
  END IF;
  v_status := COALESCE(NULLIF(btrim(v_details->>'status'), ''), 'active');
  IF v_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'Status must be active or inactive' USING ERRCODE = '22023';
  END IF;

  -- Organizations are created rarely: one at a time, everywhere. That also
  -- makes the caps and the name and code checks below race-free.
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding_create_organization', 0));
  IF (SELECT count(*) FROM (
        SELECT 1 FROM private.organization_creations c
        WHERE c.created_by = v_caller AND c.created_at > now() - interval '24 hours'
        LIMIT 10) recent) >= 10 THEN
    RAISE EXCEPTION 'You have created 10 organizations in the last 24 hours. Try again tomorrow.'
      USING ERRCODE = 'PT429';
  END IF;
  IF (SELECT count(*) FROM (
        SELECT 1 FROM private.organization_creations c
        WHERE c.created_at > now() - interval '24 hours'
        LIMIT 20) recent) >= 20 THEN
    RAISE EXCEPTION 'Flowdesk has created 20 organizations in the last 24 hours, the most it allows across all admins. Try again tomorrow.'
      USING ERRCODE = 'PT429';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations o WHERE lower(btrim(o.name)) = lower(v_name)) THEN
    RAISE EXCEPTION 'An organization with this name already exists' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations o WHERE upper(o.code) = v_code) THEN
    RAISE EXCEPTION 'An organization with this code already exists' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.organizations
    (name, code, country, timezone, official_email, phone, website, logo_url, status)
  VALUES
    (v_name, v_code, v_country, v_timezone, v_official_email, v_phone, v_website, v_logo,
     v_status::public.organization_status)
  RETURNING id INTO v_org;

  INSERT INTO private.organization_creations (organization_id, created_by) VALUES (v_org, v_caller);

  SELECT r.id INTO v_admin_role
    FROM public.roles r
   WHERE r.organization_id = v_org AND r.base_role = 'admin' AND r.is_system
   ORDER BY (r.name = 'Admin') DESC, r.created_at, r.id
   LIMIT 1;
  IF v_admin_role IS NULL THEN
    RAISE EXCEPTION 'admin_create_organization: the new organization has no Admin role (is seed_new_organization missing?)';
  END IF;

  INSERT INTO public.organization_memberships (user_id, organization_id, is_primary, status, role_id)
  VALUES (v_caller, v_org, false, 'active', v_admin_role);
  INSERT INTO public.user_roles (user_id, organization_id, role, role_id)
  VALUES (v_caller, v_org, 'admin', v_admin_role)
  ON CONFLICT (user_id, organization_id, role) DO NOTHING;

  RETURN v_org;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_organization(TEXT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_organization(TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Worker RPCs from 20260926000000_email_notifications.sql, unchanged except
--    that a set-password token leaves the payload as soon as its row stops
--    being pending (sent, suppressed, failed or expired). A row that goes back
--    to pending keeps it for the next attempt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_worker_claim(p_secret TEXT, p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed JSONB;
BEGIN
  PERFORM private.email_worker_assert(p_secret);

  UPDATE public.email_outbox
     SET status = 'expired', locked_at = NULL, payload = payload - 'setupToken'
   WHERE status = 'pending' AND expires_at <= now();

  -- A worker that died mid-send leaves its rows 'sending'. Give them back, but
  -- not forever: a row that keeps killing the worker stops at five attempts.
  UPDATE public.email_outbox
     SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
         payload = CASE WHEN attempts >= 5 THEN payload - 'setupToken' ELSE payload END,
         locked_at = NULL,
         last_error = COALESCE(last_error, 'email worker: claimed but never completed')
   WHERE status = 'sending' AND locked_at < now() - interval '15 minutes';

  -- Soonest to expire first: a scheduled row lives 3 hours, an event row 48,
  -- so a backlog of event email cannot expire the day's digests. Rows of one
  -- send window share expires_at; within it, one email per person (digests,
  -- summaries) goes before the per-task reminders a bulk import can multiply.
  WITH picked AS (
    SELECT id
    FROM public.email_outbox
    WHERE status = 'pending' AND not_before <= now() AND expires_at > now()
    ORDER BY expires_at, kind IN ('due_reminder', 'overdue_alert'), created_at, id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 0), 500)
    FOR UPDATE SKIP LOCKED
  ), taken AS (
    UPDATE public.email_outbox o
       SET status = 'sending', locked_at = now(), attempts = o.attempts + 1
      FROM picked
     WHERE o.id = picked.id
    RETURNING o.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'kind', t.kind,
           'dedupeKey', t.dedupe_key,
           'recipientUserId', t.recipient_user_id,
           'recipientEmail', t.recipient_email,
           'organizationId', t.organization_id,
           'taskId', t.task_id,
           'projectId', t.project_id,
           'actorId', t.actor_id,
           'payload', t.payload,
           'attempts', t.attempts,
           'createdAt', private.email_iso(t.created_at))
         ORDER BY t.expires_at, t.kind IN ('due_reminder', 'overdue_alert'), t.created_at, t.id), '[]'::jsonb)
    INTO claimed
    FROM taken t;
  RETURN claimed;
END;
$$;

-- Tolerant of a malformed element on purpose: failing the whole batch would
-- leave every email in it 'sending', to be reclaimed and sent a second time.
-- 'defer' (throttled or misconfigured sender) puts a row back without using up
-- an attempt, not before retryAfterSeconds (clamped to 30..3600, default 60).
CREATE OR REPLACE FUNCTION public.email_worker_complete(p_secret TEXT, p_results JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated INTEGER;
BEGIN
  PERFORM private.email_worker_assert(p_secret);
  IF jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'email_worker_complete: p_results must be a JSON array' USING ERRCODE = '22023';
  END IF;

  WITH results AS (
    SELECT DISTINCT ON ((r->>'id')::uuid)
           (r->>'id')::uuid AS id, r->>'outcome' AS outcome, left(r->>'error', 2000) AS error,
           CASE WHEN r->>'retryAfterSeconds' ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN LEAST(GREATEST((r->>'retryAfterSeconds')::numeric, 30), 3600)
                ELSE 60
           END AS retry_after
    FROM jsonb_array_elements(p_results) AS r
    WHERE jsonb_typeof(r) = 'object'
      AND r->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND r->>'outcome' IN ('sent', 'suppressed', 'retry', 'failed', 'defer')
  ), done AS (
    UPDATE public.email_outbox o
       SET status = CASE
                      WHEN res.outcome = 'retry' THEN CASE WHEN o.attempts >= 5 THEN 'failed' ELSE 'pending' END
                      WHEN res.outcome = 'defer' THEN 'pending'
                      ELSE res.outcome
                    END,
           payload = CASE
                       WHEN res.outcome IN ('sent', 'suppressed', 'failed')
                            OR (res.outcome = 'retry' AND o.attempts >= 5)
                         THEN o.payload - 'setupToken'
                       ELSE o.payload
                     END,
           attempts = CASE WHEN res.outcome = 'defer' THEN GREATEST(o.attempts - 1, 0) ELSE o.attempts END,
           sent_at = CASE WHEN res.outcome = 'sent' THEN now() ELSE o.sent_at END,
           last_error = CASE WHEN res.outcome = 'sent' THEN NULL ELSE res.error END,
           not_before = CASE
                          WHEN res.outcome = 'retry' AND o.attempts < 5
                            THEN now() + o.attempts * o.attempts * interval '5 minutes'
                          WHEN res.outcome = 'defer'
                            THEN now() + make_interval(secs => res.retry_after::double precision)
                          ELSE o.not_before
                        END,
           locked_at = NULL
      FROM results res
     WHERE o.id = res.id AND o.status = 'sending'
    RETURNING 1
  )
  SELECT count(*) INTO updated FROM done;
  RETURN updated;
END;
$$;

REVOKE ALL ON FUNCTION public.email_worker_claim(TEXT, INTEGER), public.email_worker_complete(TEXT, JSONB)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_worker_claim(TEXT, INTEGER), public.email_worker_complete(TEXT, JSONB)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Deactivate, and taking a sent link back.
--
--    Deactivate (profiles.status becoming inactive) switches the person off:
--      - refused, before anything changes, if they are the last active admin of
--        an organization ("<name> is the last active admin of <org>. Make
--        someone else admin first.");
--      - every unused link of theirs burns and a welcome still waiting to go
--        out is withdrawn (never fails the write; at worst a WARNING);
--      - their active memberships become inactive, and which ones is kept in
--        private.suspended_memberships. Row-level security only lets active
--        members in, so whoever signs in as them (say through Forgot password)
--        sees nothing, and the admin functions refuse them;
--      - their sign-in sessions end (auth.sessions; the refresh tokens go with
--        them), so the app cannot renew their access token. A failure there
--        only logs a WARNING: the memberships above already shut them out.
--    Reactivate (back to active) switches exactly those memberships back on.
--    It does not bring an old link back: Resend sends a new one.
--    While the account is inactive, a membership written active (an
--    organization added to them, their memberships saved on the Users page)
--    is kept inactive and remembered with the others, so Reactivate brings it
--    too. The few policies that let people at their own rows without asking
--    about membership are closed to an inactive account (restrictive
--    policies, below).
--    Nobody can change their own status (guard_profile_update, below), so a
--    deactivated admin cannot switch themselves back on.
--
--    Removing a person's last active organization also burns their links.
--    complete_account_setup refuses anyone inactive or without an active
--    organization anyway.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.revoke_account_setup(_user_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The links on their own: trouble withdrawing the email must not keep one alive.
  BEGIN
    UPDATE private.account_setup_tokens SET used_at = now()
     WHERE user_id = _user_id AND used_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'revoke_account_setup (links): %', SQLERRM;
  END;
  BEGIN
    UPDATE public.email_outbox
       SET status = 'suppressed', last_error = _reason, payload = payload - 'setupToken', locked_at = NULL
     WHERE recipient_user_id = _user_id AND kind = 'account_access' AND status = 'pending';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'revoke_account_setup (welcome email): %', SQLERRM;
  END;
END;
$$;
REVOKE ALL ON FUNCTION private.revoke_account_setup(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.revoke_account_setup_after_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org RECORD;
  v_switching_off BOOLEAN := OLD.status IS NOT DISTINCT FROM 'active'::public.organization_status;
BEGIN
  -- Reactivated: exactly the memberships Deactivate switched off come back.
  IF NEW.status IS NOT DISTINCT FROM 'active'::public.organization_status THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      WITH restored AS (
        DELETE FROM private.suspended_memberships s
         WHERE s.user_id = NEW.user_id
        RETURNING s.organization_id
      )
      UPDATE public.organization_memberships m
         SET status = 'active'
        FROM restored r
       WHERE m.user_id = NEW.user_id AND m.organization_id = r.organization_id
         AND m.status IS DISTINCT FROM 'active'::public.organization_status;
    END IF;
    RETURN NULL;
  END IF;

  -- Deactivated. First the one reason to refuse, before anything changes.
  IF v_switching_off THEN
    FOR v_org IN
      SELECT o.id, o.name
        FROM public.organization_memberships m
        JOIN public.organizations o ON o.id = m.organization_id
       WHERE m.user_id = NEW.user_id AND m.status = 'active'
         AND EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = m.user_id AND ur.organization_id = m.organization_id
                        AND ur.role = 'admin')
       ORDER BY o.id
    LOOP
      PERFORM private.lock_organization_admins(v_org.id);
      IF NOT private.org_has_other_active_admin(v_org.id, NEW.user_id) THEN
        RAISE EXCEPTION '% is the last active admin of %. Make someone else admin first.',
          COALESCE(NULLIF(btrim(NEW.full_name), ''), NULLIF(btrim(NEW.email), ''), 'This person'), v_org.name
          USING ERRCODE = 'P0001', CONSTRAINT = 'organization_needs_active_admin';
      END IF;
    END LOOP;
  END IF;

  -- The links (as before this release: also when the status was re-saved).
  BEGIN
    PERFORM private.revoke_account_setup(NEW.user_id, 'account deactivated');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'revoke_account_setup_after_profile: %', SQLERRM;
  END;

  IF v_switching_off THEN
    WITH switched_off AS (
      UPDATE public.organization_memberships m
         SET status = 'inactive'
       WHERE m.user_id = NEW.user_id AND m.status = 'active'
      RETURNING m.user_id, m.organization_id
    )
    INSERT INTO private.suspended_memberships (user_id, organization_id)
    SELECT user_id, organization_id FROM switched_off
    ON CONFLICT (user_id, organization_id) DO UPDATE SET suspended_at = EXCLUDED.suspended_at;

    BEGIN
      DELETE FROM auth.sessions s WHERE s.user_id = NEW.user_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Deactivate: could not end the sign-in sessions of %: %', NEW.user_id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.revoke_account_setup_after_profile() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS revoke_account_setup_after_profile ON public.profiles;
CREATE TRIGGER revoke_account_setup_after_profile AFTER UPDATE OF status ON public.profiles
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM 'active'::public.organization_status
                     OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.revoke_account_setup_after_profile();

-- guard_profile_update (from the email notifications migration), with one
-- change: nobody may change their own status. It used to let an admin do so,
-- which let a deactivated admin switch themselves back on. Admins still change
-- other people's status; row-level security decides whose.
CREATE OR REPLACE FUNCTION private.guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  NEW.email := OLD.email;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.user_id = auth.uid() THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_profile_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_profile_update_before ON public.profiles;
CREATE TRIGGER guard_profile_update_before BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_profile_update();

CREATE OR REPLACE FUNCTION private.revoke_account_setup_after_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'active' THEN
    RETURN NULL;
  END IF;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.organization_memberships m
                    WHERE m.user_id = OLD.user_id AND m.status = 'active') THEN
      PERFORM private.revoke_account_setup(OLD.user_id, 'no active organization left');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'revoke_account_setup_after_membership: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.revoke_account_setup_after_membership() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS revoke_account_setup_after_membership ON public.organization_memberships;
CREATE TRIGGER revoke_account_setup_after_membership
  AFTER DELETE OR UPDATE OF status ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION private.revoke_account_setup_after_membership();

-- A deactivated person's memberships stay off. One written active while their
-- account is inactive (an organization added to them, their memberships saved
-- again on the Users page, or an active membership moved over to them) is kept
-- inactive and remembered like the ones Deactivate switched off, so Reactivate
-- switches it on with the rest. A membership of theirs that is already active
-- is left alone (section 11 keeps a few on for an organization's only admin).
-- Reactivate itself passes: by the time it switches memberships on, the
-- account is active again.
CREATE OR REPLACE FUNCTION private.keep_deactivated_memberships_off()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_status public.organization_status;
BEGIN
  -- An upsert of an existing membership fires BEFORE INSERT first, on a row
  -- that carries the column default 'active', before it turns into an UPDATE
  -- that may not touch status at all. Only a genuinely new row counts here.
  IF TG_OP = 'INSERT' AND EXISTS (
       SELECT 1 FROM public.organization_memberships m
        WHERE m.user_id = NEW.user_id AND m.organization_id = NEW.organization_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM 'active'::public.organization_status
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM 'active'::public.organization_status
          OR NEW.user_id IS DISTINCT FROM OLD.user_id
          OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
    -- FOR SHARE waits for a Deactivate that is still committing and then reads
    -- its result; an unlocked read would see 'active' and let this row through.
    SELECT p.status INTO profile_status FROM public.profiles p
     WHERE p.user_id = NEW.user_id FOR SHARE;
  END IF;
  IF profile_status IS NOT NULL AND profile_status <> 'active'::public.organization_status THEN
    NEW.status := 'inactive';
    INSERT INTO private.suspended_memberships (user_id, organization_id)
    VALUES (NEW.user_id, NEW.organization_id)
    ON CONFLICT (user_id, organization_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.keep_deactivated_memberships_off() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS keep_deactivated_memberships_off ON public.organization_memberships;
CREATE TRIGGER keep_deactivated_memberships_off
  BEFORE INSERT OR UPDATE OF status, user_id, organization_id ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION private.keep_deactivated_memberships_off();

-- Row-level security lets only active members into an organization's data,
-- and Deactivate switches every membership off. A few policies also let people
-- at their own rows without asking about membership: tasks they created, are
-- assigned or review (with those tasks' comments, checklists, files and
-- activity), and their own comments, recurrences, documents and uploads. These
-- restrictive policies close exactly those to an inactive account. For an
-- active account they are always true, so nothing changes for anyone else;
-- admins acting on a deactivated person's rows are checked as themselves.
CREATE OR REPLACE FUNCTION private.account_is_active(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Active profile AND at least one active membership: removing someone's last
  -- organization takes their own tasks away too, exactly like Deactivate.
  SELECT NOT EXISTS (
           SELECT 1 FROM public.profiles p
            WHERE p.user_id = _user_id
              AND p.status IS DISTINCT FROM 'active'::public.organization_status)
     AND EXISTS (
           SELECT 1 FROM public.organization_memberships m
            WHERE m.user_id = _user_id
              AND m.status = 'active'::public.organization_status)
$$;
REVOKE ALL ON FUNCTION private.account_is_active(UUID) FROM PUBLIC, anon;
-- Policies run their functions as the person asking.
GRANT EXECUTE ON FUNCTION private.account_is_active(UUID) TO authenticated;

DROP POLICY IF EXISTS "Deactivated accounts have no access" ON public.work_tasks;
CREATE POLICY "Deactivated accounts have no access" ON public.work_tasks AS RESTRICTIVE
  FOR ALL TO authenticated
  USING ((SELECT private.account_is_active(auth.uid())))
  WITH CHECK ((SELECT private.account_is_active(auth.uid())));
DROP POLICY IF EXISTS "Deactivated accounts have no access" ON public.work_activity;
CREATE POLICY "Deactivated accounts have no access" ON public.work_activity AS RESTRICTIVE
  FOR ALL TO authenticated
  USING ((SELECT private.account_is_active(auth.uid())))
  WITH CHECK ((SELECT private.account_is_active(auth.uid())));
DROP POLICY IF EXISTS "Deactivated accounts have no access" ON public.task_comments;
CREATE POLICY "Deactivated accounts have no access" ON public.task_comments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING ((SELECT private.account_is_active(auth.uid())))
  WITH CHECK ((SELECT private.account_is_active(auth.uid())));
DROP POLICY IF EXISTS "Deactivated accounts have no access" ON public.task_subtasks;
CREATE POLICY "Deactivated accounts have no access" ON public.task_subtasks AS RESTRICTIVE
  FOR ALL TO authenticated
  USING ((SELECT private.account_is_active(auth.uid())))
  WITH CHECK ((SELECT private.account_is_active(auth.uid())));
DROP POLICY IF EXISTS "Deactivated accounts have no access" ON public.task_attachments;
CREATE POLICY "Deactivated accounts have no access" ON public.task_attachments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING ((SELECT private.account_is_active(auth.uid())))
  WITH CHECK ((SELECT private.account_is_active(auth.uid())));
DROP POLICY IF EXISTS "Deactivated accounts have no access" ON public.task_recurrences;
CREATE POLICY "Deactivated accounts have no access" ON public.task_recurrences AS RESTRICTIVE
  FOR ALL TO authenticated
  USING ((SELECT private.account_is_active(auth.uid())))
  WITH CHECK ((SELECT private.account_is_active(auth.uid())));
DROP POLICY IF EXISTS "Deactivated accounts have no access" ON public.project_documents;
CREATE POLICY "Deactivated accounts have no access" ON public.project_documents AS RESTRICTIVE
  FOR ALL TO authenticated
  USING ((SELECT private.account_is_active(auth.uid())))
  WITH CHECK ((SELECT private.account_is_active(auth.uid())));
-- The files themselves: the storage delete policy lets uploaders remove their
-- own. Only FlowDesk's two buckets are touched.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk deactivated accounts have no file access" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk deactivated accounts have no file access" ON storage.objects AS RESTRICTIVE
    FOR ALL TO authenticated
    USING (bucket_id NOT IN ('task-attachments', 'project-documents')
           OR (SELECT private.account_is_active(auth.uid())))
    WITH CHECK (bucket_id NOT IN ('task-attachments', 'project-documents')
                OR (SELECT private.account_is_active(auth.uid())))$p$;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Keep each permission in step with the role shown.
--
--    Row-level security reads only user_roles.role; the Users and Roles pages
--    show the membership's role (organization_memberships.role_id), whose
--    base_role is the permission it stands for. Before this release a browser
--    role change saved the role but not the permission, so the two drifted: a
--    demoted admin kept admin rights. From now on, any write that sets a
--    membership's role (adding it, changing it, or saving the membership again)
--    leaves that person's user_roles in that organization as exactly the role's
--    base_role, and changing a custom role's base_role carries its holders with
--    it. Nothing here goes beyond what an admin of that organization may already
--    do by hand: only they can write its memberships, roles and user_roles.
--
--    The membership trigger runs at the end of the transaction, so a script
--    that inserts a membership and then its user_roles row (admin_create_user,
--    the SQL fallback in the deployment guide) is not disturbed, and it re-reads
--    the membership, so several writes in one transaction settle on the last. A
--    membership without a role (role_id NULL), or with a role from another
--    organization, is left alone. Neither trigger fails the write that fired
--    it (at worst it logs a WARNING), with one exception: a change that would
--    leave the organization with no active admin is refused (below), and that
--    error reaches the person saving, so their save fails with its message.
--
--    That refusal lives on user_roles itself, so it covers every way in: the
--    two sync triggers here, the Users page writing the permission, and hand
--    SQL. Removing an admin permission, or changing it to another role, is
--    refused when that person is an active admin (active membership, active
--    account) and no other active admin of that organization is left. Rows
--    that go because their person or organization is being deleted are never
--    held up. A signed-in admin removing the last active admin's membership,
--    switching it off or moving it to someone else, is refused the same way
--    (the membership guard below).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.sync_user_role_with_membership(_user_id UUID, _organization_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id UUID;
  v_base public.app_role;
BEGIN
  SELECT r.id, r.base_role INTO v_role_id, v_base
    FROM public.organization_memberships m
    JOIN public.roles r ON r.id = m.role_id AND r.organization_id = m.organization_id
   WHERE m.user_id = _user_id AND m.organization_id = _organization_id;
  IF v_base IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM public.user_roles
   WHERE user_id = _user_id AND organization_id = _organization_id AND role <> v_base;
  INSERT INTO public.user_roles (user_id, organization_id, role, role_id)
  VALUES (_user_id, _organization_id, v_base, v_role_id)
  ON CONFLICT (user_id, organization_id, role) DO UPDATE
    SET role_id = EXCLUDED.role_id
    WHERE public.user_roles.role_id IS DISTINCT FROM EXCLUDED.role_id;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_user_role_with_membership(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.sync_user_role_after_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_constraint TEXT;
BEGIN
  BEGIN
    PERFORM private.sync_user_role_with_membership(NEW.user_id, NEW.organization_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'organization_needs_active_admin' THEN
      RAISE;
    END IF;
    RAISE WARNING 'sync_user_role_after_membership: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_user_role_after_membership() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sync_user_role_after_membership ON public.organization_memberships;
CREATE CONSTRAINT TRIGGER sync_user_role_after_membership
  AFTER INSERT OR UPDATE OF role_id ON public.organization_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.role_id IS NOT NULL)
  EXECUTE FUNCTION private.sync_user_role_after_membership();

CREATE OR REPLACE FUNCTION private.sync_user_roles_after_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  holder RECORD;
  v_constraint TEXT;
BEGIN
  FOR holder IN
    SELECT m.user_id, m.organization_id
      FROM public.organization_memberships m
     WHERE m.role_id = NEW.id AND m.organization_id = NEW.organization_id
     ORDER BY m.user_id
  LOOP
    BEGIN
      PERFORM private.sync_user_role_with_membership(holder.user_id, holder.organization_id);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'organization_needs_active_admin' THEN
        RAISE;
      END IF;
      RAISE WARNING 'sync_user_roles_after_role (%): %', holder.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_user_roles_after_role() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sync_user_roles_after_role ON public.roles;
CREATE TRIGGER sync_user_roles_after_role AFTER UPDATE OF base_role ON public.roles
  FOR EACH ROW WHEN (OLD.base_role IS DISTINCT FROM NEW.base_role)
  EXECUTE FUNCTION private.sync_user_roles_after_role();

CREATE OR REPLACE FUNCTION private.keep_an_active_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_name TEXT;
BEGIN
  -- Only taking an admin permission away matters: removing it, or changing it
  -- to another role, person or organization.
  IF OLD.role IS DISTINCT FROM 'admin'::public.app_role
     OR (TG_OP = 'UPDATE' AND NEW.role = 'admin'::public.app_role
         AND NEW.user_id = OLD.user_id AND NEW.organization_id = OLD.organization_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  -- ... from someone who counts as an active admin there (so never when the
  -- person or the organization is being deleted: their rows are gone first).
  IF EXISTS (SELECT 1
               FROM public.organization_memberships m
               JOIN public.profiles p ON p.user_id = m.user_id AND p.status = 'active'
              WHERE m.user_id = OLD.user_id AND m.organization_id = OLD.organization_id
                AND m.status = 'active')
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
    PERFORM private.lock_organization_admins(OLD.organization_id);
    IF NOT private.org_has_other_active_admin(OLD.organization_id, OLD.user_id) THEN
      SELECT o.name INTO v_org_name FROM public.organizations o WHERE o.id = OLD.organization_id;
      IF FOUND THEN
        RAISE EXCEPTION 'There must always be at least one active admin in %. Make someone else admin first.',
          v_org_name
          USING ERRCODE = 'P0001', CONSTRAINT = 'organization_needs_active_admin';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.keep_an_active_admin() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS keep_an_active_admin ON public.user_roles;
CREATE TRIGGER keep_an_active_admin BEFORE UPDATE OF role, user_id, organization_id OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION private.keep_an_active_admin();

-- The same rule for the admin's membership: removing it, switching it off, or
-- moving the row to another person or organization leaves their admin
-- permission granting nothing, so that is refused too when no other active
-- admin is left. Only for a signed-in caller (the Users page,
-- the API). Hand SQL (no signed-in user), the auth service deleting a person
-- and this script are not held up: an organization's memberships must go
-- before the organization itself (the foreign key restricts), so deleting one
-- by hand has to stay possible. Deactivate passes: it has already checked, and
-- the account is inactive by the time it switches the memberships off.
CREATE OR REPLACE FUNCTION private.keep_an_active_admin_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_name TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.status IS NOT DISTINCT FROM 'active'::public.organization_status
     AND (TG_OP = 'DELETE'
          OR NEW.status IS DISTINCT FROM 'active'::public.organization_status
          OR NEW.user_id IS DISTINCT FROM OLD.user_id
          OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = OLD.user_id AND ur.organization_id = OLD.organization_id
                    AND ur.role = 'admin')
     AND EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = OLD.user_id AND p.status = 'active') THEN
    PERFORM private.lock_organization_admins(OLD.organization_id);
    IF NOT private.org_has_other_active_admin(OLD.organization_id, OLD.user_id) THEN
      SELECT o.name INTO v_org_name FROM public.organizations o WHERE o.id = OLD.organization_id;
      RAISE EXCEPTION 'There must always be at least one active admin in %. Make someone else admin first.',
        COALESCE(v_org_name, 'this organization')
        USING ERRCODE = 'P0001', CONSTRAINT = 'organization_needs_active_admin';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.keep_an_active_admin_membership() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS keep_an_active_admin_membership ON public.organization_memberships;
CREATE TRIGGER keep_an_active_admin_membership
  BEFORE DELETE OR UPDATE OF status, user_id, organization_id ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION private.keep_an_active_admin_membership();

-- ---------------------------------------------------------------------------
-- 10. One-off repair of the permissions that drifted before this release (the
--     list of what it changed is the script's last statement, section 12, so
--     the SQL editor shows it). The role shown is what the admin chose; the
--     permission write is what failed, so each person's user_roles in an
--     organization is made exactly their membership role's base_role: a
--     wrong permission is changed, an extra one removed, a missing one
--     added. A membership without a role
--     (role_id NULL), or with a role from another organization, is never
--     touched. One exception, so the repair cannot lock anyone out: it never
--     takes admin away when that would leave an organization with no active
--     admin; such a row is listed as NOT changed. Running it again changes
--     nothing more (and lists only such rows, if any).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS pg_temp.onboarding_role_repair;
CREATE TEMP TABLE onboarding_role_repair AS
SELECT m.user_id,
       m.organization_id,
       m.role_id,
       r.name AS role_name,
       r.base_role AS target,
       m.status = 'active' AS membership_active,
       COALESCE((SELECT array_agg(ur.role ORDER BY ur.role)
                   FROM public.user_roles ur
                  WHERE ur.user_id = m.user_id AND ur.organization_id = m.organization_id),
                '{}'::public.app_role[]) AS before,
       false AS skipped
  FROM public.organization_memberships m
  JOIN public.roles r ON r.id = m.role_id AND r.organization_id = m.organization_id
 WHERE m.role_id IS NOT NULL;
DELETE FROM pg_temp.onboarding_role_repair WHERE before = ARRAY[target];

-- Admins who can actually act (active membership, active account), now and
-- after the repair; an organization that has one now keeps one.
WITH usable AS (
  SELECT m.organization_id,
         EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = m.user_id AND ur.organization_id = m.organization_id
                    AND ur.role = 'admin') AS admin_now,
         p.target AS planned
    FROM public.organization_memberships m
    JOIN public.profiles pr ON pr.user_id = m.user_id AND pr.status = 'active'
    LEFT JOIN pg_temp.onboarding_role_repair p
      ON p.user_id = m.user_id AND p.organization_id = m.organization_id
   WHERE m.status = 'active'
), at_risk AS (
  SELECT organization_id
    FROM usable
   GROUP BY organization_id
  HAVING bool_or(admin_now)
     AND NOT bool_or(COALESCE(planned = 'admin', admin_now))
)
UPDATE pg_temp.onboarding_role_repair p
   SET skipped = true
  FROM at_risk a
 WHERE p.organization_id = a.organization_id
   AND 'admin' = ANY (p.before)
   AND p.target <> 'admin';

-- Additions first, removals second: an organization whose remaining admin is
-- one this repair adds has that admin before keep_an_active_admin (section 9)
-- sees another one removed.
INSERT INTO public.user_roles (user_id, organization_id, role, role_id)
SELECT p.user_id, p.organization_id, p.target, p.role_id
  FROM pg_temp.onboarding_role_repair p
 WHERE NOT p.skipped
ON CONFLICT (user_id, organization_id, role) DO UPDATE SET role_id = EXCLUDED.role_id;
DELETE FROM public.user_roles ur
 USING pg_temp.onboarding_role_repair p
 WHERE NOT p.skipped
   AND ur.user_id = p.user_id AND ur.organization_id = p.organization_id
   AND ur.role <> p.target;

-- ---------------------------------------------------------------------------
-- 11. People deactivated before this release kept their memberships, so they
--     kept their access. Switch those memberships off the way Deactivate now
--     does (kept in private.suspended_memberships, so Reactivate restores
--     them) and end those people's sessions. The same safety valve as above:
--     a membership that carries the only admin permission its organization
--     has left (no active admin besides them) is left on and listed as NOT
--     switched off. Running it again changes nothing more (and lists only such
--     rows, if any).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS pg_temp.onboarding_deactivated_access;
CREATE TEMP TABLE onboarding_deactivated_access AS
SELECT m.user_id,
       m.organization_id,
       r.name AS role_name,
       COALESCE((SELECT array_agg(ur.role ORDER BY ur.role)
                   FROM public.user_roles ur
                  WHERE ur.user_id = m.user_id AND ur.organization_id = m.organization_id),
                '{}'::public.app_role[]) AS permission,
       false AS skipped
  FROM public.organization_memberships m
  JOIN public.profiles pr ON pr.user_id = m.user_id
  LEFT JOIN public.roles r ON r.id = m.role_id
 WHERE m.status = 'active'
   AND pr.status IS DISTINCT FROM 'active'::public.organization_status;
UPDATE pg_temp.onboarding_deactivated_access d
   SET skipped = true
 WHERE 'admin' = ANY (d.permission)
   AND NOT private.org_has_other_active_admin(d.organization_id, d.user_id);

INSERT INTO private.suspended_memberships (user_id, organization_id)
SELECT d.user_id, d.organization_id
  FROM pg_temp.onboarding_deactivated_access d
 WHERE NOT d.skipped
ON CONFLICT (user_id, organization_id) DO NOTHING;
UPDATE public.organization_memberships m
   SET status = 'inactive'
  FROM pg_temp.onboarding_deactivated_access d
 WHERE NOT d.skipped
   AND m.user_id = d.user_id AND m.organization_id = d.organization_id
   AND m.status = 'active';
DO $$
BEGIN
  DELETE FROM auth.sessions s
   USING (SELECT DISTINCT user_id FROM pg_temp.onboarding_deactivated_access WHERE NOT skipped) d
   WHERE s.user_id = d.user_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin onboarding: could not end the sessions of people deactivated earlier: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 12. Read-only: every permission section 10 changed and every membership
--     section 11 switched off (or one row saying there was nothing to do).
--     Keep a copy of this result.
-- ---------------------------------------------------------------------------
SELECT COALESCE(u.email, u.id::text) AS email,
       o.code AS organization,
       p.role_name || CASE WHEN p.membership_active THEN '' ELSE ' (inactive membership)' END AS role_shown,
       COALESCE(NULLIF(array_to_string(p.before, ', '), ''), '(none)') AS permission_before,
       CASE WHEN p.skipped THEN array_to_string(p.before, ', ') ELSE p.target::text END AS permission_after,
       CASE
         WHEN p.skipped THEN 'NOT changed: that would leave ' || o.code
                             || ' with no active admin. Make someone else Admin there, then run this script again.'
         WHEN cardinality(p.before) = 0 THEN 'added: they had no permission in this organization'
         WHEN p.target = ANY (p.before) THEN 'extra permission removed'
         ELSE 'changed to match the role shown'
       END AS what_happened
  FROM pg_temp.onboarding_role_repair p
  JOIN auth.users u ON u.id = p.user_id
  JOIN public.organizations o ON o.id = p.organization_id
UNION ALL
SELECT COALESCE(u.email, u.id::text),
       o.code,
       COALESCE(d.role_name, '(no role)') || ' (account deactivated)',
       COALESCE(NULLIF(array_to_string(d.permission, ', '), ''), '(none)'),
       COALESCE(NULLIF(array_to_string(d.permission, ', '), ''), '(none)'),
       CASE
         WHEN d.skipped THEN 'NOT switched off: they are the only admin ' || o.code
                             || ' has left. Make someone else Admin there, then run this script again.'
         ELSE 'access switched off: their account was deactivated before this release (Reactivate restores it)'
       END
  FROM pg_temp.onboarding_deactivated_access d
  JOIN auth.users u ON u.id = d.user_id
  JOIN public.organizations o ON o.id = d.organization_id
UNION ALL
SELECT '(nobody)', NULL, NULL, NULL, NULL,
       'Nothing to repair: every permission already matches the role shown, and no deactivated account still has access.'
 WHERE NOT EXISTS (SELECT 1 FROM pg_temp.onboarding_role_repair)
   AND NOT EXISTS (SELECT 1 FROM pg_temp.onboarding_deactivated_access)
ORDER BY 1, 2;
