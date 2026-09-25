-- ============================================================================
-- FlowDesk — email notifications.
--
-- Three kinds of email are raised by the database itself, the moment the thing
-- happens, so no code path in the app can forget to send them:
--   task_assigned       a task is given to someone other than the person acting
--   project_invitation  someone is added to a project team by someone else
--   account_access      an admin gives a person who has never signed in their
--                       first organization (this is how a new person gets in)
-- The scheduled kinds (reminders, overdue alerts, digests, management summaries)
-- are planned by the email worker in the web server, which reads everything it
-- needs through one snapshot RPC and queues its rows through another.
--
-- Everything goes through public.email_outbox. Nobody but the worker reads it:
-- RLS is on with no policies, and the worker's RPCs are gated by a shared secret
-- whose sha256 alone lives in private.email_worker_config. The worker calls them
-- with the publishable key, so no service-role key has to live on the server.
--
-- Email must never cost anyone a write: every email trigger here swallows its
-- own errors with a WARNING and lets the write go through.
--
-- Mail only ever goes to auth.users.email, which changes only once the new
-- address confirms it. profiles.email is a display copy users cannot rewrite,
-- and only admins change a profile's status. One account can queue at most 50
-- event emails an hour. Task, project and milestone dates must have a 4-digit
-- year (section 2c).
--
-- Idempotent throughout.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Prerequisites. Fail loudly and early rather than half-way through.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
BEGIN
  IF to_regclass('public.project_members') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email') THEN
    RAISE EXCEPTION 'Apply 20260922000000_admin_persistence.sql before the email notifications migration';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.email_iso(_ts TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT to_char(_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
REVOKE ALL ON FUNCTION private.email_iso(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Organization email settings. No row means every default below, which
--    must stay in step with DEFAULT_EMAIL_SETTINGS in src/lib/email/kinds.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_settings (
  organization_id     UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  project_invitation  BOOLEAN NOT NULL DEFAULT true,
  task_assigned       BOOLEAN NOT NULL DEFAULT true,
  due_reminder        BOOLEAN NOT NULL DEFAULT true,
  overdue_alert       BOOLEAN NOT NULL DEFAULT true,
  daily_digest        BOOLEAN NOT NULL DEFAULT true,
  weekly_digest       BOOLEAN NOT NULL DEFAULT true,
  daily_management    BOOLEAN NOT NULL DEFAULT true,
  weekly_management   BOOLEAN NOT NULL DEFAULT true,
  send_hour           SMALLINT NOT NULL DEFAULT 8 CHECK (send_hour BETWEEN 0 AND 23),
  working_days        SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}'
                        CHECK (array_ndims(working_days) = 1
                               AND cardinality(working_days) BETWEEN 1 AND 7
                               AND array_position(working_days, NULL) IS NULL
                               AND working_days <@ '{1,2,3,4,5,6,7}'::SMALLINT[]),
  weekly_day          SMALLINT NOT NULL DEFAULT 1 CHECK (weekly_day BETWEEN 1 AND 7),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          UUID DEFAULT auth.uid()
);
REVOKE ALL ON public.email_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.email_settings TO authenticated;
GRANT ALL ON public.email_settings TO service_role;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view organization email settings" ON public.email_settings;
CREATE POLICY "Members can view organization email settings" ON public.email_settings
  FOR SELECT TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Admins can create organization email settings" ON public.email_settings;
CREATE POLICY "Admins can create organization email settings" ON public.email_settings
  FOR INSERT TO authenticated
  WITH CHECK (private.has_organization_role(auth.uid(), organization_id, 'admin'));

DROP POLICY IF EXISTS "Admins can update organization email settings" ON public.email_settings;
CREATE POLICY "Admins can update organization email settings" ON public.email_settings
  FOR UPDATE TO authenticated
  USING (private.has_organization_role(auth.uid(), organization_id, 'admin'))
  WITH CHECK (private.has_organization_role(auth.uid(), organization_id, 'admin'));

-- An upsert only writes the columns it sends, so the column default alone would
-- leave updated_by naming whoever created the row, not whoever last changed it.
CREATE OR REPLACE FUNCTION private.stamp_email_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.stamp_email_settings() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS stamp_email_settings_before ON public.email_settings;
CREATE TRIGGER stamp_email_settings_before BEFORE INSERT OR UPDATE ON public.email_settings
  FOR EACH ROW EXECUTE FUNCTION private.stamp_email_settings();

-- ---------------------------------------------------------------------------
-- 2. Personal notification preferences. No row means every kind is on.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id             UUID PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  project_invitation  BOOLEAN NOT NULL DEFAULT true,
  task_assigned       BOOLEAN NOT NULL DEFAULT true,
  due_reminder        BOOLEAN NOT NULL DEFAULT true,
  overdue_alert       BOOLEAN NOT NULL DEFAULT true,
  daily_digest        BOOLEAN NOT NULL DEFAULT true,
  weekly_digest       BOOLEAN NOT NULL DEFAULT true,
  daily_management    BOOLEAN NOT NULL DEFAULT true,
  weekly_management   BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON public.notification_preferences FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "People can view their own notification preferences" ON public.notification_preferences;
CREATE POLICY "People can view their own notification preferences" ON public.notification_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "People can create their own notification preferences" ON public.notification_preferences;
CREATE POLICY "People can create their own notification preferences" ON public.notification_preferences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "People can update their own notification preferences" ON public.notification_preferences;
CREATE POLICY "People can update their own notification preferences" ON public.notification_preferences
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2b. The "update own profile" policy covers every column. profiles.email is
--     the copy of auth.users.email that sync_profile_email (running as owner)
--     keeps, and profiles.status is how an admin switches a person off: nobody
--     may rewrite their own address, and only admins (of any organization) may
--     change their own status. current_user must be the caller's role.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS keep_profile_email_before ON public.profiles;
DROP FUNCTION IF EXISTS private.keep_profile_email();

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
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.user_id = auth.uid()
     AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m
                     WHERE m.user_id = auth.uid()
                       AND private.has_organization_role(auth.uid(), m.organization_id, 'admin')) THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_profile_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_profile_update_before ON public.profiles;
CREATE TRIGGER guard_profile_update_before BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.guard_profile_update();

-- ---------------------------------------------------------------------------
-- 2c. Task, project and milestone dates need a 4-digit year, as
--     src/lib/task-validation.ts says; a stored 20266-09-02 broke every screen
--     and email that read it. The trigger arguments name the DATE columns, and
--     only a column being written is checked, so an old bad value never blocks
--     other edits. An occurrence made by the SECURITY DEFINER recurrence
--     generator copies the previous date and is not checked (raising would fail
--     the completion or pg_cron batch behind it); one inserted by hand is.
--     current_user must be the caller's role.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS validate_work_task_dates_before ON public.work_tasks;
DROP FUNCTION IF EXISTS private.validate_work_task_dates();

CREATE OR REPLACE FUNCTION private.validate_four_digit_years()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  col TEXT;
  new_value DATE;
  old_value DATE;
BEGIN
  IF TG_TABLE_NAME = 'work_tasks' AND TG_OP = 'INSERT'
     AND current_user NOT IN ('authenticated', 'anon')
     AND to_jsonb(NEW)->>'recurrence_id' IS NOT NULL
     AND COALESCE((to_jsonb(NEW)->>'occurrence_number')::INTEGER, 1) > 1 THEN
    RETURN NEW;
  END IF;
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I', col) INTO new_value USING NEW;
    IF TG_OP = 'UPDATE' THEN
      EXECUTE format('SELECT ($1).%I', col) INTO old_value USING OLD;
      CONTINUE WHEN new_value IS NOT DISTINCT FROM old_value;
    END IF;
    IF new_value NOT BETWEEN DATE '1000-01-01' AND DATE '9999-12-31' THEN
      RAISE EXCEPTION 'Enter a % with a 4-digit year', replace(col, '_', ' ')
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_four_digit_years() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_work_task_dates_before
  BEFORE INSERT OR UPDATE OF start_date, due_date ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.validate_four_digit_years('start_date', 'due_date');
DROP TRIGGER IF EXISTS validate_work_project_dates_before ON public.work_projects;
CREATE TRIGGER validate_work_project_dates_before
  BEFORE INSERT OR UPDATE OF start_date, due_date ON public.work_projects
  FOR EACH ROW EXECUTE FUNCTION private.validate_four_digit_years('start_date', 'due_date');
DROP TRIGGER IF EXISTS validate_project_milestone_dates_before ON public.project_milestones;
CREATE TRIGGER validate_project_milestone_dates_before
  BEFORE INSERT OR UPDATE OF due_date ON public.project_milestones
  FOR EACH ROW EXECUTE FUNCTION private.validate_four_digit_years('due_date');

-- ---------------------------------------------------------------------------
-- 3. The outbox. No foreign keys on purpose: a row must outlive the task,
--    project or person it mentions, and the worker suppresses stale ones.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               TEXT NOT NULL CHECK (kind IN (
                       'account_access', 'project_invitation', 'task_assigned',
                       'due_reminder', 'overdue_alert', 'daily_digest', 'weekly_digest',
                       'daily_management', 'weekly_management')),
  dedupe_key         TEXT NOT NULL UNIQUE,
  recipient_user_id  UUID,
  recipient_email    TEXT,
  organization_id    UUID,
  task_id            UUID,
  project_id         UUID,
  actor_id           UUID,
  payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'expired', 'suppressed')),
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  not_before         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  locked_at          TIMESTAMPTZ,
  sent_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_outbox_status_not_before_idx ON public.email_outbox (status, not_before);
CREATE INDEX IF NOT EXISTS email_outbox_recipient_kind_created_idx
  ON public.email_outbox (recipient_user_id, kind, created_at);
CREATE INDEX IF NOT EXISTS email_outbox_actor_created_idx ON public.email_outbox (actor_id, created_at)
  WHERE actor_id IS NOT NULL;
REVOKE ALL ON public.email_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.email_outbox TO service_role;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. The worker secret. Only its sha256 is stored; an admin sets it with
--
--   INSERT INTO private.email_worker_config (id, secret_sha256)
--   VALUES (1, decode('<64 hex chars: sha256 of the secret>', 'hex'))
--   ON CONFLICT (id) DO UPDATE SET secret_sha256 = EXCLUDED.secret_sha256, updated_at = now();
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.email_worker_config (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  secret_sha256  BYTEA NOT NULL CHECK (octet_length(secret_sha256) = 32),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON private.email_worker_config FROM PUBLIC, anon, authenticated;
ALTER TABLE private.email_worker_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.email_worker_assert(p_secret TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- PostgREST also serves functions over GET, which would put the secret in a
  -- query string and from there in access logs. Refuse it, so nothing is ever
  -- built that way. request.method is unset outside PostgREST.
  IF COALESCE(current_setting('request.method', true), '') NOT IN ('', 'POST') THEN
    RAISE EXCEPTION 'email worker: call with POST' USING ERRCODE = '28000';
  END IF;
  IF p_secret IS NULL OR length(p_secret) < 32 OR NOT EXISTS (
    SELECT 1 FROM private.email_worker_config c
    WHERE c.id = 1 AND c.secret_sha256 = extensions.digest(p_secret, 'sha256')
  ) THEN
    RAISE EXCEPTION 'email worker: unauthorized' USING ERRCODE = '28000';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.email_worker_assert(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Event emails, raised by the write itself
-- ---------------------------------------------------------------------------

-- The mailbox is shared with the CRM, so one account (or one bulk POST) must
-- not be able to queue thousands of emails. Past the cap the write still goes
-- through; the person sees the work in their digest instead. The lock, held to
-- commit, makes parallel requests by one account take turns, and the count
-- after it takes a fresh READ COMMITTED snapshot that sees the previous turn's
-- rows. Keep it VOLATILE plpgsql, or the count reuses the pre-lock snapshot.
-- lock_timeout: a statement_timeout during the wait would cancel the user's
-- whole write, which the triggers' WHEN OTHERS cannot catch; a lock timeout
-- (55P03) is caught, so a slow turn costs only the email, never the write.
-- Welcome emails are neither capped nor counted: only admins can queue them.
CREATE OR REPLACE FUNCTION private.email_actor_over_cap(_actor UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SET search_path = public
SET lock_timeout = '1s'
AS $$
BEGIN
  IF _actor IS NULL THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('email_cap:' || _actor, 0));
  RETURN (
    SELECT count(*) FROM (
      SELECT 1 FROM public.email_outbox o
      WHERE o.actor_id = _actor AND o.created_at > now() - interval '1 hour'
        AND o.kind IN ('task_assigned', 'project_invitation')
      LIMIT 50
    ) recent
  ) >= 50;
END;
$$;
REVOKE ALL ON FUNCTION private.email_actor_over_cap(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.enqueue_task_assigned_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID;
  new_key TEXT;
BEGIN
  BEGIN
    IF NEW.assignee_id IS NULL OR NEW.archived_at IS NOT NULL
       OR NEW.status IN ('done', 'cancelled') THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.assignee_id IS NOT DISTINCT FROM OLD.assignee_id THEN
        RETURN NEW;
      END IF;
    END IF;
    -- The next occurrence of a recurring task is inserted inside whichever
    -- transaction closed the previous one. The assignment is the recurrence
    -- creator's (create_next_recurring_task copies created_by), not the closer's.
    actor := CASE
               WHEN TG_OP = 'INSERT' AND NEW.recurrence_id IS NOT NULL
                    AND COALESCE(NEW.occurrence_number, 1) > 1 THEN NEW.created_by
               ELSE COALESCE(auth.uid(), NEW.created_by)
             END;
    IF NEW.assignee_id IS NOT DISTINCT FROM actor THEN
      RETURN NEW;
    END IF;
    IF private.email_actor_over_cap(actor) THEN
      RAISE WARNING 'enqueue_task_assigned_email: actor % reached the hourly email cap; not queued', actor;
      RETURN NEW;
    END IF;

    new_key := 'task_assigned:' || NEW.id || ':' || NEW.assignee_id || ':' || txid_current();
    -- Assign, unassign, reassign before the next tick: one email, not two.
    UPDATE public.email_outbox
       SET status = 'suppressed', last_error = 'superseded by a later assignment'
     WHERE status = 'pending' AND kind = 'task_assigned'
       AND task_id = NEW.id AND recipient_user_id = NEW.assignee_id AND dedupe_key <> new_key;
    INSERT INTO public.email_outbox
      (kind, dedupe_key, recipient_user_id, organization_id, task_id, project_id, actor_id, expires_at)
    VALUES
      ('task_assigned', new_key, NEW.assignee_id, NEW.organization_id, NEW.id, NEW.project_id, actor,
       now() + interval '48 hours')
    ON CONFLICT (dedupe_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_task_assigned_email: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_task_assigned_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enqueue_task_assigned_email_after ON public.work_tasks;
CREATE TRIGGER enqueue_task_assigned_email_after AFTER INSERT OR UPDATE OF assignee_id ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_task_assigned_email();

CREATE OR REPLACE FUNCTION private.enqueue_project_invitation_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID;
  new_key TEXT;
BEGIN
  BEGIN
    actor := auth.uid();
    IF NEW.user_id IS NOT DISTINCT FROM actor THEN
      RETURN NEW;
    END IF;
    IF private.email_actor_over_cap(actor) THEN
      RAISE WARNING 'enqueue_project_invitation_email: actor % reached the hourly email cap; not queued', actor;
      RETURN NEW;
    END IF;

    new_key := 'project_invitation:' || NEW.project_id || ':' || NEW.user_id || ':' || txid_current();
    -- Removed from the team and added back before the next tick: one email.
    UPDATE public.email_outbox
       SET status = 'suppressed', last_error = 'superseded by a later invitation'
     WHERE status = 'pending' AND kind = 'project_invitation'
       AND project_id = NEW.project_id AND recipient_user_id = NEW.user_id AND dedupe_key <> new_key;
    INSERT INTO public.email_outbox
      (kind, dedupe_key, recipient_user_id, organization_id, project_id, actor_id, payload, expires_at)
    SELECT 'project_invitation', new_key, NEW.user_id, p.organization_id, NEW.project_id, actor,
           jsonb_build_object('roleLabel', NEW.role_label), now() + interval '48 hours'
    FROM public.work_projects p
    WHERE p.id = NEW.project_id
    ON CONFLICT (dedupe_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_project_invitation_email: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_project_invitation_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enqueue_project_invitation_email_after ON public.project_members;
CREATE TRIGGER enqueue_project_invitation_email_after AFTER INSERT ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_project_invitation_email();

-- The welcome goes out when an admin first gives a person an organization, not
-- when the login is created: anyone who can sign up (or ask for an OTP with
-- create_user) can make a login for any address, but only an admin can add a
-- membership. Once per person, and only if they have never signed in. Rows of
-- one transaction share now(), so two organizations at once still count.
DROP TRIGGER IF EXISTS zz_enqueue_account_access_email ON auth.users;

CREATE OR REPLACE FUNCTION private.enqueue_account_access_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor UUID;
  to_email TEXT;
  to_name TEXT;
BEGIN
  BEGIN
    IF NEW.status <> 'active' OR EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = NEW.user_id AND m.id <> NEW.id AND m.created_at < now()
    ) THEN
      RETURN NEW;
    END IF;
    SELECT u.email, COALESCE(NULLIF(btrim(p.full_name), ''), u.raw_user_meta_data->>'full_name',
                             u.raw_user_meta_data->>'name')
      INTO to_email, to_name
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.user_id = u.id
     WHERE u.id = NEW.user_id AND u.email IS NOT NULL AND u.last_sign_in_at IS NULL;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    -- Not capped: only an admin can add a membership, and a skipped welcome
    -- would be lost for good (the next membership is no longer the first).
    actor := auth.uid();
    INSERT INTO public.email_outbox
      (kind, dedupe_key, recipient_user_id, recipient_email, organization_id, actor_id, payload, expires_at)
    VALUES
      ('account_access', 'account_access:' || NEW.user_id, NEW.user_id, to_email,
       NEW.organization_id, actor, jsonb_build_object('fullName', to_name), now() + interval '7 days')
    ON CONFLICT (dedupe_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_account_access_email: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_account_access_email() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enqueue_account_access_email_after ON public.organization_memberships;
CREATE TRIGGER enqueue_account_access_email_after AFTER INSERT ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_account_access_email();

-- ---------------------------------------------------------------------------
-- 6. Worker RPCs. Shapes match src/lib/email/snapshot.ts key for key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_worker_snapshot(p_secret TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.email_worker_assert(p_secret);

  RETURN jsonb_build_object(
    'generatedAt', private.email_iso(now()),
    -- An inactive organization sends nothing, whatever its settings say.
    'organizations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', o.id,
               'name', o.name,
               'timezone', o.timezone,
               'settings', jsonb_build_object(
                 'enabled',            o.status = 'active' AND COALESCE(s.enabled, true),
                 'project_invitation', COALESCE(s.project_invitation, true),
                 'task_assigned',      COALESCE(s.task_assigned, true),
                 'due_reminder',       COALESCE(s.due_reminder, true),
                 'overdue_alert',      COALESCE(s.overdue_alert, true),
                 'daily_digest',       COALESCE(s.daily_digest, true),
                 'weekly_digest',      COALESCE(s.weekly_digest, true),
                 'daily_management',   COALESCE(s.daily_management, true),
                 'weekly_management',  COALESCE(s.weekly_management, true),
                 'sendHour',           COALESCE(s.send_hour, 8),
                 'workingDays',        to_jsonb(COALESCE(s.working_days, '{1,2,3,4,5}'::SMALLINT[])),
                 'weeklyDay',          COALESCE(s.weekly_day, 1)))
             ORDER BY o.name)
      FROM public.organizations o
      LEFT JOIN public.email_settings s ON s.organization_id = o.id
    ), '[]'::jsonb),
    -- The sign-in address, never profiles.email (see 2b).
    'people', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'userId', p.user_id,
               'fullName', p.full_name,
               'username', p.username,
               'email', u.email,
               'status', p.status::text)
             ORDER BY p.user_id)
      FROM public.profiles p
      LEFT JOIN auth.users u ON u.id = p.user_id
    ), '[]'::jsonb),
    'preferences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'userId', n.user_id,
               'project_invitation', n.project_invitation,
               'task_assigned', n.task_assigned,
               'due_reminder', n.due_reminder,
               'overdue_alert', n.overdue_alert,
               'daily_digest', n.daily_digest,
               'weekly_digest', n.weekly_digest,
               'daily_management', n.daily_management,
               'weekly_management', n.weekly_management)
             ORDER BY n.user_id)
      FROM public.notification_preferences n
    ), '[]'::jsonb),
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'userId', m.user_id,
               'organizationId', m.organization_id,
               'isPrimary', m.is_primary,
               'status', m.status::text)
             ORDER BY m.user_id, m.organization_id)
      FROM public.organization_memberships m
    ), '[]'::jsonb),
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'userId', r.user_id,
               'organizationId', r.organization_id,
               'role', r.role::text)
             ORDER BY r.user_id, r.organization_id, r.role)
      FROM public.user_roles r
    ), '[]'::jsonb),
    'projects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id,
               'organizationId', p.organization_id,
               'name', p.name,
               'status', p.status::text,
               'startDate', p.start_date,
               'dueDate', p.due_date,
               'archivedAt', private.email_iso(p.archived_at))
             ORDER BY p.created_at, p.id)
      FROM public.work_projects p
      WHERE p.archived_at IS NULL
    ), '[]'::jsonb),
    'projectMembers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'projectId', pm.project_id,
               'userId', pm.user_id,
               'roleLabel', pm.role_label)
             ORDER BY pm.project_id, pm.user_id)
      FROM public.project_members pm
    ), '[]'::jsonb),
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id,
               'organizationId', t.organization_id,
               'projectId', t.project_id,
               'title', t.title,
               'status', t.status::text,
               'priority', t.priority::text,
               'assigneeId', t.assignee_id,
               'reviewerId', t.reviewer_id,
               'createdBy', t.created_by,
               'dueDate', t.due_date,
               'dueAt', private.email_iso(t.due_at),
               'blocked', t.blocked,
               'progress', t.progress,
               'completedAt', private.email_iso(t.completed_at),
               'archivedAt', private.email_iso(t.archived_at),
               'createdAt', private.email_iso(t.created_at))
             ORDER BY t.created_at, t.id)
      FROM public.work_tasks t
      WHERE t.archived_at IS NULL
        -- Closed work is never archived automatically, so without a bound this
        -- grows forever (and the anon role has a 3 s statement timeout). The
        -- digests look back 7 days plus working-day slack; older closed tasks
        -- only count towards projectCounts. cancelled has no completed_at.
        AND (t.status NOT IN ('done', 'cancelled')
             OR COALESCE(t.completed_at, t.updated_at) >= now() - interval '15 days')
    ), '[]'::jsonb),
    'projectCounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'projectId', p.id,
               'total', COALESCE(c.total, 0),
               'done', COALESCE(c.done, 0))
             ORDER BY p.created_at, p.id)
      FROM public.work_projects p
      LEFT JOIN (
        SELECT t.project_id,
               count(*) FILTER (WHERE t.status <> 'cancelled') AS total,
               count(*) FILTER (WHERE t.status = 'done') AS done
        FROM public.work_tasks t
        WHERE t.archived_at IS NULL AND t.project_id IS NOT NULL
        GROUP BY t.project_id
      ) c ON c.project_id = p.id
      WHERE p.archived_at IS NULL
    ), '[]'::jsonb),
    'priorityLabels', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'organizationId', l.organization_id,
               'value', l.value::text,
               'label', l.label)
             ORDER BY l.organization_id, l.sort_order)
      FROM public.task_priority_settings l
    ), '[]'::jsonb),
    'statusLabels', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'organizationId', l.organization_id,
               'value', l.value::text,
               'label', l.label)
             ORDER BY l.organization_id, l.sort_order)
      FROM public.task_status_settings l
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.email_worker_enqueue(p_secret TEXT, p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted INTEGER;
BEGIN
  PERFORM private.email_worker_assert(p_secret);
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'email_worker_enqueue: p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;

  -- Each tick plans afresh, so the planner's per-pass limit is not enough on its
  -- own: new reminder/alert rows only fill what is left of the person's 10 for
  -- that local day, counting rows queued by earlier ticks. The planner sends
  -- them most urgent first, so the most urgent new ones take the free places.
  WITH incoming AS (
    SELECT r, ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(r, ord)
    WHERE r->>'kind' IN ('due_reminder', 'overdue_alert', 'daily_digest', 'weekly_digest',
                         'daily_management', 'weekly_management')
      AND r->>'dedupeKey' IS NOT NULL
      AND r->>'recipientUserId' IS NOT NULL
      AND r->>'expiresAt' IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.email_outbox o WHERE o.dedupe_key = r->>'dedupeKey')
  ),
  ranked AS (
    SELECT r, row_number() OVER (
             PARTITION BY r->>'recipientUserId', r->>'kind', r->'payload'->>'localDate'
             ORDER BY ord) AS place
    FROM incoming
  ),
  allowed AS (
    SELECT r FROM ranked
    WHERE r->>'kind' NOT IN ('due_reminder', 'overdue_alert')
       OR place + (SELECT count(*) FROM public.email_outbox o
                   WHERE o.recipient_user_id = (r->>'recipientUserId')::uuid
                     AND o.kind = r->>'kind'
                     AND o.payload->>'localDate' = r->'payload'->>'localDate'
                     AND o.created_at > now() - interval '2 days') <= 10
  ),
  ins AS (
    INSERT INTO public.email_outbox
      (kind, dedupe_key, recipient_user_id, organization_id, task_id, project_id,
       payload, not_before, expires_at)
    SELECT r->>'kind',
           r->>'dedupeKey',
           (r->>'recipientUserId')::uuid,
           (r->>'organizationId')::uuid,
           (r->>'taskId')::uuid,
           (r->>'projectId')::uuid,
           CASE WHEN jsonb_typeof(r->'payload') = 'object' THEN r->'payload' ELSE '{}'::jsonb END,
           COALESCE((r->>'notBefore')::timestamptz, now()),
           (r->>'expiresAt')::timestamptz
    FROM allowed
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO inserted FROM ins;
  RETURN inserted;
END;
$$;

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
     SET status = 'expired', locked_at = NULL
   WHERE status = 'pending' AND expires_at <= now();

  -- A worker that died mid-send leaves its rows 'sending'. Give them back, but
  -- not forever: a row that keeps killing the worker stops at five attempts.
  UPDATE public.email_outbox
     SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
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

REVOKE ALL ON FUNCTION public.email_worker_snapshot(TEXT), public.email_worker_enqueue(TEXT, JSONB),
  public.email_worker_claim(TEXT, INTEGER), public.email_worker_complete(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_worker_snapshot(TEXT), public.email_worker_enqueue(TEXT, JSONB),
  public.email_worker_claim(TEXT, INTEGER), public.email_worker_complete(TEXT, JSONB)
  TO anon, authenticated, service_role;
