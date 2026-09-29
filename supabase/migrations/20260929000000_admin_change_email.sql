-- ============================================================================
-- FlowDesk — correct a person's sign-in email before their first sign-in
-- ============================================================================
-- A welcome email sent to a mistyped address could not be fixed: Edit User
-- locks the email, and changing a login needs the auth schema, which the app
-- cannot write. admin_change_user_email puts the right address on the account
-- and sends the welcome again, to it.
--
-- Only before the first sign-in. From then on the address is how the person
-- gets in, and an admin who could change it could send Forgot password to
-- themselves and sign in as them. Before it, nothing in the account is theirs.
--
-- The caller must be an admin of every organization the person belongs to,
-- whatever the membership's status: otherwise an admin of one could point a
-- shared person's login at their own mailbox and reach the others.
--
-- Nothing tied to the old address keeps working: unused welcome links, a
-- welcome still waiting to go out, and any code or link GoTrue sent there
-- (confirmation, recovery, magic link). The new welcome is sent through
-- admin_resend_welcome, so it counts towards the same limits.
--
-- Needs 20260927000000_admin_onboarding.sql. Idempotent.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.admin_resend_welcome(uuid)') IS NULL
     OR to_regprocedure('private.onboarding_email_ok(text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20260927000000_admin_onboarding.sql before this migration';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_change_user_email(p_user_id UUID, p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_email TEXT := lower(btrim(p_email));
  v_status TEXT;
  v_name TEXT;
  v_old_email TEXT;
  v_last_sign_in TIMESTAMPTZ;
  v_set TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Sign in to change a sign-in email' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Choose a person' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_caller THEN
    RAISE EXCEPTION 'You can''t change your own sign-in email here' USING ERRCODE = '42501';
  END IF;
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Enter an email address' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_email) > 254 THEN
    RAISE EXCEPTION 'An email address can be at most 254 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT private.onboarding_email_ok(v_email) THEN
    RAISE EXCEPTION 'Enter a valid email address' USING ERRCODE = '22023';
  END IF;

  -- A first look, without locks, so a stranger learns nothing about the person.
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
     WHERE m.user_id = p_user_id
       AND private.has_organization_role(v_caller, m.organization_id, 'admin')
  ) THEN
    RAISE EXCEPTION 'Only an admin of their organizations can change their sign-in email'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_caller AND p.status = 'active') THEN
    RAISE EXCEPTION 'Your account is inactive, so you cannot change sign-in emails' USING ERRCODE = '42501';
  END IF;

  -- The checks that matter, on locked rows, in the order Deactivate and
  -- admin_resend_welcome take them: the profile, then the memberships.
  SELECT p.status::text, COALESCE(NULLIF(btrim(p.full_name), ''), 'They')
    INTO v_status, v_name
    FROM public.profiles p
   WHERE p.user_id = p_user_id
   FOR SHARE;
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Their account is inactive. Make it active first, then change the email.'
      USING ERRCODE = '22023';
  END IF;
  -- Locked, so a membership added in another organization meanwhile waits.
  PERFORM 1 FROM public.organization_memberships m WHERE m.user_id = p_user_id FOR SHARE OF m;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.organization_memberships m
     WHERE m.user_id = p_user_id
       AND NOT private.has_organization_role(v_caller, m.organization_id, 'admin')
  ) THEN
    RAISE EXCEPTION 'They are also in an organization you are not an admin of, so only an admin of all their organizations can change their sign-in email'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.email, u.last_sign_in_at INTO v_old_email, v_last_sign_in
    FROM auth.users u
   WHERE u.id = p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose a person' USING ERRCODE = '22023';
  END IF;
  IF v_last_sign_in IS NOT NULL THEN
    RAISE EXCEPTION '% has already signed in with %, so their sign-in email can no longer be changed here',
      v_name, v_old_email USING ERRCODE = '22023';
  END IF;
  IF lower(v_old_email) = v_email THEN
    RAISE EXCEPTION 'That is already their sign-in email' USING ERRCODE = '22023';
  END IF;

  -- One address, one account (the same lock admin_create_user takes).
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding_email:' || v_email, 0));
  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email AND u.id <> p_user_id) THEN
    RAISE EXCEPTION 'This email already has an account' USING ERRCODE = '23505';
  END IF;

  BEGIN
    UPDATE auth.users
       SET email = v_email,
           raw_user_meta_data = CASE
             WHEN raw_user_meta_data ? 'email'
               THEN raw_user_meta_data || jsonb_build_object('email', v_email)
             ELSE raw_user_meta_data END,
           updated_at = now()
     WHERE id = p_user_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This email already has an account' USING ERRCODE = '23505';
  END;

  -- Codes GoTrue sent to the old address stop working. Blank, not NULL: GoTrue
  -- reads these columns into plain strings (see admin_create_user), and which
  -- of them exist differs between versions.
  SELECT string_agg(format('%I = %L', c.column_name, ''), ', ')
    INTO v_set
    FROM information_schema.columns c
   WHERE c.table_schema = 'auth' AND c.table_name = 'users'
     AND c.column_name IN ('confirmation_token', 'recovery_token', 'email_change',
                           'email_change_token_new', 'email_change_token_current');
  IF v_set IS NOT NULL THEN
    EXECUTE format('UPDATE auth.users SET %s WHERE id = $1', v_set) USING p_user_id;
  END IF;
  -- When those were sent: GoTrue makes the address wait before it sends
  -- another, and the new address has been sent nothing.
  SELECT string_agg(format('%I = NULL', c.column_name), ', ')
    INTO v_set
    FROM information_schema.columns c
   WHERE c.table_schema = 'auth' AND c.table_name = 'users'
     AND c.column_name IN ('confirmation_sent_at', 'recovery_sent_at', 'email_change_sent_at');
  IF v_set IS NOT NULL THEN
    EXECUTE format('UPDATE auth.users SET %s WHERE id = $1', v_set) USING p_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns c
             WHERE c.table_schema = 'auth' AND c.table_name = 'users'
               AND c.column_name = 'email_change_confirm_status') THEN
    EXECUTE 'UPDATE auth.users SET email_change_confirm_status = 0 WHERE id = $1' USING p_user_id;
  END IF;
  IF to_regclass('auth.one_time_tokens') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.one_time_tokens WHERE user_id = $1' USING p_user_id;
  END IF;

  -- The email identity carries the address too (identities.email is generated
  -- from it). provider_id is the user's id, so it stays.
  UPDATE auth.identities
     SET identity_data = identity_data || jsonb_build_object('email', v_email),
         updated_at = now()
   WHERE user_id = p_user_id AND provider = 'email';

  -- profiles.email follows through sync_profile_email. The welcome goes again,
  -- to the new address; earlier links and a waiting welcome are withdrawn.
  PERFORM public.admin_resend_welcome(p_user_id);

  RETURN v_email;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_change_user_email(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_change_user_email(UUID, TEXT) TO authenticated;
