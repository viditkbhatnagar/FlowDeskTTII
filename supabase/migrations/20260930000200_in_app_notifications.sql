-- ============================================================================
-- FlowDesk — in-app notifications (QA, 29 Sep 2026)
-- ============================================================================
-- QA: "Notification box / pop up / or sound as the project and task moves
-- forward. ... I created a project and added a member, what task I asked was
-- done but I didn't get notified; only when the person texted me on WhatsApp
-- did I know things were added."
--
-- One row per person per event, written only by the database (triggers on the
-- tables where the change happens; clients cannot create them). The app shows
-- them under a bell with a pop-up and a sound, live through Supabase Realtime
-- with polling as a fallback.
--
--   task_assigned            you were given a task
--   task_review_requested    a task you review was sent for review
--   task_completed           a task you created, own, review or run the
--                            project of was completed
--   task_status_changed      …moved to another status
--   task_commented           someone commented on such a task (or one you
--                            commented on)
--   task_created_in_project  a task was added to a project you own or manage
--   project_member_added     you were added to a project
--
-- Nobody is told about their own action, nor about a task or project they
-- cannot open. Names, titles and statuses are copied into the row, so it reads
-- the same later. Read ones go after 30 days, all after 90.
--
-- Needs 20260930000100_project_access.sql. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN (
                     'task_assigned', 'task_review_requested', 'task_completed', 'task_status_changed',
                     'task_commented', 'task_created_in_project', 'project_member_added')),
  actor_id         UUID,
  task_id          UUID REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  project_id       UUID REFERENCES public.work_projects(id) ON DELETE CASCADE,
  payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at          TIMESTAMPTZ,
  UNIQUE (recipient_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON public.notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON public.notifications (recipient_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_created_idx ON public.notifications (created_at);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.notifications TO authenticated;
-- Marking read is the only change a person can make.
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

DROP POLICY IF EXISTS "People see their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "People mark their own notifications read" ON public.notifications;
DROP POLICY IF EXISTS "People clear their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Deactivated accounts have no access" ON public.notifications;
CREATE POLICY "People see their own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (recipient_id = auth.uid());
CREATE POLICY "People mark their own notifications read" ON public.notifications
  FOR UPDATE TO authenticated USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());
CREATE POLICY "People clear their own notifications" ON public.notifications
  FOR DELETE TO authenticated USING (recipient_id = auth.uid());
CREATE POLICY "Deactivated accounts have no access" ON public.notifications
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.account_is_active(auth.uid())))
  WITH CHECK ((SELECT private.account_is_active(auth.uid())));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.person_name(_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'Someone')
    FROM public.profiles p WHERE p.user_id = _user_id
$$;

CREATE OR REPLACE FUNCTION private.task_status_label(_organization_id UUID, _status TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.label FROM public.task_status_settings s
      WHERE s.organization_id = _organization_id AND s.value::text = _status LIMIT 1),
    CASE _status WHEN 'todo' THEN 'To Do' WHEN 'progress' THEN 'In Progress'
                 WHEN 'review' THEN 'Waiting Approval' WHEN 'done' THEN 'Completed'
                 WHEN 'cancelled' THEN 'Cancelled' ELSE _status END)
$$;

-- Writes one notification, unless it would go to the person who acted, to an
-- inactive account, or to someone who can't open the task or project.
CREATE OR REPLACE FUNCTION private.notify(
  _recipient UUID, _organization_id UUID, _kind TEXT, _actor UUID,
  _task_id UUID, _project_id UUID, _payload JSONB, _dedupe_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _recipient IS NULL OR _recipient IS NOT DISTINCT FROM _actor THEN
    RETURN;
  END IF;
  IF NOT private.account_is_active(_recipient)
     OR NOT private.has_organization_access(_recipient, _organization_id) THEN
    RETURN;
  END IF;
  IF _task_id IS NOT NULL AND NOT private.can_access_task(_recipient, _task_id) THEN
    RETURN;
  END IF;
  IF _task_id IS NULL AND _project_id IS NOT NULL AND NOT private.can_access_project(_recipient, _project_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications
    (recipient_id, organization_id, kind, actor_id, task_id, project_id, payload, dedupe_key)
  VALUES
    (_recipient, _organization_id, _kind, _actor, _task_id, _project_id,
     COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('actorName', COALESCE(private.person_name(_actor), 'Flowdesk')),
     _dedupe_key)
  ON CONFLICT (recipient_id, dedupe_key) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tasks: assigned, sent for review, completed, moved, added to a project
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.notify_work_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := COALESCE(auth.uid(), NEW.created_by);
  v_project_name TEXT;
  v_owner UUID;
  v_manager UUID;
  v_payload JSONB;
  v_key TEXT := txid_current()::text;
  v_done UUID[] := ARRAY[]::UUID[];
  v_watcher UUID;
  v_kind TEXT;
BEGIN
  BEGIN
    IF NEW.archived_at IS NOT NULL THEN
      RETURN NULL;
    END IF;
    IF NEW.project_id IS NOT NULL THEN
      SELECT p.name, p.owner_id, p.manager_id INTO v_project_name, v_owner, v_manager
        FROM public.work_projects p WHERE p.id = NEW.project_id;
    END IF;
    v_payload := jsonb_build_object('taskTitle', NEW.title, 'projectName', v_project_name);

    -- Given the task.
    IF NEW.assignee_id IS NOT NULL
       AND NEW.status NOT IN ('done', 'cancelled')
       AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN
      PERFORM private.notify(NEW.assignee_id, NEW.organization_id, 'task_assigned', v_actor, NEW.id,
                             NEW.project_id, v_payload, 'task_assigned:' || NEW.id || ':' || v_key);
      v_done := v_done || NEW.assignee_id;
    END IF;

    IF TG_OP = 'INSERT' THEN
      -- A new task in a project someone owns or runs.
      IF NEW.project_id IS NOT NULL THEN
        FOREACH v_watcher IN ARRAY ARRAY[v_owner, v_manager] LOOP
          IF v_watcher IS NOT NULL AND NOT v_watcher = ANY (v_done) THEN
            PERFORM private.notify(v_watcher, NEW.organization_id, 'task_created_in_project', v_actor, NEW.id,
                                   NEW.project_id, v_payload, 'task_created_in_project:' || NEW.id || ':' || v_key);
            v_done := v_done || v_watcher;
          END IF;
        END LOOP;
      END IF;
      RETURN NULL;
    END IF;

    -- Moved: everyone watching the task hears once.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_payload := v_payload || jsonb_build_object(
        'from', OLD.status::text, 'to', NEW.status::text,
        'fromLabel', private.task_status_label(NEW.organization_id, OLD.status::text),
        'toLabel', private.task_status_label(NEW.organization_id, NEW.status::text));
      FOREACH v_watcher IN ARRAY ARRAY[NEW.reviewer_id, NEW.created_by, NEW.assignee_id, v_owner, v_manager] LOOP
        CONTINUE WHEN v_watcher IS NULL OR v_watcher = ANY (v_done);
        v_kind := CASE
          WHEN NEW.status = 'done' THEN 'task_completed'
          WHEN NEW.status = 'review' AND v_watcher = NEW.reviewer_id THEN 'task_review_requested'
          ELSE 'task_status_changed' END;
        PERFORM private.notify(v_watcher, NEW.organization_id, v_kind, v_actor, NEW.id, NEW.project_id,
                               v_payload, v_kind || ':' || NEW.id || ':' || v_key);
        v_done := v_done || v_watcher;
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_work_task: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS notify_work_task_after ON public.work_tasks;
CREATE TRIGGER notify_work_task_after
  AFTER INSERT OR UPDATE OF assignee_id, status ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.notify_work_task();

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.notify_task_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task RECORD;
  v_project_name TEXT;
  v_owner UUID;
  v_manager UUID;
  v_payload JSONB;
  v_watcher UUID;
  v_done UUID[] := ARRAY[]::UUID[];
BEGIN
  BEGIN
    SELECT t.id, t.title, t.organization_id, t.project_id, t.created_by, t.assignee_id, t.reviewer_id, t.archived_at
      INTO v_task FROM public.work_tasks t WHERE t.id = NEW.task_id;
    IF v_task.id IS NULL OR v_task.archived_at IS NOT NULL THEN
      RETURN NULL;
    END IF;
    IF v_task.project_id IS NOT NULL THEN
      SELECT p.name, p.owner_id, p.manager_id INTO v_project_name, v_owner, v_manager
        FROM public.work_projects p WHERE p.id = v_task.project_id;
    END IF;
    v_payload := jsonb_build_object(
      'taskTitle', v_task.title, 'projectName', v_project_name, 'commentId', NEW.id,
      'excerpt', left(regexp_replace(btrim(NEW.body), '\s+', ' ', 'g'), 140));
    FOR v_watcher IN
      SELECT w FROM unnest(ARRAY[v_task.assignee_id, v_task.created_by, v_task.reviewer_id, v_owner, v_manager]) AS w
      UNION
      SELECT c.author_id FROM public.task_comments c WHERE c.task_id = NEW.task_id AND c.id <> NEW.id
    LOOP
      CONTINUE WHEN v_watcher IS NULL OR v_watcher = ANY (v_done);
      PERFORM private.notify(v_watcher, v_task.organization_id, 'task_commented', NEW.author_id, v_task.id,
                             v_task.project_id, v_payload, 'task_commented:' || NEW.id);
      v_done := v_done || v_watcher;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_task_comment: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS notify_task_comment_after ON public.task_comments;
CREATE TRIGGER notify_task_comment_after AFTER INSERT ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION private.notify_task_comment();

-- ---------------------------------------------------------------------------
-- Added to a project
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.notify_project_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project RECORD;
BEGIN
  BEGIN
    SELECT p.id, p.name, p.organization_id, p.owner_id, p.archived_at
      INTO v_project FROM public.work_projects p WHERE p.id = NEW.project_id;
    IF v_project.id IS NULL OR v_project.archived_at IS NOT NULL THEN
      RETURN NULL;
    END IF;
    PERFORM private.notify(NEW.user_id, v_project.organization_id, 'project_member_added',
                           COALESCE(auth.uid(), v_project.owner_id), NULL, v_project.id,
                           jsonb_build_object('projectName', v_project.name, 'roleLabel', NEW.role_label),
                           'project_member_added:' || NEW.project_id || ':' || txid_current());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_project_member: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS notify_project_member_after ON public.project_members;
CREATE TRIGGER notify_project_member_after AFTER INSERT ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION private.notify_project_member();

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.person_name(uuid)', 'private.task_status_label(uuid, text)',
    'private.notify(uuid, uuid, text, uuid, uuid, uuid, jsonb, text)',
    'private.notify_work_task()', 'private.notify_task_comment()', 'private.notify_project_member()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Live delivery (Supabase Realtime) and clean-up
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'flowdesk-purge-notifications';
    PERFORM cron.schedule('flowdesk-purge-notifications', '17 3 * * *',
      $job$DELETE FROM public.notifications
            WHERE (read_at IS NOT NULL AND read_at < now() - interval '30 days')
               OR created_at < now() - interval '90 days'$job$);
  END IF;
END $$;
