-- ============================================================================
-- FlowDesk — who sees a task, group tasks, links as documents (9 Oct 2026)
-- ============================================================================
-- Sharon (admin of upCarrera and TTII):
--   "Currently everything is visible to everyone and, the biggest error,
--    anybody can edit and move it along the queue."
--   "My task that I have created for myself should be visible only on my tasks
--    and whoever I'm reporting to, if applicable."
--   "If a manager/team lead creates a task for A, B, C: on the manager's board
--    it should move to the next stage only when the whole team has completed
--    it. If A completes their part it progresses on A's board without
--    affecting the manager's."
--   "An option to add a hyperlink (documents are on SharePoint)."
--
-- A. Who sees a task (private.can_view_task, the work_tasks SELECT policy).
--    Someone with an active membership in the task's organization who
--      a. created it, is its assignee or its reviewer;
--      b. is an admin of the organization;
--      c. manages its assignee or its creator there (private.manages_person:
--         the person reports to them, or is in the department they head, or
--         on the team they lead);
--      d. has a part in it, when it is a group task (read-only);
--      e. has a live part in the same group, when it is someone else's part
--         (read-only, and only the part itself: its title, status, progress).
--    Being on the project's team no longer shows anyone else's tasks. Project
--    pages, documents, milestones and teams keep the 30 Sep rules.
--    can_access_task (comments, files, subtasks, activity, storage,
--    notifications) is rules a–d: a sibling's comments and files stay private;
--    the people in a group talk on the group task.
--
-- B. Who changes or moves a task: its creator, assignee or reviewer, an admin,
--    or someone who manages its assignee. A group task: only its creator and
--    admins. Deleting: the creator or an admin, and the same for archiving
--    and restoring (the app's "Delete" archives). Who made a task never
--    changes. Who is in a group (adding, removing or reassigning a part) is
--    its creator's or an admin's. Creating is unchanged.
--
-- C. Group tasks. A task for several people is a parent ("group task", no
--    assignee) with one child ("part") per person, made by
--    public.create_group_task. Each person moves their own part. The group's
--    status is the least advanced of its live parts and nobody sets it
--    directly; its progress is the share of parts done. Editing the group
--    (title, dates, priority, …) edits the parts; archiving it archives them.
--    Its creator and reviewer hear when everyone is done.
--
-- D. Links. A task file or project document may be a link (link_url) instead
--    of a stored file.
--
-- Lessons this follows: RLS applies inside a policy's subqueries, so every
-- lookup goes through a SECURITY DEFINER helper; work_tasks' own policies use
-- the row's columns, so INSERT … RETURNING of a new task passes; the restrictive
-- "Deactivated accounts have no access" policies are left as they are.
--
-- Needs 20260930000100_project_access.sql, 20260930000200_in_app_notifications.sql
-- and 20261005000000_password_reset.sql. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Prerequisites. Fail loudly and early rather than half-way through.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('private.can_access_project(uuid, uuid)') IS NULL
     OR to_regprocedure('private.accessible_project_ids(uuid)') IS NULL
     OR to_regprocedure('private.guard_task_project()') IS NULL
     OR to_regprocedure('private.keep_in_organization()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20260930000100_project_access.sql before this migration';
  END IF;
  IF to_regclass('public.notifications') IS NULL
     OR to_regprocedure('private.notify(uuid, uuid, text, uuid, uuid, uuid, jsonb, text)') IS NULL
     OR to_regprocedure('private.notify_work_task()') IS NULL
     OR to_regprocedure('private.task_status_label(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20260930000200_in_app_notifications.sql before this migration';
  END IF;
  IF to_regprocedure('public.request_password_reset(text, text)') IS NULL
     OR to_regprocedure('public.complete_password_reset(text, text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261005000000_password_reset.sql before this migration';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
-- A part points at its group. One level only (enforced by the guard in 4).
ALTER TABLE public.work_tasks
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES public.work_tasks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS work_tasks_parent_idx ON public.work_tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL;
-- One live part per person in a group, even when two requests race. (The
-- guard in 4 says so in words first; this is the backstop.)
CREATE UNIQUE INDEX IF NOT EXISTS work_tasks_one_live_part_per_person
  ON public.work_tasks (parent_task_id, assignee_id)
  WHERE parent_task_id IS NOT NULL AND archived_at IS NULL;

-- A file or a link, never half of each. The existing checks on file_name
-- (1–255) and file_size (> 0, ≤ 25 MB) stay; a NULL size passes them.
-- A link is http(s), at most 2048 characters, with no whitespace or control
-- characters anywhere; its host (up to the first /, ? or #) is not empty and
-- has no "@" (a "user@" prefix makes a link read as one site and open
-- another) and no backslash (which browsers read as "/"); and it has no
-- zero-width or bidirectional-control characters (U+200B–200F, U+202A–202E,
-- U+2066–2069, U+FEFF), which can make it display as something it is not.
-- Every existing row is a file (link_url is new and the file columns were
-- NOT NULL until now), so adding the check cannot fail on existing data.
ALTER TABLE public.task_attachments ADD COLUMN IF NOT EXISTS link_url TEXT;
ALTER TABLE public.task_attachments
  ALTER COLUMN storage_path DROP NOT NULL,
  ALTER COLUMN file_size DROP NOT NULL,
  ALTER COLUMN mime_type DROP NOT NULL;
ALTER TABLE public.task_attachments DROP CONSTRAINT IF EXISTS task_attachments_file_or_link;
ALTER TABLE public.task_attachments ADD CONSTRAINT task_attachments_file_or_link CHECK (
  (link_url IS NULL AND storage_path IS NOT NULL AND file_size IS NOT NULL AND mime_type IS NOT NULL)
  OR (link_url IS NOT NULL AND storage_path IS NULL AND file_size IS NULL AND mime_type IS NULL
      AND char_length(link_url) <= 2048
      AND link_url ~ '^https?://[^/?#@\\[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$'
      AND link_url !~ '[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]'));

ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS link_url TEXT;
ALTER TABLE public.project_documents
  ALTER COLUMN storage_path DROP NOT NULL,
  ALTER COLUMN file_size DROP NOT NULL,
  ALTER COLUMN mime_type DROP NOT NULL;
ALTER TABLE public.project_documents DROP CONSTRAINT IF EXISTS project_documents_file_or_link;
ALTER TABLE public.project_documents ADD CONSTRAINT project_documents_file_or_link CHECK (
  (link_url IS NULL AND storage_path IS NOT NULL AND file_size IS NOT NULL AND mime_type IS NOT NULL)
  OR (link_url IS NOT NULL AND storage_path IS NULL AND file_size IS NULL AND mime_type IS NULL
      AND char_length(link_url) <= 2048
      AND link_url ~ '^https?://[^/?#@\\[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$'
      AND link_url !~ '[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]'));

-- ---------------------------------------------------------------------------
-- 2. Helpers. Every one returns true or false, never NULL: callers write
--    "NOT private.can_access_task(…)", where a NULL would let a notification
--    through to someone who can't open the task.
-- ---------------------------------------------------------------------------

-- _manager manages _person in the organization: the person (active there)
-- reports to them, is in the department they head, or is on the team they
-- lead; and the manager is active there too. Nobody manages themself.
CREATE OR REPLACE FUNCTION private.manages_person(_manager UUID, _person UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    _manager IS NOT NULL AND _person IS NOT NULL AND _manager <> _person
    AND private.has_organization_access(_manager, _organization_id)
    AND EXISTS (
      SELECT 1
        FROM public.organization_memberships m
        LEFT JOIN public.departments d ON d.id = m.department_id
        LEFT JOIN public.teams tm ON tm.id = m.team_id
       WHERE m.user_id = _person
         AND m.organization_id = _organization_id
         AND m.status = 'active'
         AND (m.reporting_manager_id = _manager
              OR d.head_user_id = _manager
              OR tm.lead_user_id = _manager)),
    false)
$$;

-- A group task is a task with parts. (It never has an assignee: see 4.)
CREATE OR REPLACE FUNCTION private.is_group_task(_task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.work_tasks c WHERE c.parent_task_id = _task_id)
$$;

-- Rules a–d on a row's own columns: who may open the task itself, with its
-- comments, files, subtasks and activity. On the row's columns so the SELECT
-- policy can use it on a row that is being inserted (a lookup by id would not
-- see it yet).
CREATE OR REPLACE FUNCTION private.task_accessible_to(
  _user_id UUID, _task_id UUID, _organization_id UUID,
  _created_by UUID, _assignee_id UUID, _reviewer_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    _user_id IS NOT NULL
    AND private.has_organization_access(_user_id, _organization_id)
    AND (_user_id = _created_by
         OR _user_id = _assignee_id
         OR _user_id = _reviewer_id
         OR private.has_organization_role(_user_id, _organization_id, 'admin')
         OR private.manages_person(_user_id, _assignee_id, _organization_id)
         OR private.manages_person(_user_id, _created_by, _organization_id)
         -- d. a group task, seen by the people who have a part in it
         OR EXISTS (SELECT 1 FROM public.work_tasks c
                     WHERE c.parent_task_id = _task_id
                       AND c.assignee_id = _user_id
                       AND c.archived_at IS NULL)),
    false)
$$;

-- Rule A (a–e): who sees the task's row (the SELECT policy). e. adds the
-- others with a live part in the same group: they see a part's title, status
-- and progress, but not its comments, files, subtasks or activity (those
-- follow can_access_task, a–d); the group talks on the group task. By id: a
-- row being inserted is its inserter's anyway.
CREATE OR REPLACE FUNCTION private.task_visible_to(
  _user_id UUID, _task_id UUID, _organization_id UUID,
  _created_by UUID, _assignee_id UUID, _reviewer_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.task_accessible_to(_user_id, _task_id, _organization_id, _created_by, _assignee_id, _reviewer_id)
      OR COALESCE(
           _user_id IS NOT NULL
           AND private.has_organization_access(_user_id, _organization_id)
           AND EXISTS (SELECT 1
                         FROM public.work_tasks t
                         JOIN public.work_tasks mine ON mine.parent_task_id = t.parent_task_id
                        WHERE t.id = _task_id
                          AND t.parent_task_id IS NOT NULL
                          AND mine.assignee_id = _user_id
                          AND mine.archived_at IS NULL),
           false)
$$;

-- Rule A by id.
CREATE OR REPLACE FUNCTION private.can_view_task(_user_id UUID, _task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT private.task_visible_to(_user_id, t.id, t.organization_id, t.created_by, t.assignee_id, t.reviewer_id)
      FROM public.work_tasks t WHERE t.id = _task_id), false)
$$;

-- Redefined: rules a–d by id. Comments, files, subtasks, activity, storage
-- and notifications use it: everything about a task except a sibling's view
-- of its row.
CREATE OR REPLACE FUNCTION private.can_access_task(_user_id UUID, _task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT private.task_accessible_to(_user_id, t.id, t.organization_id, t.created_by, t.assignee_id, t.reviewer_id)
      FROM public.work_tasks t WHERE t.id = _task_id), false)
$$;

-- Rule B on a row's own columns (the UPDATE policy).
CREATE OR REPLACE FUNCTION private.task_editable_by(
  _user_id UUID, _task_id UUID, _organization_id UUID,
  _created_by UUID, _assignee_id UUID, _reviewer_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    _user_id IS NOT NULL
    AND private.has_organization_access(_user_id, _organization_id)
    AND (_user_id = _created_by
         OR private.has_organization_role(_user_id, _organization_id, 'admin')
         -- A group task moves with its parts; only its creator and admins edit it.
         OR (NOT private.is_group_task(_task_id)
             AND (_user_id = _assignee_id
                  OR _user_id = _reviewer_id
                  OR private.manages_person(_user_id, _assignee_id, _organization_id)))),
    false)
$$;

-- Rule B by id: subtasks change a task's progress, so adding, ticking and
-- removing them is for the people who may change the task (section 3).
CREATE OR REPLACE FUNCTION private.can_edit_task(_user_id UUID, _task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT private.task_editable_by(_user_id, t.id, t.organization_id, t.created_by, t.assignee_id, t.reviewer_id)
      FROM public.work_tasks t WHERE t.id = _task_id), false)
$$;

-- Redefined: removing other people's files from a task.
CREATE OR REPLACE FUNCTION private.can_manage_task(_user_id UUID, _task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.work_tasks t
     WHERE t.id = _task_id
       AND private.has_organization_access(_user_id, t.organization_id)
       AND (t.created_by = _user_id
            OR private.has_organization_role(_user_id, t.organization_id, 'admin')
            OR private.manages_person(_user_id, t.assignee_id, t.organization_id))
  )
$$;

-- Changing who is in a group task: its creator or an admin.
CREATE OR REPLACE FUNCTION private.can_manage_group(_user_id UUID, _task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.work_tasks t
     WHERE t.id = _task_id
       AND private.has_organization_access(_user_id, t.organization_id)
       AND (t.created_by = _user_id
            OR private.has_organization_role(_user_id, t.organization_id, 'admin'))
  )
$$;

-- What a group task's status and progress should be, from its live
-- (non-archived) parts. Cancelled parts don't count; when every live part is
-- cancelled the group is cancelled. No live parts: status NULL (leave it).
CREATE OR REPLACE FUNCTION private.group_task_state(
  _task_id UUID,
  OUT parts INTEGER,
  OUT status public.work_task_status,
  OUT progress SMALLINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.parts::INTEGER,
         CASE WHEN s.parts = 0 THEN NULL
              WHEN s.counted = 0 THEN 'cancelled'::public.work_task_status
              ELSE (ARRAY['todo', 'progress', 'review', 'done']::public.work_task_status[])[s.least_rank]
         END,
         CASE WHEN s.counted = 0 THEN NULL
              ELSE round(100.0 * s.done / s.counted)::SMALLINT
         END
    FROM (
      SELECT count(*) AS parts,
             count(*) FILTER (WHERE c.status <> 'cancelled') AS counted,
             count(*) FILTER (WHERE c.status = 'done') AS done,
             min(CASE c.status WHEN 'todo' THEN 1 WHEN 'progress' THEN 2
                               WHEN 'review' THEN 3 WHEN 'done' THEN 4 END) AS least_rank
        FROM public.work_tasks c
       WHERE c.parent_task_id = _task_id AND c.archived_at IS NULL
    ) s
$$;

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.manages_person(uuid, uuid, uuid)', 'private.is_group_task(uuid)',
    'private.task_accessible_to(uuid, uuid, uuid, uuid, uuid, uuid)',
    'private.task_visible_to(uuid, uuid, uuid, uuid, uuid, uuid)', 'private.can_view_task(uuid, uuid)',
    'private.can_access_task(uuid, uuid)',
    'private.task_editable_by(uuid, uuid, uuid, uuid, uuid, uuid)', 'private.can_edit_task(uuid, uuid)',
    'private.can_manage_task(uuid, uuid)',
    'private.can_manage_group(uuid, uuid)', 'private.group_task_state(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Tasks: see, change, delete. Creating stays as on 30 Sep ("Members can
--    create tasks in their projects", guard_task_project, keep_in_organization).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "People can view their tasks and their projects' tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "People can update their tasks and their projects' tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "Project managers can delete tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "People see their own, their team's and their group's tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "People change their own and their team's tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "Creators and admins can delete tasks" ON public.work_tasks;

CREATE POLICY "People see their own, their team's and their group's tasks" ON public.work_tasks
  FOR SELECT TO authenticated
  USING (private.task_visible_to(auth.uid(), id, organization_id, created_by, assignee_id, reviewer_id));

CREATE POLICY "People change their own and their team's tasks" ON public.work_tasks
  FOR UPDATE TO authenticated
  USING (private.task_editable_by(auth.uid(), id, organization_id, created_by, assignee_id, reviewer_id))
  -- Moving a task into a project someone can't open is refused by
  -- guard_task_project (a CHECK has no OLD row to tell a move apart).
  WITH CHECK (private.has_organization_access(auth.uid(), organization_id)
              AND (project_id IS NULL OR organization_id = private.project_org(project_id)));

CREATE POLICY "Creators and admins can delete tasks" ON public.work_tasks
  FOR DELETE TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id)
         AND (created_by = auth.uid()
              OR private.has_organization_role(auth.uid(), organization_id, 'admin')));

-- Subtasks: everyone who sees a task still sees them ("People who can see a
-- task can see its subtasks", unchanged). Adding, ticking and removing them
-- moves the task's progress, so it follows rule B: a manager of the task's
-- creator, or someone else in the same group, reads them but does not tick
-- them. It was everyone who could see the task.
DROP POLICY IF EXISTS "People who can see a task can edit its subtasks" ON public.task_subtasks;
DROP POLICY IF EXISTS "People who can change a task add its subtasks" ON public.task_subtasks;
DROP POLICY IF EXISTS "People who can change a task change its subtasks" ON public.task_subtasks;
DROP POLICY IF EXISTS "People who can change a task remove its subtasks" ON public.task_subtasks;
CREATE POLICY "People who can change a task add its subtasks" ON public.task_subtasks
  FOR INSERT TO authenticated
  WITH CHECK (private.can_edit_task(auth.uid(), task_id));
CREATE POLICY "People who can change a task change its subtasks" ON public.task_subtasks
  FOR UPDATE TO authenticated
  USING (private.can_edit_task(auth.uid(), task_id))
  WITH CHECK (private.can_edit_task(auth.uid(), task_id));
CREATE POLICY "People who can change a task remove its subtasks" ON public.task_subtasks
  FOR DELETE TO authenticated
  USING (private.can_edit_task(auth.uid(), task_id));

-- ---------------------------------------------------------------------------
-- 4. Group tasks
-- ---------------------------------------------------------------------------

-- Recomputes a group task's status and progress from its parts. The guard
-- below refuses any other change of a group task's status; this function
-- marks its own update with a transaction-local setting naming the group.
-- Runs as its owner: the person moving their part usually can't change the
-- group task themself.
CREATE OR REPLACE FUNCTION private.derive_group_task(_task_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state RECORD;
  v_previous TEXT;
BEGIN
  IF _task_id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO v_state FROM private.group_task_state(_task_id);
  IF v_state.status IS NULL THEN
    RETURN;
  END IF;
  v_previous := current_setting('flowdesk.deriving_group_task', true);
  PERFORM set_config('flowdesk.deriving_group_task', _task_id::text, true);
  UPDATE public.work_tasks t
     SET status = v_state.status,
         progress = COALESCE(v_state.progress, t.progress)
   WHERE t.id = _task_id
     AND (t.status IS DISTINCT FROM v_state.status
          OR (v_state.progress IS NOT NULL AND t.progress IS DISTINCT FROM v_state.progress));
  PERFORM set_config('flowdesk.deriving_group_task', COALESCE(v_previous, ''), true);
END;
$$;

-- Before every insert and update. Named to run after the other BEFORE
-- triggers (they fire in name order), so it has the last word on a group
-- task's progress: prepare_work_task_update falls back to the subtask ratio
-- when a task leaves done, which for a group task is wrong. It also holds the
-- rules on who made a task and who may archive it.
CREATE OR REPLACE FUNCTION private.guard_group_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_group RECORD;
  v_state RECORD;
  v_joining BOOLEAN;
  v_rejoining BOOLEAN;
BEGIN
  -- Who made a task never changes: being its creator is what lets someone
  -- delete or archive it, so an editor who could rewrite it could take the
  -- task over. No database function changes it either; the service role and
  -- the SQL editor (no auth.uid()) are not checked.
  IF TG_OP = 'UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by AND v_actor IS NOT NULL THEN
    RAISE EXCEPTION 'The person who made a task can''t be changed' USING ERRCODE = '42501';
  END IF;

  -- "Delete" in the app archives the task (archived_at), which is an UPDATE;
  -- deleting, and restoring, belong to its creator or an admin (rule B), not
  -- to everyone who may change it. Only a person's own statement is checked
  -- (trigger depth 1): a group task archiving its parts runs one level down,
  -- after the group task itself passed this check. No database function
  -- other than that one archives tasks. The service role and the SQL editor
  -- have no auth.uid() and may.
  IF TG_OP = 'UPDATE' AND NEW.archived_at IS DISTINCT FROM OLD.archived_at
     AND v_actor IS NOT NULL AND pg_trigger_depth() <= 1
     AND OLD.created_by IS DISTINCT FROM v_actor
     AND NOT private.has_organization_role(v_actor, OLD.organization_id, 'admin') THEN
    RAISE EXCEPTION 'Only the person who made this task, or an admin, can delete it' USING ERRCODE = '42501';
  END IF;

  -- A group task: its status and progress come from its live parts. (A group
  -- task never has an assignee or a parent, so most rows skip the lookup.)
  -- With no live part left (all archived) nothing derives it any more, so
  -- its creator or an admin may set its status again.
  IF TG_OP = 'UPDATE' AND OLD.assignee_id IS NULL AND OLD.parent_task_id IS NULL
     AND private.is_group_task(NEW.id) THEN
    SELECT * INTO v_state FROM private.group_task_state(NEW.id);
    IF v_state.parts > 0
       AND NEW.status IS DISTINCT FROM OLD.status
       AND current_setting('flowdesk.deriving_group_task', true) IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'This task moves when everyone in it has moved their part' USING ERRCODE = '22023';
    END IF;
    IF NEW.assignee_id IS NOT NULL THEN
      RAISE EXCEPTION 'A group task has no single assignee: each person has their own part'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.parent_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'A group task can''t be part of another group task' USING ERRCODE = '22023';
    END IF;
    IF v_state.progress IS NOT NULL THEN
      NEW.progress := v_state.progress;
    END IF;
    -- work_tasks_check1: a finished task is not blocked.
    IF NEW.status IN ('done', 'cancelled') THEN
      NEW.blocked := false;
    END IF;
  END IF;

  -- Someone joins a group: a part is made, put into a group, or given to
  -- another person (that person would then see the group and its parts).
  IF TG_OP = 'INSERT' THEN
    v_joining := NEW.parent_task_id IS NOT NULL;
    v_rejoining := false;
  ELSE
    v_joining := NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id
                 OR (NEW.parent_task_id IS NOT NULL AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id);
    v_rejoining := NEW.parent_task_id IS NOT NULL AND OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL;
  END IF;

  -- Who is in a group task: changed only by its creator or an admin. (The
  -- service role and the SQL editor have no auth.uid() and may.) Checked
  -- first, so nobody else learns anything about the group from the errors
  -- below.
  IF v_actor IS NOT NULL AND v_joining THEN
    IF (NEW.parent_task_id IS NOT NULL AND NOT private.can_manage_group(v_actor, NEW.parent_task_id))
       OR (TG_OP = 'UPDATE' AND OLD.parent_task_id IS NOT NULL
           AND NOT private.can_manage_group(v_actor, OLD.parent_task_id)) THEN
      RAISE EXCEPTION 'Only the person who made a group task, or an admin, can change who is in it'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A part: one person's, an active member of the organization, in a group
  -- task (one level deep), in the group task's organization and project, and
  -- that person's only live part in it.
  IF NEW.parent_task_id IS NOT NULL
     AND (v_joining OR v_rejoining
          OR NEW.project_id IS DISTINCT FROM OLD.project_id
          OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
    SELECT g.id, g.organization_id, g.project_id, g.assignee_id, g.parent_task_id
      INTO v_group
      FROM public.work_tasks g WHERE g.id = NEW.parent_task_id;
    IF v_group.id IS NULL THEN
      RAISE EXCEPTION 'That group task doesn''t exist' USING ERRCODE = '22023';
    END IF;
    IF v_group.id = NEW.id OR v_group.parent_task_id IS NOT NULL OR v_group.assignee_id IS NOT NULL
       OR (TG_OP = 'UPDATE' AND private.is_group_task(NEW.id)) THEN
      RAISE EXCEPTION 'Only a group task has parts, and a part has no parts of its own'
        USING ERRCODE = '22023';
    END IF;
    IF v_group.organization_id IS DISTINCT FROM NEW.organization_id
       OR v_group.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'Each person''s part stays in the group task''s project: move the group task instead'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.assignee_id IS NULL THEN
      RAISE EXCEPTION 'Each part of a group task belongs to one person' USING ERRCODE = '22023';
    END IF;
    -- Checked when someone joins, not on every later change: a person who
    -- has since left keeps their part, and the group can still be edited,
    -- moved or archived.
    IF v_joining AND NOT private.has_organization_access(NEW.assignee_id, NEW.organization_id) THEN
      RAISE EXCEPTION 'Everyone in a group task must be an active member of its organization'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.archived_at IS NULL
       AND EXISTS (SELECT 1 FROM public.work_tasks s
                    WHERE s.parent_task_id = NEW.parent_task_id AND s.id <> NEW.id
                      AND s.assignee_id = NEW.assignee_id AND s.archived_at IS NULL) THEN
      RAISE EXCEPTION 'That person already has a part in this group task' USING ERRCODE = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS work_task_group_guard_before ON public.work_tasks;
CREATE TRIGGER work_task_group_guard_before
  BEFORE INSERT OR UPDATE ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.guard_group_task();

-- After a part is added, removed, moved, archived or put in another group.
-- Named to run after the existing AFTER triggers, so the part's own activity
-- and notifications come before the group's.
CREATE OR REPLACE FUNCTION private.derive_group_task_after()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.parent_task_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.status IS DISTINCT FROM OLD.status
          OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
          OR NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id) THEN
    PERFORM private.derive_group_task(NEW.parent_task_id);
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.parent_task_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id) THEN
    PERFORM private.derive_group_task(OLD.parent_task_id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS work_task_group_status_after ON public.work_tasks;
CREATE TRIGGER work_task_group_status_after
  AFTER INSERT OR DELETE OR UPDATE OF status, archived_at, parent_task_id ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.derive_group_task_after();

-- Editing a group task edits its live parts the same way; archiving it
-- archives them (and restoring it restores the parts archived with it). The
-- dates go together: start, due date and due time are one setting, and a
-- part that kept its own due date must not end up with both a due date and a
-- due time, or a due date before the new start.
CREATE OR REPLACE FUNCTION private.sync_group_task_parts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dates BOOLEAN := NEW.due_date IS DISTINCT FROM OLD.due_date
                     OR NEW.due_at IS DISTINCT FROM OLD.due_at
                     OR NEW.start_date IS DISTINCT FROM OLD.start_date;
  v_title BOOLEAN := NEW.title IS DISTINCT FROM OLD.title;
  v_description BOOLEAN := NEW.description IS DISTINCT FROM OLD.description;
  v_priority BOOLEAN := NEW.priority IS DISTINCT FROM OLD.priority;
  v_estimate BOOLEAN := NEW.estimated_hours IS DISTINCT FROM OLD.estimated_hours;
  v_tags BOOLEAN := NEW.tags IS DISTINCT FROM OLD.tags;
  v_reviewer BOOLEAN := NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id;
  v_project BOOLEAN := NEW.project_id IS DISTINCT FROM OLD.project_id;
BEGIN
  IF NEW.assignee_id IS NOT NULL OR NEW.parent_task_id IS NOT NULL OR NOT private.is_group_task(NEW.id) THEN
    RETURN NULL;
  END IF;

  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    UPDATE public.work_tasks
       SET archived_at = NEW.archived_at
     WHERE parent_task_id = NEW.id AND archived_at IS NULL;
  ELSIF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
    UPDATE public.work_tasks
       SET archived_at = NULL
     WHERE parent_task_id = NEW.id AND archived_at = OLD.archived_at;
  END IF;

  IF v_dates OR v_title OR v_description OR v_priority OR v_estimate OR v_tags OR v_reviewer OR v_project THEN
    UPDATE public.work_tasks c
       SET title           = CASE WHEN v_title THEN NEW.title ELSE c.title END,
           description     = CASE WHEN v_description THEN NEW.description ELSE c.description END,
           priority        = CASE WHEN v_priority THEN NEW.priority ELSE c.priority END,
           start_date      = CASE WHEN v_dates THEN NEW.start_date ELSE c.start_date END,
           due_date        = CASE WHEN v_dates THEN NEW.due_date ELSE c.due_date END,
           due_at          = CASE WHEN v_dates THEN NEW.due_at ELSE c.due_at END,
           estimated_hours = CASE WHEN v_estimate THEN NEW.estimated_hours ELSE c.estimated_hours END,
           tags            = CASE WHEN v_tags THEN NEW.tags ELSE c.tags END,
           reviewer_id     = CASE WHEN v_reviewer THEN NEW.reviewer_id ELSE c.reviewer_id END,
           project_id      = CASE WHEN v_project THEN NEW.project_id ELSE c.project_id END
     WHERE c.parent_task_id = NEW.id AND c.archived_at IS NULL;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS work_task_group_sync_after ON public.work_tasks;
CREATE TRIGGER work_task_group_sync_after
  AFTER UPDATE OF title, description, priority, due_date, due_at, start_date, estimated_hours,
                  tags, reviewer_id, project_id, archived_at ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.sync_group_task_parts();

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.derive_group_task(uuid)', 'private.guard_group_task()',
    'private.derive_group_task_after()', 'private.sync_group_task_parts()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

-- One task for several people, in one go. Runs as the caller, so every
-- insert passes the same policies as the app's own: the caller creates the
-- group task (no assignee) and one part per person, then each part gets the
-- subtasks. Returns the group task's id.
CREATE OR REPLACE FUNCTION public.create_group_task(
  p_task JSONB,
  p_assignee_ids UUID[],
  p_subtasks TEXT[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org UUID;
  v_project UUID;
  v_reviewer UUID;
  v_title TEXT;
  v_description TEXT;
  v_priority public.work_priority;
  v_status public.work_task_status;
  v_due_date DATE;
  v_due_at TIMESTAMPTZ;
  v_start_date DATE;
  v_estimate NUMERIC;
  v_tags TEXT[];
  v_assignees UUID[];
  v_subtasks TEXT[];
  v_assignee UUID;
  v_parent UUID;
  v_part UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to create a task' USING ERRCODE = '42501';
  END IF;
  IF p_task IS NULL OR jsonb_typeof(p_task) <> 'object' THEN
    RAISE EXCEPTION 'The task''s details are missing' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_org        := NULLIF(p_task->>'organizationId', '')::UUID;
    v_project    := NULLIF(p_task->>'projectId', '')::UUID;
    v_reviewer   := NULLIF(p_task->>'reviewerId', '')::UUID;
    v_priority   := COALESCE(NULLIF(p_task->>'priority', ''), 'medium')::public.work_priority;
    v_status     := COALESCE(NULLIF(p_task->>'status', ''), 'todo')::public.work_task_status;
    v_due_date   := NULLIF(p_task->>'dueDate', '')::DATE;
    v_due_at     := NULLIF(p_task->>'dueAt', '')::TIMESTAMPTZ;
    v_start_date := NULLIF(p_task->>'startDate', '')::DATE;
    v_estimate   := NULLIF(p_task->>'estimatedHours', '')::NUMERIC;
  EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION 'The task''s details are not valid: %', SQLERRM USING ERRCODE = '22023';
  END;
  v_title := btrim(COALESCE(p_task->>'title', ''));
  v_description := p_task->>'description';
  v_tags := CASE WHEN jsonb_typeof(p_task->'tags') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_task->'tags'))
                 ELSE '{}'::TEXT[] END;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Choose the organization the task belongs to' USING ERRCODE = '22023';
  END IF;
  IF v_title = '' THEN
    RAISE EXCEPTION 'Give the task a title' USING ERRCODE = '22023';
  END IF;

  -- Distinct people, in the order given.
  SELECT COALESCE(array_agg(a ORDER BY first_pos), '{}')
    INTO v_assignees
    FROM (SELECT a, min(ord) AS first_pos
            FROM unnest(COALESCE(p_assignee_ids, '{}'::UUID[])) WITH ORDINALITY AS u(a, ord)
           WHERE a IS NOT NULL
           GROUP BY a) s;
  IF cardinality(v_assignees) < 2 THEN
    RAISE EXCEPTION 'A group task needs at least two different people' USING ERRCODE = '22023';
  END IF;
  FOREACH v_assignee IN ARRAY v_assignees LOOP
    IF NOT private.has_organization_access(v_assignee, v_org) THEN
      RAISE EXCEPTION 'Everyone in a group task must be an active member of its organization'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(btrim(s) ORDER BY ord), '{}')
    INTO v_subtasks
    FROM unnest(COALESCE(p_subtasks, '{}'::TEXT[])) WITH ORDINALITY AS u(s, ord)
   WHERE s IS NOT NULL AND btrim(s) <> '';

  INSERT INTO public.work_tasks (
    organization_id, project_id, title, description, status, priority, assignee_id, reviewer_id,
    created_by, due_date, due_at, start_date, estimated_hours, tags, progress, completed_at
  ) VALUES (
    v_org, v_project, v_title, v_description, v_status, v_priority, NULL, v_reviewer,
    v_uid, v_due_date, v_due_at, v_start_date, v_estimate, v_tags,
    CASE WHEN v_status = 'done' THEN 100 ELSE 0 END,
    CASE WHEN v_status = 'done' THEN now() END
  )
  RETURNING id INTO v_parent;

  FOREACH v_assignee IN ARRAY v_assignees LOOP
    INSERT INTO public.work_tasks (
      organization_id, project_id, parent_task_id, title, description, status, priority, assignee_id,
      reviewer_id, created_by, due_date, due_at, start_date, estimated_hours, tags, progress, completed_at
    ) VALUES (
      v_org, v_project, v_parent, v_title, v_description, v_status, v_priority, v_assignee,
      v_reviewer, v_uid, v_due_date, v_due_at, v_start_date, v_estimate, v_tags,
      CASE WHEN v_status = 'done' THEN 100 ELSE 0 END,
      CASE WHEN v_status = 'done' THEN now() END
    )
    RETURNING id INTO v_part;

    IF cardinality(v_subtasks) > 0 THEN
      INSERT INTO public.task_subtasks (task_id, title, sort_order)
      SELECT v_part, s, ord::INTEGER
        FROM unnest(v_subtasks) WITH ORDINALITY AS u(s, ord);
    END IF;
  END LOOP;

  RETURN v_parent;
END;
$$;
REVOKE ALL ON FUNCTION public.create_group_task(JSONB, UUID[], TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_task(JSONB, UUID[], TEXT[]) TO authenticated, service_role;

-- A project's progress is the whole project's, whoever looks: a member now
-- sees only some of its tasks, and each would get a different figure. One row
-- per unit of work (a group task counts once, as the group task), with only
-- what progress and lateness need: no titles, no people. For the projects the
-- caller may open (as the email snapshot's projectCounts, for every project).
CREATE OR REPLACE FUNCTION public.project_task_units(p_project_id UUID DEFAULT NULL)
RETURNS TABLE (project_id UUID, status public.work_task_status, due_date DATE, due_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.project_id, t.status, t.due_date, t.due_at
    FROM public.work_tasks t
   WHERE auth.uid() IS NOT NULL
     -- Runs past row-level security, so apply "Deactivated accounts have no access" here.
     AND private.account_is_active(auth.uid())
     AND t.archived_at IS NULL
     AND t.parent_task_id IS NULL
     AND t.project_id IS NOT NULL
     AND t.project_id IN (SELECT private.accessible_project_ids(auth.uid()))
     AND (p_project_id IS NULL OR t.project_id = p_project_id)
$$;
REVOKE ALL ON FUNCTION public.project_task_units(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_task_units(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. In-app notifications for tasks, as in 20260930000200_in_app_notifications.sql
--    except: a group task's own status follows its parts, so it tells only its
--    creator and reviewer, and only when everyone is done (payload
--    groupCompleted); a part is not announced to the project's owner and
--    manager as a new task (the group task already was). Parts are assigned
--    and moved like any task.
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

    -- A group task: everyone has done their part.
    IF TG_OP = 'UPDATE' AND NEW.assignee_id IS NULL AND NEW.parent_task_id IS NULL
       AND private.is_group_task(NEW.id) THEN
      IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
        v_payload := v_payload || jsonb_build_object(
          'from', OLD.status::text, 'to', NEW.status::text,
          'fromLabel', private.task_status_label(NEW.organization_id, OLD.status::text),
          'toLabel', private.task_status_label(NEW.organization_id, NEW.status::text),
          'groupCompleted', true);
        FOREACH v_watcher IN ARRAY ARRAY[NEW.created_by, NEW.reviewer_id] LOOP
          CONTINUE WHEN v_watcher IS NULL OR v_watcher = ANY (v_done);
          PERFORM private.notify(v_watcher, NEW.organization_id, 'task_completed', v_actor, NEW.id,
                                 NEW.project_id, v_payload, 'task_completed:' || NEW.id || ':' || v_key);
          v_done := v_done || v_watcher;
        END LOOP;
      END IF;
      RETURN NULL;
    END IF;

    -- Given the task.
    IF NEW.assignee_id IS NOT NULL
       AND NEW.status NOT IN ('done', 'cancelled')
       AND (TG_OP = 'INSERT' OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN
      PERFORM private.notify(NEW.assignee_id, NEW.organization_id, 'task_assigned', v_actor, NEW.id,
                             NEW.project_id, v_payload, 'task_assigned:' || NEW.id || ':' || v_key);
      v_done := v_done || NEW.assignee_id;
    END IF;

    IF TG_OP = 'INSERT' THEN
      -- A new task in a project someone owns or runs (a group task once, not
      -- once per person).
      IF NEW.project_id IS NOT NULL AND NEW.parent_task_id IS NULL THEN
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
REVOKE ALL ON FUNCTION private.notify_work_task() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notify_work_task_after ON public.work_tasks;
CREATE TRIGGER notify_work_task_after
  AFTER INSERT OR UPDATE OF assignee_id, status ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.notify_work_task();

-- ---------------------------------------------------------------------------
-- 6. Activity for links: details.kind = 'link' (file_name stays the name), so
--    the feed can say "added a link". Files are recorded as before.
-- ---------------------------------------------------------------------------
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
         || CASE WHEN NEW.link_url IS NOT NULL THEN jsonb_build_object('kind', 'link') ELSE '{}'::jsonb END
  FROM public.work_tasks t WHERE t.id = NEW.task_id;
  RETURN NEW;
END;
$$;

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
            NEW.project_id,
            jsonb_build_object('file_name', NEW.file_name)
            || CASE WHEN NEW.link_url IS NOT NULL THEN jsonb_build_object('kind', 'link') ELSE '{}'::jsonb END);
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

-- ---------------------------------------------------------------------------
-- 7. The email worker's snapshot, as in section 8 of
--    20260930000100_project_access.sql, plus what the worker needs to apply
--    the new rule itself: each task's parentTaskId, each membership's
--    department, team and reporting manager, and every department's head and
--    team's lead. projectCounts count a group task once (its parts are left
--    out).
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
               'status', m.status::text,
               -- Who manages the person here (private.manages_person).
               'departmentId', m.department_id,
               'teamId', m.team_id,
               'reportingManagerId', m.reporting_manager_id)
             ORDER BY m.user_id, m.organization_id)
      FROM public.organization_memberships m
    ), '[]'::jsonb),
    'departments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id,
               'organizationId', d.organization_id,
               'headUserId', d.head_user_id)
             ORDER BY d.organization_id, d.id)
      FROM public.departments d
    ), '[]'::jsonb),
    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', tm.id,
               'organizationId', tm.organization_id,
               'leadUserId', tm.lead_user_id)
             ORDER BY tm.organization_id, tm.id)
      FROM public.teams tm
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
               'archivedAt', private.email_iso(p.archived_at),
               -- Who may open it, besides admins, managers and its team.
               'ownerId', p.owner_id,
               'managerId', p.manager_id)
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
               -- A group task's part points at the group task.
               'parentTaskId', t.parent_task_id,
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
        -- A group task counts once: the group task, not each person's part.
        WHERE t.archived_at IS NULL AND t.project_id IS NOT NULL AND t.parent_task_id IS NULL
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
