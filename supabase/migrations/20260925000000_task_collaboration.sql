-- ============================================================================
-- FlowDesk — task collaboration, files, validation, and the QA round 1–2 fixes
-- that belong in the database.
--
-- Naji's QA pass (24 Sep 2026, FD-001 … FD-073) found that the task modal shows
-- template subtasks, comments, attachments and activity, and that uploads and
-- comments vanish on reload. The cause is simple: none of those things had a
-- table. This migration adds them, and fixes the defects whose root cause is in
-- the schema rather than the UI:
--
--   FD-004/008/023  task_subtasks, with progress derived from them
--   FD-007          task_comments, author taken from the session, not the UI
--   FD-005/033      activity for every status change, edit, comment and project edit
--   FD-057/058/066  task_attachments + project_documents + private storage buckets
--                   with a 25 MB cap and an allow-list of file types
--   FD-016          title length, estimate range, start/due order, tag hygiene
--   FD-025          reopening a completed task no longer keeps 100% progress
--   FD-059          reopening and re-completing a recurring task no longer
--                   spawns a second next occurrence
--   FD-032          tasks get a real start_date (it used to be created_at)
--
-- Access follows the existing model exactly: whoever can see a task (creator,
-- assignee, reviewer, or management in its organization) can see its subtasks,
-- comments and files. private.can_access_task() mirrors the work_tasks SELECT
-- policy so the rule lives in one place.
--
-- Idempotent throughout.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------

-- Mirrors the "People can view assigned or managed tasks" policy on work_tasks.
CREATE OR REPLACE FUNCTION private.can_access_task(_user_id UUID, _task_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.work_tasks t
    WHERE t.id = _task_id
      AND (
        t.created_by = _user_id
        OR t.assignee_id = _user_id
        OR t.reviewer_id = _user_id
        OR private.has_management_access(_user_id, t.organization_id)
      )
  )
$$;
REVOKE ALL ON FUNCTION private.can_access_task(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_access_task(UUID, UUID) TO authenticated, service_role;

-- Storage paths are "<organization_id>/<entity_id>/<file>". Parse the first
-- segment without throwing on a malformed path.
CREATE OR REPLACE FUNCTION private.storage_path_org(_path TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN split_part(_path, '/', 1)::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;
GRANT EXECUTE ON FUNCTION private.storage_path_org(TEXT) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 1. Real start dates (FD-032). The UI used created_at as the start date.
-- ---------------------------------------------------------------------------
ALTER TABLE public.work_tasks ADD COLUMN IF NOT EXISTS start_date DATE;


-- ---------------------------------------------------------------------------
-- 2. Input validation that the client alone cannot guarantee (FD-016)
--
-- A trigger rather than CHECK constraints, deliberately: a CHECK re-validates
-- the whole row on every update, so one pre-existing bad value (QA left a
-- 99999h estimate and a 280-character title in the database) would make every
-- later status change on that row fail. The trigger only checks a column when
-- it is actually being written.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.validate_work_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cleaned TEXT[];
BEGIN
  IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title THEN
    NEW.title := btrim(NEW.title);
    IF char_length(NEW.title) < 1 OR char_length(NEW.title) > 200 THEN
      RAISE EXCEPTION 'Task title must be between 1 and 200 characters'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.estimated_hours IS DISTINCT FROM OLD.estimated_hours)
     AND NEW.estimated_hours IS NOT NULL
     AND (NEW.estimated_hours < 0 OR NEW.estimated_hours > 1000) THEN
    RAISE EXCEPTION 'Estimated hours must be between 0 and 1000'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (TG_OP = 'INSERT' OR NEW.start_date IS DISTINCT FROM OLD.start_date
      OR NEW.due_date IS DISTINCT FROM OLD.due_date)
     AND NEW.start_date IS NOT NULL AND NEW.due_date IS NOT NULL
     AND NEW.due_date < NEW.start_date THEN
    RAISE EXCEPTION 'Due date cannot be before the start date'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Tags: trimmed, lower-cased, de-duplicated, empty ones dropped (FD-016 "qa, qa").
  IF TG_OP = 'INSERT' OR NEW.tags IS DISTINCT FROM OLD.tags THEN
    SELECT COALESCE(array_agg(t ORDER BY first_pos), '{}')
      INTO cleaned
      FROM (
        SELECT lower(btrim(x)) AS t, min(ord) AS first_pos
        FROM unnest(COALESCE(NEW.tags, '{}')) WITH ORDINALITY AS u(x, ord)
        WHERE btrim(x) <> ''
        GROUP BY lower(btrim(x))
      ) s;
    IF cardinality(cleaned) > 20 THEN
      RAISE EXCEPTION 'A task can have at most 20 tags' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(cleaned) t WHERE char_length(t) > 40) THEN
      RAISE EXCEPTION 'Tags must be 40 characters or fewer' USING ERRCODE = 'check_violation';
    END IF;
    NEW.tags := cleaned;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_work_task_before ON public.work_tasks;
CREATE TRIGGER validate_work_task_before BEFORE INSERT OR UPDATE ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.validate_work_task();


-- ---------------------------------------------------------------------------
-- 3. Subtasks (FD-004, FD-008, FD-023)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_subtasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  completed   BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  UUID NOT NULL DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_subtasks_task_idx ON public.task_subtasks (task_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_subtasks TO authenticated;
GRANT ALL ON public.task_subtasks TO service_role;
ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "People who can see a task can see its subtasks" ON public.task_subtasks;
CREATE POLICY "People who can see a task can see its subtasks" ON public.task_subtasks
  FOR SELECT TO authenticated USING (private.can_access_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "People who can see a task can edit its subtasks" ON public.task_subtasks;
CREATE POLICY "People who can see a task can edit its subtasks" ON public.task_subtasks
  FOR ALL TO authenticated
  USING (private.can_access_task(auth.uid(), task_id))
  WITH CHECK (private.can_access_task(auth.uid(), task_id));

DROP TRIGGER IF EXISTS update_task_subtasks_updated_at ON public.task_subtasks;
CREATE TRIGGER update_task_subtasks_updated_at BEFORE UPDATE ON public.task_subtasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Progress is the share of subtasks done, so the card, the modal and the
-- project roll-up can never disagree about it. A task with no subtasks keeps
-- whatever progress was set on it directly. A completed task stays at 100.
CREATE OR REPLACE FUNCTION private.subtask_progress(_task_id UUID)
RETURNS SMALLINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN count(*) = 0 THEN NULL
              ELSE round(100.0 * count(*) FILTER (WHERE completed) / count(*))::smallint END
  FROM public.task_subtasks WHERE task_id = _task_id
$$;

CREATE OR REPLACE FUNCTION private.sync_task_progress_from_subtasks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target UUID := COALESCE(NEW.task_id, OLD.task_id);
  derived SMALLINT;
BEGIN
  derived := private.subtask_progress(target);
  IF derived IS NOT NULL THEN
    UPDATE public.work_tasks
       SET progress = derived
     WHERE id = target AND status <> 'done' AND progress IS DISTINCT FROM derived;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS sync_task_progress_after ON public.task_subtasks;
CREATE TRIGGER sync_task_progress_after AFTER INSERT OR UPDATE OR DELETE ON public.task_subtasks
  FOR EACH ROW EXECUTE FUNCTION private.sync_task_progress_from_subtasks();


-- ---------------------------------------------------------------------------
-- 4. Reopening a completed task recomputes progress (FD-025)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.prepare_work_task_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.progress := 100;
    NEW.blocked := false;
  ELSIF NEW.status IS DISTINCT FROM 'done' AND OLD.status = 'done' THEN
    NEW.completed_at := NULL;
    -- It is no longer finished, so it cannot still be 100% done. Fall back to
    -- the subtask ratio, or to zero when there are no subtasks.
    NEW.progress := COALESCE(private.subtask_progress(NEW.id), 0);
  END IF;
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 5. One next occurrence per occurrence (FD-059)
--
-- The trigger spawned a successor every time a recurring task moved to done, so
-- done -> todo -> done created two "next" tasks. Only spawn when this occurrence
-- has no later sibling yet.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.generate_recurring_task_after_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE mode_value text;
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' AND NEW.recurrence_id IS NOT NULL THEN
    SELECT creation_mode INTO mode_value FROM public.task_recurrences WHERE id = NEW.recurrence_id;
    IF mode_value = 'after_completion'
       AND NOT EXISTS (
         SELECT 1 FROM public.work_tasks later
         WHERE later.recurrence_id = NEW.recurrence_id
           AND later.occurrence_number > COALESCE(NEW.occurrence_number, 0)
       ) THEN
      PERFORM private.create_next_recurring_task(NEW.recurrence_id, COALESCE(NEW.due_date, CURRENT_DATE));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 6. Comments (FD-007)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  -- Always the session's user. Never taken from the client, which is how the
  -- old UI managed to credit every comment to "Alex Morgan".
  author_id   UUID NOT NULL DEFAULT auth.uid(),
  body        TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_comments_task_idx ON public.task_comments (task_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "People who can see a task can read its comments" ON public.task_comments;
CREATE POLICY "People who can see a task can read its comments" ON public.task_comments
  FOR SELECT TO authenticated USING (private.can_access_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "People who can see a task can comment as themselves" ON public.task_comments;
CREATE POLICY "People who can see a task can comment as themselves" ON public.task_comments
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND private.can_access_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "Authors can edit their own comments" ON public.task_comments;
CREATE POLICY "Authors can edit their own comments" ON public.task_comments
  FOR UPDATE TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "Authors can delete their own comments" ON public.task_comments;
CREATE POLICY "Authors can delete their own comments" ON public.task_comments
  FOR DELETE TO authenticated USING (author_id = auth.uid());

DROP TRIGGER IF EXISTS update_task_comments_updated_at ON public.task_comments;
CREATE TRIGGER update_task_comments_updated_at BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 7. Files: task attachments and project documents (FD-057, FD-058, FD-066)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID NOT NULL REFERENCES public.work_tasks(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  file_size     BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 26214400),
  mime_type     TEXT NOT NULL,
  storage_path  TEXT NOT NULL UNIQUE,
  uploaded_by   UUID NOT NULL DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON public.task_attachments (task_id, created_at);
GRANT SELECT, INSERT, DELETE ON public.task_attachments TO authenticated;
GRANT ALL ON public.task_attachments TO service_role;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "People who can see a task can see its files" ON public.task_attachments;
CREATE POLICY "People who can see a task can see its files" ON public.task_attachments
  FOR SELECT TO authenticated USING (private.can_access_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "People who can see a task can attach files as themselves" ON public.task_attachments;
CREATE POLICY "People who can see a task can attach files as themselves" ON public.task_attachments
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND private.can_access_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "Uploaders and managers can remove task files" ON public.task_attachments;
CREATE POLICY "Uploaders and managers can remove task files" ON public.task_attachments
  FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.work_tasks t
               WHERE t.id = task_id AND private.has_management_access(auth.uid(), t.organization_id))
  );

CREATE TABLE IF NOT EXISTS public.project_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID NOT NULL REFERENCES public.work_projects(id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  file_name        TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  file_size        BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 26214400),
  mime_type        TEXT NOT NULL,
  storage_path     TEXT NOT NULL UNIQUE,
  uploaded_by      UUID NOT NULL DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_documents_project_idx ON public.project_documents (project_id, created_at);
GRANT SELECT, INSERT, DELETE ON public.project_documents TO authenticated;
GRANT ALL ON public.project_documents TO service_role;
ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can see project documents" ON public.project_documents;
CREATE POLICY "Members can see project documents" ON public.project_documents
  FOR SELECT TO authenticated USING (private.has_organization_access(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can upload project documents as themselves" ON public.project_documents;
CREATE POLICY "Members can upload project documents as themselves" ON public.project_documents
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND private.has_organization_access(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Uploaders and managers can remove project documents" ON public.project_documents;
CREATE POLICY "Uploaders and managers can remove project documents" ON public.project_documents
  FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR private.has_management_access(auth.uid(), organization_id));

-- Private buckets, 25 MB per file, and an allow-list. HTML, SVG and arbitrary
-- binaries are refused: they are the file types that can carry script or that
-- nobody attaches to a task on purpose (FD-066).
DO $$
DECLARE
  allowed TEXT[] := ARRAY[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'text/plain', 'text/csv', 'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ];
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('task-attachments', 'task-attachments', false, 26214400, allowed),
           ('project-documents', 'project-documents', false, 26214400, allowed)
    ON CONFLICT (id) DO UPDATE
      SET public = false,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;

  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk members read org files" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk members read org files" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id IN ('task-attachments', 'project-documents')
           AND private.has_organization_access(auth.uid(), private.storage_path_org(name)))$p$;

  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk members upload org files" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk members upload org files" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id IN ('task-attachments', 'project-documents')
                AND private.has_organization_access(auth.uid(), private.storage_path_org(name)))$p$;

  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk uploaders and managers delete org files" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk uploaders and managers delete org files" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id IN ('task-attachments', 'project-documents')
           AND (owner = auth.uid()
                OR private.has_management_access(auth.uid(), private.storage_path_org(name))))$p$;
END $$;


-- ---------------------------------------------------------------------------
-- 8. Activity for everything that changes (FD-005, FD-033)
--
-- The feed only recorded completion, review, assignee and due-date changes, so a
-- task moved to In Progress left no trace. New values are added with IF NOT
-- EXISTS; they are only referenced inside function bodies, which is safe within
-- the same migration.
-- ---------------------------------------------------------------------------
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'task_status_changed';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'task_updated';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'task_commented';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'task_file_attached';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'task_archived';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'project_updated';
ALTER TYPE public.activity_event_type ADD VALUE IF NOT EXISTS 'project_document_added';

CREATE OR REPLACE FUNCTION private.track_work_task_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  activity_actor UUID;
BEGIN
  activity_actor := COALESCE(auth.uid(), NEW.created_by);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id)
    VALUES (NEW.organization_id, 'task_created', NEW.created_by, NEW.id, NEW.project_id);
    RETURN NEW;
  END IF;

  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id)
    VALUES (NEW.organization_id, 'task_archived'::public.activity_event_type, activity_actor, NEW.id, NEW.project_id);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'done' THEN
      INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id)
      VALUES (NEW.organization_id, 'task_completed', activity_actor, NEW.id, NEW.project_id);
    ELSIF NEW.status = 'review' THEN
      INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id)
      VALUES (NEW.organization_id, 'task_review_submitted', activity_actor, NEW.id, NEW.project_id);
    ELSE
      INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id, details)
      VALUES (NEW.organization_id, 'task_status_changed'::public.activity_event_type, activity_actor,
              NEW.id, NEW.project_id, jsonb_build_object('from', OLD.status, 'to', NEW.status));
    END IF;
  END IF;

  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id, details)
    VALUES (NEW.organization_id, 'task_assignee_changed', activity_actor, NEW.id, NEW.project_id,
            jsonb_build_object('from', OLD.assignee_id, 'to', NEW.assignee_id));
  END IF;

  IF NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id, details)
    VALUES (NEW.organization_id, 'task_due_date_changed', activity_actor, NEW.id, NEW.project_id,
            jsonb_build_object('due_at', NEW.due_at, 'due_date', NEW.due_date));
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.estimated_hours IS DISTINCT FROM OLD.estimated_hours THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id, details)
    VALUES (NEW.organization_id, 'task_updated'::public.activity_event_type, activity_actor, NEW.id, NEW.project_id,
            jsonb_strip_nulls(jsonb_build_object(
              'title',       CASE WHEN NEW.title IS DISTINCT FROM OLD.title THEN NEW.title END,
              'priority',    CASE WHEN NEW.priority IS DISTINCT FROM OLD.priority
                                  THEN jsonb_build_object('from', OLD.priority, 'to', NEW.priority) END,
              'description', CASE WHEN NEW.description IS DISTINCT FROM OLD.description THEN true END,
              'estimate',    CASE WHEN NEW.estimated_hours IS DISTINCT FROM OLD.estimated_hours
                                  THEN jsonb_build_object('from', OLD.estimated_hours, 'to', NEW.estimated_hours) END)));
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.track_task_comment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id)
  SELECT t.organization_id, 'task_commented'::public.activity_event_type, NEW.author_id, t.id, t.project_id
  FROM public.work_tasks t WHERE t.id = NEW.task_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS track_task_comment_activity_after ON public.task_comments;
CREATE TRIGGER track_task_comment_activity_after AFTER INSERT ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION private.track_task_comment_activity();

CREATE OR REPLACE FUNCTION private.track_task_attachment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id, details)
  SELECT t.organization_id, 'task_file_attached'::public.activity_event_type, NEW.uploaded_by, t.id, t.project_id,
         jsonb_build_object('file_name', NEW.file_name)
  FROM public.work_tasks t WHERE t.id = NEW.task_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS track_task_attachment_activity_after ON public.task_attachments;
CREATE TRIGGER track_task_attachment_activity_after AFTER INSERT ON public.task_attachments
  FOR EACH ROW EXECUTE FUNCTION private.track_task_attachment_activity();

CREATE OR REPLACE FUNCTION private.track_project_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'project_documents' THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, project_id, details)
    VALUES (NEW.organization_id, 'project_document_added'::public.activity_event_type, NEW.uploaded_by,
            NEW.project_id, jsonb_build_object('file_name', NEW.file_name));
    RETURN NEW;
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, project_id, details)
    VALUES (NEW.organization_id, 'project_updated'::public.activity_event_type,
            COALESCE(auth.uid(), NEW.owner_id), NEW.id,
            jsonb_strip_nulls(jsonb_build_object(
              'status', CASE WHEN NEW.status IS DISTINCT FROM OLD.status
                             THEN jsonb_build_object('from', OLD.status, 'to', NEW.status) END,
              'name',   CASE WHEN NEW.name IS DISTINCT FROM OLD.name THEN NEW.name END)));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS track_project_activity_after ON public.work_projects;
CREATE TRIGGER track_project_activity_after AFTER UPDATE ON public.work_projects
  FOR EACH ROW EXECUTE FUNCTION private.track_project_activity();
DROP TRIGGER IF EXISTS track_project_document_activity_after ON public.project_documents;
CREATE TRIGGER track_project_document_activity_after AFTER INSERT ON public.project_documents
  FOR EACH ROW EXECUTE FUNCTION private.track_project_activity();


-- ---------------------------------------------------------------------------
-- 9. Clear the QA test data the report asks us to remove (FD-006 had no delete).
--    Archived, not deleted, so the history stays inspectable.
--
--    The activity trigger is suspended for this step: it would log
--    'task_archived', and Postgres refuses to use an enum value in the same
--    transaction that added it. Nobody needs an activity entry for QA cleanup.
-- ---------------------------------------------------------------------------
ALTER TABLE public.work_tasks DISABLE TRIGGER track_work_task_activity_after;

UPDATE public.work_tasks
   SET archived_at = now()
 WHERE archived_at IS NULL
   AND id IN (
     '1a1c52c1-bc34-4184-8a76-87a7d7e1a65b',  -- QA-01 (XSS payload)
     '7efb437b-de4e-4e8a-a133-d34fb888eba5'   -- QA-02 (280-char title, 99999h)
   );
UPDATE public.work_tasks
   SET archived_at = now()
 WHERE archived_at IS NULL
   AND (title LIKE 'QA-03%' OR title LIKE 'QA-04%' OR title LIKE 'QA-05%');

ALTER TABLE public.work_tasks ENABLE TRIGGER track_work_task_activity_after;
