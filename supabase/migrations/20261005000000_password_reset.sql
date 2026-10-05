-- ============================================================================
-- FlowDesk — Forgot password, sent by Flowdesk itself (5 Oct 2026)
-- ============================================================================
-- "Forgot / change password?" asked the auth service (GoTrue) to email a
-- 6-digit recovery code. On the hosted project that email belongs to Lovable
-- Cloud's auth email hook: it came from a Lovable address, with a "Reset
-- Password" button that opened the old Lovable prototype and no code for our
-- page to take. Nobody here can change that hook, its templates, the site URL
-- or the redirect list.
--
-- So Flowdesk now sends its own, the way it sends the welcome email: a
-- one-time link (32 random bytes; the database keeps only their sha256, in
-- private.account_setup_tokens with kind 'reset') on an email_outbox row of
-- kind 'password_reset', which the email worker sends from Flowdesk's own
-- mailbox. The link works once and expires in an hour.
--
--   request_password_reset   the web server asks for the email. Gated by the
--                            email worker's secret, so only our server can
--                            call it. It answers 'queued', or 'skipped' when
--                            there is nobody to send to (no such login, an
--                            inactive account, no active organization); the
--                            server answers the visitor the same either way.
--   complete_password_reset  the link's page sets the new password (anon may
--                            call: the link is the secret). The person is
--                            signed out everywhere and the page signs them in.
--
-- Abuse guards: 5 requests per address per hour, counted whether or not the
-- address has an account (so a refusal tells nobody anything), and, in the web
-- server, 20 per network address every 15 minutes from this site's own pages.
-- There is no cap across all addresses: requests for addresses with no
-- account would fill it, and anyone could then switch reset off for everyone.
-- Only a hash of each address is kept, and only for a day.
--
-- A request burns every earlier link of the person, a welcome link included
-- (someone who never signed in gets in through the reset instead), and
-- withdraws the emails still waiting to go out with one. A reset email whose
-- link dies any other way (a resent welcome, Deactivate, a finished reset) is
-- withdrawn too (section 3).
--
-- Needs 20260927000000_admin_onboarding.sql. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Prerequisites. Fail loudly and early rather than half-way through.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
  IF to_regclass('private.account_setup_tokens') IS NULL
     OR to_regclass('public.email_outbox') IS NULL
     OR to_regprocedure('private.email_worker_assert(text)') IS NULL
     OR to_regprocedure('private.onboarding_email_ok(text)') IS NULL
     OR to_regprocedure('public.complete_account_setup(text, text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20260927000000_admin_onboarding.sql before the password reset migration';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The new kinds: 'reset' links and 'password_reset' emails.
--    Both checks on kind were created without a name, so the hosted database
--    may call them something else. Whichever check limits kind to a list is
--    replaced by one under a known name that keeps every value the old one
--    allowed (even one this file does not know) and adds the new one. A check
--    on kind of any other shape stops the script: it is someone's rule, and
--    must not be dropped unseen. Run again, this changes nothing.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  spec RECORD;
  con RECORD;
  v_attnum SMALLINT;
  v_names TEXT[];
  v_values TEXT[];
  v_found TEXT[];
  v_allowed TEXT[];
  v_name TEXT;
BEGIN
  FOR spec IN
    SELECT *
      FROM (VALUES
        ('public.email_outbox'::regclass, 'email_outbox_kind_check',
         ARRAY['account_access', 'project_invitation', 'task_assigned', 'due_reminder', 'overdue_alert',
               'daily_digest', 'weekly_digest', 'daily_management', 'weekly_management', 'password_reset']),
        ('private.account_setup_tokens'::regclass, 'account_setup_tokens_kind_check',
         ARRAY['create', 'resend', 'reset'])
      ) AS s(tbl, con_name, wanted)
  LOOP
    SELECT a.attnum INTO v_attnum
      FROM pg_attribute a
     WHERE a.attrelid = spec.tbl AND a.attname = 'kind' AND NOT a.attisdropped;
    v_names := '{}';
    v_found := NULL;
    FOR con IN
      SELECT c.conname::text AS conname, c.conkey, pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
       WHERE c.conrelid = spec.tbl AND c.contype = 'c' AND v_attnum = ANY (c.conkey)
       ORDER BY c.conname
    LOOP
      IF con.conkey <> ARRAY[v_attnum] OR con.def !~ '^CHECK \(\(kind = ANY \(ARRAY\[.*\]\)\)\)$' THEN
        RAISE EXCEPTION '% has a check on kind this script does not recognise (% %). Look at it before running this again.',
          spec.tbl, con.conname, con.def;
      END IF;
      v_names := v_names || con.conname;
      v_values := ARRAY(SELECT m[1] FROM regexp_matches(con.def, '''([^'']*)''', 'g') AS m);
      -- Two lists on one column allow only what both allow.
      v_found := CASE WHEN v_found IS NULL THEN v_values
                      ELSE ARRAY(SELECT unnest(v_found) INTERSECT SELECT unnest(v_values)) END;
    END LOOP;
    v_found := COALESCE(v_found, '{}');

    v_allowed := spec.wanted
                 || ARRAY(SELECT DISTINCT f FROM unnest(v_found) AS f WHERE f <> ALL (spec.wanted) ORDER BY f);
    CONTINUE WHEN v_names = ARRAY[spec.con_name] AND v_allowed <@ v_found;

    FOREACH v_name IN ARRAY v_names LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', spec.tbl, v_name);
    END LOOP;
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (kind IN (%s))',
                   spec.tbl, spec.con_name,
                   (SELECT string_agg(quote_literal(v), ', ' ORDER BY o)
                      FROM unnest(v_allowed) WITH ORDINALITY AS u(v, o)));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Who asked for which address, for the limits in section 4. The form takes
--    whatever a visitor types, so only the sha256 of the address (trimmed and
--    lower-cased) is kept: enough to recognise the same address again. Rows
--    go after a day. RLS on, no policies, no grants: only the functions below
--    (running as the owner) read or write it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.password_reset_requests (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_sha256  BYTEA NOT NULL CHECK (octet_length(email_sha256) = 32),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_requests_email_idx
  ON private.password_reset_requests (email_sha256, requested_at);
-- The limit across all addresses, and the clean-up.
CREATE INDEX IF NOT EXISTS password_reset_requests_requested_idx
  ON private.password_reset_requests (requested_at);
REVOKE ALL ON private.password_reset_requests FROM PUBLIC, anon, authenticated;
ALTER TABLE private.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. A reset email never goes out with a dead link. Functions written before
--    reset emails existed burn a person's links without knowing about them:
--    admin_resend_welcome (and admin_change_user_email through it), a finished
--    welcome, Deactivate, losing the last organization. Each withdraws the
--    welcome emails itself; this withdraws the reset email that carries a link
--    the moment the link burns, if it is still waiting, and takes the token
--    out of its payload. It never fails the write that burned the link (at
--    worst a WARNING): a link must die even if its email cannot be withdrawn.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.withdraw_dead_reset_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    UPDATE public.email_outbox o
       SET status = 'suppressed', last_error = 'its reset link no longer works',
           payload = o.payload - 'setupToken', locked_at = NULL
     WHERE o.recipient_user_id = NEW.user_id AND o.kind = 'password_reset' AND o.status = 'pending'
       AND extensions.digest(o.payload->>'setupToken', 'sha256') = NEW.token_sha256;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'withdraw_dead_reset_email: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.withdraw_dead_reset_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS withdraw_dead_reset_email ON private.account_setup_tokens;
CREATE TRIGGER withdraw_dead_reset_email
  AFTER UPDATE OF used_at ON private.account_setup_tokens
  FOR EACH ROW WHEN (OLD.used_at IS NULL AND NEW.used_at IS NOT NULL AND NEW.kind = 'reset')
  EXECUTE FUNCTION private.withdraw_dead_reset_email();

-- ---------------------------------------------------------------------------
-- 4. request_password_reset — called by the web server, never the browser
-- ---------------------------------------------------------------------------
-- Gated by the email worker's secret, POST only, like the worker RPCs: the
-- browser asks our server, which holds the secret. 'queued': the email is on
-- its way. 'skipped': there is nobody to send it to (no login with that
-- address, an inactive account, or no active organization). The caller must
-- answer both the same way, so nobody learns whether an address has an
-- account; everything here a visitor could notice (the checks, the limits,
-- the request being counted) is the same either way.
-- 22023: an empty or invalid address. PT429: over a limit.
--
-- VOLATILE on purpose: each count after a lock takes a fresh snapshot, so it
-- sees the rows of the request that held the lock before it.
CREATE OR REPLACE FUNCTION public.request_password_reset(p_secret TEXT, p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(btrim(p_email));
  v_hash BYTEA;
  v_user_id UUID;
  v_address TEXT;
  v_name TEXT;
  v_status TEXT;
  v_org UUID;
  v_token TEXT;
  v_millis BIGINT;
BEGIN
  PERFORM private.email_worker_assert(p_secret);

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Enter your email address' USING ERRCODE = '22023';
  END IF;
  IF NOT private.onboarding_email_ok(v_email) THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023';
  END IF;
  v_hash := extensions.digest(v_email, 'sha256');

  -- One address, at most 5 requests an hour, whether or not it has an
  -- account. The lock makes parallel requests for one address take turns.
  -- A refused request is not counted, so it cannot keep the address locked.
  PERFORM pg_advisory_xact_lock(hashtextextended('password_reset:' || v_email, 0));
  IF (SELECT count(*) FROM (
        SELECT 1 FROM private.password_reset_requests r
        WHERE r.email_sha256 = v_hash AND r.requested_at > now() - interval '1 hour'
        LIMIT 5) recent) >= 5 THEN
    RAISE EXCEPTION 'A password reset has been requested 5 times for this address in the last hour. Try again later.'
      USING ERRCODE = 'PT429';
  END IF;
  DELETE FROM private.password_reset_requests WHERE requested_at < now() - interval '1 day';
  INSERT INTO private.password_reset_requests (email_sha256) VALUES (v_hash);

  -- The account, by its sign-in address in any case. A first look, without
  -- locks. (Two logins whose addresses differ only in case share a mailbox:
  -- the one typed exactly wins, else the one used most recently.)
  SELECT u.id, u.email,
         COALESCE(NULLIF(btrim(p.full_name), ''), u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
    INTO v_user_id, v_address, v_name
    FROM auth.users u
    JOIN public.profiles p ON p.user_id = u.id AND p.status = 'active'
   WHERE lower(u.email) = v_email
     AND EXISTS (SELECT 1 FROM public.organization_memberships m
                  WHERE m.user_id = u.id AND m.status = 'active')
   ORDER BY u.email = v_email DESC, u.last_sign_in_at DESC NULLS LAST, u.created_at, u.id
   LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN 'skipped';
  END IF;

  -- Then the checks that matter, on locked rows, in the order Deactivate
  -- writes them (the profile, then the membership). A Deactivate in flight
  -- makes this wait and then skip; one that starts after this waits for it,
  -- then burns the new link, which withdraws the email (section 3).
  SELECT p.status::text INTO v_status
    FROM public.profiles p
   WHERE p.user_id = v_user_id
   FOR SHARE;
  IF v_status IS DISTINCT FROM 'active' THEN
    RETURN 'skipped';
  END IF;
  -- The organization the email is sent for: their primary one, else the first
  -- they joined, of those still active.
  SELECT m.organization_id INTO v_org
    FROM public.organization_memberships m
   WHERE m.user_id = v_user_id AND m.status = 'active'
   ORDER BY m.is_primary DESC, m.created_at, m.organization_id
   LIMIT 1
   FOR SHARE OF m;
  IF v_org IS NULL THEN
    RETURN 'skipped';
  END IF;

  -- Only the newest email works: every earlier link burns (a welcome link too,
  -- so someone who never signed in gets in through this one instead), and the
  -- emails still waiting with one are withdrawn. Links first, then emails: the
  -- order the other functions take them in, so none of them wait on each other.
  UPDATE private.account_setup_tokens SET used_at = now()
   WHERE user_id = v_user_id AND used_at IS NULL;
  UPDATE public.email_outbox
     SET status = 'suppressed', last_error = 'superseded by a password reset',
         payload = payload - 'setupToken', locked_at = NULL
   WHERE recipient_user_id = v_user_id AND kind IN ('account_access', 'password_reset') AND status = 'pending';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO private.account_setup_tokens (user_id, token_sha256, kind, expires_at, created_by)
  VALUES (v_user_id, extensions.digest(v_token, 'sha256'), 'reset', now() + interval '1 hour', NULL);

  -- Two requests for one person never run at once (the address lock), but
  -- they can land in the same millisecond.
  v_millis := (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
  WHILE EXISTS (SELECT 1 FROM public.email_outbox o
                 WHERE o.dedupe_key = 'password_reset:' || v_user_id || ':' || v_millis) LOOP
    v_millis := v_millis + 1;
  END LOOP;
  INSERT INTO public.email_outbox
    (kind, dedupe_key, recipient_user_id, recipient_email, organization_id, actor_id, payload, expires_at)
  VALUES
    ('password_reset', 'password_reset:' || v_user_id || ':' || v_millis, v_user_id, v_address, v_org, NULL,
     jsonb_build_object('fullName', v_name, 'setupToken', v_token), now() + interval '1 hour');
  RETURN 'queued';
END;
$$;
REVOKE ALL ON FUNCTION public.request_password_reset(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
-- Like the worker RPCs: the server calls it with the publishable key, so anon
-- must be able to; the secret keeps everyone else out.
GRANT EXECUTE ON FUNCTION public.request_password_reset(TEXT, TEXT) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. complete_password_reset — the reset link's page
-- ---------------------------------------------------------------------------
-- The token is 256 random bits and works once, for an hour, only as a reset
-- link: a welcome link never resets a password here. A link for an account
-- that has since become inactive or lost its last active organization is dead
-- too. Every dead link gets the same words (P0001), so the page gives nothing
-- away. POST only: over GET the password would sit in a URL, and from there
-- in logs.
--
-- Afterwards the person's other sign-ins end (their sessions go, and the
-- refresh tokens with them; the page then signs them in afresh), every link
-- of theirs burns, the emails still waiting with one are withdrawn, and a
-- recovery code GoTrue sent them stops working. Returns their sign-in email.
CREATE OR REPLACE FUNCTION public.complete_password_reset(p_token TEXT, p_password TEXT)
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
    RAISE EXCEPTION 'complete_password_reset: call with POST' USING ERRCODE = '22023';
  END IF;

  -- The link before the password: a dead link is what the page must say, not
  -- that the new password is too short.
  IF p_token IS NOT NULL AND btrim(p_token) ~* '^[0-9a-f]{64}$' THEN
    SELECT t.id, t.user_id INTO v_token_id, v_user_id
      FROM private.account_setup_tokens t
     WHERE t.token_sha256 = extensions.digest(lower(btrim(p_token)), 'sha256')
       AND t.kind = 'reset' AND t.used_at IS NULL AND t.expires_at > now()
     FOR UPDATE;
  END IF;
  IF v_token_id IS NOT NULL THEN
    SELECT u.email INTO v_email
      FROM auth.users u
     WHERE u.id = v_user_id
     FOR UPDATE;
  END IF;
  IF v_email IS NULL OR btrim(v_email) = ''
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_user_id AND p.status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.organization_memberships m
                     WHERE m.user_id = v_user_id AND m.status = 'active') THEN
    RAISE EXCEPTION 'This link has expired or was already used' USING ERRCODE = 'P0001';
  END IF;

  IF p_password IS NULL OR char_length(p_password) < 8 THEN
    RAISE EXCEPTION 'Use at least 8 characters for your password' USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_password) > 72 THEN
    RAISE EXCEPTION 'Use at most 72 characters for your password' USING ERRCODE = '22023';
  END IF;

  UPDATE auth.users
     SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         email_confirmed_at = COALESCE(email_confirmed_at, now()),
         updated_at = now()
   WHERE id = v_user_id;

  UPDATE private.account_setup_tokens SET used_at = now()
   WHERE user_id = v_user_id AND used_at IS NULL;
  UPDATE public.email_outbox
     SET status = 'suppressed', last_error = 'password already reset',
         payload = payload - 'setupToken', locked_at = NULL
   WHERE recipient_user_id = v_user_id AND kind IN ('account_access', 'password_reset') AND status = 'pending';

  -- Whoever is still signed in as them (a stolen session, a shared computer)
  -- cannot renew that sign-in: the app checks the session and drops it, and
  -- a copied access token stops working when it expires, within the hour.
  -- As with Deactivate, trouble here only logs a WARNING: the new password
  -- must work either way.
  BEGIN
    DELETE FROM auth.sessions s WHERE s.user_id = v_user_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'complete_password_reset: could not end the sign-in sessions of %: %', v_user_id, SQLERRM;
  END;
  -- A recovery code or link GoTrue sent them (Lovable's hook still sends one to
  -- anyone who asks GoTrue directly) cannot change the password again. Blank,
  -- not NULL: GoTrue reads these columns into plain strings (see
  -- admin_create_user), and which of them exist differs between versions.
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema = 'auth' AND c.table_name = 'users' AND c.column_name = 'recovery_token') THEN
      EXECUTE 'UPDATE auth.users SET recovery_token = '''' WHERE id = $1' USING v_user_id;
    END IF;
    IF to_regclass('auth.one_time_tokens') IS NOT NULL THEN
      EXECUTE 'DELETE FROM auth.one_time_tokens WHERE user_id = $1 AND token_type::text = ''recovery_token'''
        USING v_user_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'complete_password_reset: could not cancel the GoTrue recovery codes of %: %', v_user_id, SQLERRM;
  END;

  RETURN v_email;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_password_reset(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_password_reset(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The email worker's claim, as in 20260927000000_admin_onboarding.sql
--    except for its order: a password reset (or a welcome) is claimed before
--    anything else. Every scheduled row expires at its send window's end, so
--    in a window's last hour it would otherwise sort ahead of a reset whose
--    link has the full hour to run, and a backlog could hold the reset back.
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

  -- Someone waiting at a sign-in page first: a password reset or a welcome
  -- goes before anything else, so a backlog late in a send window (whose rows
  -- expire before a reset's hour is up) cannot hold it back. Then soonest to
  -- expire: a scheduled row lives 3 hours, an event row 48, so a backlog of
  -- event email cannot expire the day's digests. Rows of one send window share
  -- expires_at; within it, one email per person (digests, summaries) goes
  -- before the per-task reminders a bulk import can multiply.
  WITH picked AS (
    SELECT id
    FROM public.email_outbox
    WHERE status = 'pending' AND not_before <= now() AND expires_at > now()
    ORDER BY kind NOT IN ('password_reset', 'account_access'), expires_at,
             kind IN ('due_reminder', 'overdue_alert'), created_at, id
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
         ORDER BY t.kind NOT IN ('password_reset', 'account_access'), t.expires_at,
                  t.kind IN ('due_reminder', 'overdue_alert'), t.created_at, t.id), '[]'::jsonb)
    INTO claimed
    FROM taken t;
  RETURN claimed;
END;
$$;
