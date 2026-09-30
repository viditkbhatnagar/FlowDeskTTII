-- ============================================================================
-- FlowDesk — a project is open to its people (QA, 29 Sep 2026)
-- ============================================================================
-- QA: "Suppose I created a project and I have added a number of members, only
-- they and the managers should be able to open and make changes on to the
-- queue. Currently anyone can open it, make changes and move it."
--
-- Before: every member of the organization could open every project (and add
-- documents or tasks to it), and every team lead could see and change every
-- task and project in the organization.
--
-- Now a project, its tasks, team, milestones, documents, files, recurring
-- tasks and activity are open to:
--   - the organization's admins and managers (base role admin or manager),
--   - the project's owner and its Project Manager (work_projects.manager_id),
--   - the people on its team (project_members).
-- Team leads are no longer special here: they get in as owner, Project
-- Manager or member, like anyone else.
-- Someone who created, is assigned to or reviews a task keeps that task (and
-- its comments, files and activity) even if they are not on the project's
-- team; the project itself stays closed to them.
-- Changing the project itself (details, team, milestones), deleting its tasks
-- and removing other people's files takes an admin or manager, the owner, the
-- Project Manager, or a team lead on the team.
-- Tasks with no project keep the rule they had.
--
-- Everything is checked through SECURITY DEFINER helpers, never an inline
-- lookup: row-level security applies inside a policy's subquery (which is
-- why colleagues showed as "Unknown"), and work_projects and project_members
-- looking each other up inline would recurse. work_projects' own policies use
-- the row's columns (owner_id, manager_id), so INSERT … RETURNING of a new
-- project passes.
--
-- The email worker reads through a SECURITY DEFINER snapshot, so it applies
-- the same rule itself (src/lib/email/lookup.ts); the snapshot now carries
-- each project's owner and Project Manager for that.
--
-- Needs 20260930000000_people_visibility.sql. Idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- Admins and managers of the organization (active membership) see every project.
CREATE OR REPLACE FUNCTION private.has_project_oversight(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles r
      JOIN public.organization_memberships m
        ON m.user_id = r.user_id AND m.organization_id = r.organization_id AND m.status = 'active'
     WHERE r.user_id = _user_id
       AND r.organization_id = _organization_id
       AND r.role IN ('admin', 'manager')
  )
$$;

CREATE OR REPLACE FUNCTION private.is_project_member(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members pm
     WHERE pm.project_id = _project_id AND pm.user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION private.project_org(_project_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.work_projects WHERE id = _project_id
$$;

CREATE OR REPLACE FUNCTION private.task_org(_task_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.work_tasks WHERE id = _task_id
$$;

-- May open the project and work its tasks.
CREATE OR REPLACE FUNCTION private.can_access_project(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.work_projects p
     WHERE p.id = _project_id
       AND private.has_organization_access(_user_id, p.organization_id)
       AND (p.owner_id = _user_id
            OR p.manager_id = _user_id
            OR private.has_project_oversight(_user_id, p.organization_id)
            OR private.is_project_member(_user_id, p.id))
  )
$$;

-- May change the project itself, its team and milestones, and delete its tasks.
CREATE OR REPLACE FUNCTION private.can_manage_project(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.work_projects p
     WHERE p.id = _project_id
       AND private.has_organization_access(_user_id, p.organization_id)
       AND (p.owner_id = _user_id
            OR p.manager_id = _user_id
            OR private.has_project_oversight(_user_id, p.organization_id)
            OR (private.has_management_access(_user_id, p.organization_id)
                AND private.is_project_member(_user_id, p.id)))
  )
$$;

-- The projects someone may open, as a set: a list policy then runs it once per
-- query (a hashed subplan) instead of once per row.
CREATE OR REPLACE FUNCTION private.accessible_project_ids(_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
    FROM public.work_projects p
    JOIN public.organization_memberships m
      ON m.organization_id = p.organization_id AND m.user_id = _user_id AND m.status = 'active'
   WHERE p.owner_id = _user_id
      OR p.manager_id = _user_id
      OR private.has_project_oversight(_user_id, p.organization_id)
      OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = p.id AND pm.user_id = _user_id)
$$;

-- Redefined: mirrors work_tasks' SELECT policy below. Used by comments, files,
-- subtasks, activity and storage.
CREATE OR REPLACE FUNCTION private.can_access_task(_user_id UUID, _task_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.work_tasks t
     WHERE t.id = _task_id
       AND CASE WHEN t.project_id IS NULL THEN
             t.created_by = _user_id OR t.assignee_id = _user_id OR t.reviewer_id = _user_id
             OR private.has_management_access(_user_id, t.organization_id)
           ELSE
             private.can_access_project(_user_id, t.project_id)
             OR ((t.created_by = _user_id OR t.assignee_id = _user_id OR t.reviewer_id = _user_id)
                 AND private.has_organization_access(_user_id, t.organization_id))
           END
  )
$$;

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
       AND CASE WHEN t.project_id IS NULL
                THEN private.has_management_access(_user_id, t.organization_id)
                ELSE private.can_manage_project(_user_id, t.project_id) END
  )
$$;

-- The second segment of "<organization_id>/<task or project id>/<file>".
CREATE OR REPLACE FUNCTION private.storage_path_entity(_path TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN split_part(_path, '/', 2)::UUID;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.has_project_oversight(uuid, uuid)', 'private.is_project_member(uuid, uuid)',
    'private.project_org(uuid)', 'private.task_org(uuid)', 'private.can_access_project(uuid, uuid)',
    'private.can_manage_project(uuid, uuid)', 'private.accessible_project_ids(uuid)',
    'private.can_access_task(uuid, uuid)', 'private.can_manage_task(uuid, uuid)',
    'private.storage_path_entity(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS project_members_user_idx ON public.project_members (user_id, project_id);
CREATE INDEX IF NOT EXISTS project_milestones_project_idx ON public.project_milestones (project_id);
CREATE INDEX IF NOT EXISTS work_activity_task_idx ON public.work_activity (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_activity_project_idx ON public.work_activity (project_id, occurred_at DESC)
  WHERE project_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Projects
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view organization projects" ON public.work_projects;
DROP POLICY IF EXISTS "Project people can view projects" ON public.work_projects;
CREATE POLICY "Project people can view projects" ON public.work_projects
  FOR SELECT TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id)
         AND (owner_id = auth.uid()
              OR manager_id = auth.uid()
              OR private.has_project_oversight(auth.uid(), organization_id)
              OR private.is_project_member(auth.uid(), id)));

DROP POLICY IF EXISTS "Managers can update organization projects" ON public.work_projects;
DROP POLICY IF EXISTS "Project managers can update projects" ON public.work_projects;
CREATE POLICY "Project managers can update projects" ON public.work_projects
  FOR UPDATE TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id)
         AND (owner_id = auth.uid()
              OR manager_id = auth.uid()
              OR private.has_project_oversight(auth.uid(), organization_id)
              OR (private.has_management_access(auth.uid(), organization_id)
                  AND private.is_project_member(auth.uid(), id))))
  WITH CHECK (private.has_organization_access(auth.uid(), organization_id)
              AND (owner_id = auth.uid()
                   OR manager_id = auth.uid()
                   OR private.has_project_oversight(auth.uid(), organization_id)
                   OR (private.has_management_access(auth.uid(), organization_id)
                       AND private.is_project_member(auth.uid(), id))));

-- A project, task or recurring task stays in its organization. Before, anyone
-- in two organizations could move one they could edit into the other, where it
-- dropped out of the first one's view without a trace.
CREATE OR REPLACE FUNCTION private.keep_in_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION '% can''t be moved to another organization',
      CASE TG_TABLE_NAME WHEN 'work_projects' THEN 'A project'
                         WHEN 'task_recurrences' THEN 'A recurring task'
                         ELSE 'A task' END
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.keep_in_organization() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS keep_project_in_organization ON public.work_projects;
DROP FUNCTION IF EXISTS private.keep_project_in_organization();
DROP TRIGGER IF EXISTS keep_in_organization ON public.work_projects;
CREATE TRIGGER keep_in_organization BEFORE UPDATE OF organization_id ON public.work_projects
  FOR EACH ROW EXECUTE FUNCTION private.keep_in_organization();
DROP TRIGGER IF EXISTS keep_in_organization ON public.work_tasks;
CREATE TRIGGER keep_in_organization BEFORE UPDATE OF organization_id ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.keep_in_organization();
DROP TRIGGER IF EXISTS keep_in_organization ON public.task_recurrences;
CREATE TRIGGER keep_in_organization BEFORE UPDATE OF organization_id ON public.task_recurrences
  FOR EACH ROW EXECUTE FUNCTION private.keep_in_organization();

-- ---------------------------------------------------------------------------
-- 3. The project's team
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view project members" ON public.project_members;
DROP POLICY IF EXISTS "Managers can write project members" ON public.project_members;
DROP POLICY IF EXISTS "Project people can view the team" ON public.project_members;
DROP POLICY IF EXISTS "Project managers can add to the team" ON public.project_members;
DROP POLICY IF EXISTS "Project managers can change the team" ON public.project_members;
DROP POLICY IF EXISTS "Project managers can remove from the team" ON public.project_members;
CREATE POLICY "Project people can view the team" ON public.project_members
  FOR SELECT TO authenticated
  USING (private.can_access_project(auth.uid(), project_id));
CREATE POLICY "Project managers can add to the team" ON public.project_members
  FOR INSERT TO authenticated
  WITH CHECK (private.can_manage_project(auth.uid(), project_id)
              AND private.has_organization_access(user_id, private.project_org(project_id)));
CREATE POLICY "Project managers can change the team" ON public.project_members
  FOR UPDATE TO authenticated
  USING (private.can_manage_project(auth.uid(), project_id))
  WITH CHECK (private.can_manage_project(auth.uid(), project_id)
              AND private.has_organization_access(user_id, private.project_org(project_id)));
CREATE POLICY "Project managers can remove from the team" ON public.project_members
  FOR DELETE TO authenticated
  USING (private.can_manage_project(auth.uid(), project_id));

-- ---------------------------------------------------------------------------
-- 4. Milestones and documents
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can view organization milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "Managers can create organization milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "Managers can update organization milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "Managers can delete organization milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "Project people can view milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "Project managers can add milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "Project managers can change milestones" ON public.project_milestones;
DROP POLICY IF EXISTS "Project managers can delete milestones" ON public.project_milestones;
CREATE POLICY "Project people can view milestones" ON public.project_milestones
  FOR SELECT TO authenticated
  USING (private.can_access_project(auth.uid(), project_id));
CREATE POLICY "Project managers can add milestones" ON public.project_milestones
  FOR INSERT TO authenticated
  WITH CHECK (private.can_manage_project(auth.uid(), project_id)
              AND organization_id = private.project_org(project_id));
CREATE POLICY "Project managers can change milestones" ON public.project_milestones
  FOR UPDATE TO authenticated
  USING (private.can_manage_project(auth.uid(), project_id))
  WITH CHECK (private.can_manage_project(auth.uid(), project_id)
              AND organization_id = private.project_org(project_id));
CREATE POLICY "Project managers can delete milestones" ON public.project_milestones
  FOR DELETE TO authenticated
  USING (private.can_manage_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Members can see project documents" ON public.project_documents;
DROP POLICY IF EXISTS "Members can upload project documents as themselves" ON public.project_documents;
DROP POLICY IF EXISTS "Uploaders and managers can remove project documents" ON public.project_documents;
DROP POLICY IF EXISTS "Project people can see documents" ON public.project_documents;
DROP POLICY IF EXISTS "Project people can upload documents as themselves" ON public.project_documents;
DROP POLICY IF EXISTS "Uploaders and project managers can remove documents" ON public.project_documents;
CREATE POLICY "Project people can see documents" ON public.project_documents
  FOR SELECT TO authenticated
  USING (private.can_access_project(auth.uid(), project_id));
CREATE POLICY "Project people can upload documents as themselves" ON public.project_documents
  FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid()
              AND private.can_access_project(auth.uid(), project_id)
              AND organization_id = private.project_org(project_id));
CREATE POLICY "Uploaders and project managers can remove documents" ON public.project_documents
  FOR DELETE TO authenticated
  USING (private.can_access_project(auth.uid(), project_id)
         AND (uploaded_by = auth.uid() OR private.can_manage_project(auth.uid(), project_id)));

-- ---------------------------------------------------------------------------
-- 5. Tasks
-- ---------------------------------------------------------------------------
-- These use the row's own columns and the project set, never can_access_task:
-- a lookup of the row by id would not see a row being inserted.
DROP POLICY IF EXISTS "People can view assigned or managed tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "People can update assigned or managed tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "Members can create organization tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "Managers can delete organization tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "People can view their tasks and their projects' tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "People can update their tasks and their projects' tasks" ON public.work_tasks;
DROP POLICY IF EXISTS "Members can create tasks in their projects" ON public.work_tasks;
DROP POLICY IF EXISTS "Project managers can delete tasks" ON public.work_tasks;
CREATE POLICY "People can view their tasks and their projects' tasks" ON public.work_tasks
  FOR SELECT TO authenticated
  USING (CASE WHEN project_id IS NULL THEN
           created_by = auth.uid() OR assignee_id = auth.uid() OR reviewer_id = auth.uid()
           OR private.has_management_access(auth.uid(), organization_id)
         ELSE
           project_id IN (SELECT private.accessible_project_ids(auth.uid()))
           OR ((created_by = auth.uid() OR assignee_id = auth.uid() OR reviewer_id = auth.uid())
               AND private.has_organization_access(auth.uid(), organization_id))
         END);
CREATE POLICY "People can update their tasks and their projects' tasks" ON public.work_tasks
  FOR UPDATE TO authenticated
  USING (CASE WHEN project_id IS NULL THEN
           created_by = auth.uid() OR assignee_id = auth.uid() OR reviewer_id = auth.uid()
           OR private.has_management_access(auth.uid(), organization_id)
         ELSE
           project_id IN (SELECT private.accessible_project_ids(auth.uid()))
           OR ((created_by = auth.uid() OR assignee_id = auth.uid() OR reviewer_id = auth.uid())
               AND private.has_organization_access(auth.uid(), organization_id))
         END)
  -- Moving a task into a project someone can't open is refused by
  -- guard_task_project below (a CHECK has no OLD row to tell a move apart).
  WITH CHECK (private.has_organization_access(auth.uid(), organization_id)
              AND (project_id IS NULL OR organization_id = private.project_org(project_id)));
CREATE POLICY "Members can create tasks in their projects" ON public.work_tasks
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()
              AND private.has_organization_access(auth.uid(), organization_id)
              AND (project_id IS NULL
                   OR (private.can_access_project(auth.uid(), project_id)
                       AND organization_id = private.project_org(project_id))));
CREATE POLICY "Project managers can delete tasks" ON public.work_tasks
  FOR DELETE TO authenticated
  USING (CASE WHEN project_id IS NULL
              THEN private.has_management_access(auth.uid(), organization_id)
              ELSE private.can_manage_project(auth.uid(), project_id) END);

CREATE OR REPLACE FUNCTION private.guard_task_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.project_id IS NOT NULL
     AND NEW.project_id IS DISTINCT FROM OLD.project_id
     AND NOT private.can_access_project(auth.uid(), NEW.project_id) THEN
    RAISE EXCEPTION 'You can only move a task into a project you are part of' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_task_project() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_task_project ON public.work_tasks;
CREATE TRIGGER guard_task_project BEFORE UPDATE OF project_id ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.guard_task_project();

-- Files on a task: anyone who can see it adds them; the uploader or someone
-- who manages the task removes them.
DROP POLICY IF EXISTS "Uploaders and managers can remove task files" ON public.task_attachments;
DROP POLICY IF EXISTS "Uploaders and project managers can remove task files" ON public.task_attachments;
CREATE POLICY "Uploaders and project managers can remove task files" ON public.task_attachments
  FOR DELETE TO authenticated
  USING (private.can_access_task(auth.uid(), task_id)
         AND (uploaded_by = auth.uid() OR private.can_manage_task(auth.uid(), task_id)));

-- Recurring tasks follow their project.
DROP POLICY IF EXISTS "Members can view accessible task recurrences" ON public.task_recurrences;
DROP POLICY IF EXISTS "Members can create task recurrences" ON public.task_recurrences;
DROP POLICY IF EXISTS "Creators and managers can update task recurrences" ON public.task_recurrences;
DROP POLICY IF EXISTS "Creators and managers can delete task recurrences" ON public.task_recurrences;
DROP POLICY IF EXISTS "People can view their recurring tasks" ON public.task_recurrences;
DROP POLICY IF EXISTS "Members can create recurring tasks in their projects" ON public.task_recurrences;
DROP POLICY IF EXISTS "Creators and project managers can update recurring tasks" ON public.task_recurrences;
DROP POLICY IF EXISTS "Creators and project managers can delete recurring tasks" ON public.task_recurrences;
CREATE POLICY "People can view their recurring tasks" ON public.task_recurrences
  FOR SELECT TO authenticated
  USING (CASE WHEN project_id IS NULL THEN private.has_organization_access(auth.uid(), organization_id)
         ELSE created_by = auth.uid()
              OR project_id IN (SELECT private.accessible_project_ids(auth.uid()))
              OR ((assignee_id = auth.uid() OR reviewer_id = auth.uid())
                  AND private.has_organization_access(auth.uid(), organization_id))
         END);
CREATE POLICY "Members can create recurring tasks in their projects" ON public.task_recurrences
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid()
              AND private.has_organization_access(auth.uid(), organization_id)
              AND (project_id IS NULL
                   OR (private.can_access_project(auth.uid(), project_id)
                       AND organization_id = private.project_org(project_id))));
CREATE POLICY "Creators and project managers can update recurring tasks" ON public.task_recurrences
  FOR UPDATE TO authenticated
  USING (CASE WHEN project_id IS NULL
              THEN created_by = auth.uid() OR private.has_management_access(auth.uid(), organization_id)
              ELSE (created_by = auth.uid() AND private.can_access_project(auth.uid(), project_id))
                   OR private.can_manage_project(auth.uid(), project_id) END)
  WITH CHECK (private.has_organization_access(auth.uid(), organization_id)
              AND (project_id IS NULL
                   OR (private.can_access_project(auth.uid(), project_id)
                       AND organization_id = private.project_org(project_id))));
CREATE POLICY "Creators and project managers can delete recurring tasks" ON public.task_recurrences
  FOR DELETE TO authenticated
  USING (CASE WHEN project_id IS NULL
              THEN created_by = auth.uid() OR private.has_management_access(auth.uid(), organization_id)
              ELSE (created_by = auth.uid() AND private.can_access_project(auth.uid(), project_id))
                   OR private.can_manage_project(auth.uid(), project_id) END);

-- ---------------------------------------------------------------------------
-- 6. Activity
-- ---------------------------------------------------------------------------
-- Only the database writes activity (every writer is a trigger); a client
-- could otherwise post made-up entries into anyone's feed.
DROP POLICY IF EXISTS "Members can create organization activity" ON public.work_activity;
DROP POLICY IF EXISTS "People can view authorized organization activity" ON public.work_activity;
DROP POLICY IF EXISTS "People can view activity they may see" ON public.work_activity;
CREATE POLICY "People can view activity they may see" ON public.work_activity
  FOR SELECT TO authenticated
  USING (actor_id = auth.uid()
         OR (task_id IS NOT NULL AND private.can_access_task(auth.uid(), task_id))
         OR (task_id IS NULL AND project_id IS NOT NULL
             AND project_id IN (SELECT private.accessible_project_ids(auth.uid())))
         OR (task_id IS NULL AND project_id IS NULL
             AND private.has_management_access(auth.uid(), organization_id)));

-- ---------------------------------------------------------------------------
-- 7. Files in storage: "<organization_id>/<task or project id>/<file>"
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;

  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk members read org files" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk members read org files" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id IN ('task-attachments', 'project-documents')
           AND private.has_organization_access(auth.uid(), private.storage_path_org(name))
           AND CASE bucket_id
                 WHEN 'task-attachments' THEN private.can_access_task(auth.uid(), private.storage_path_entity(name))
                 ELSE private.can_access_project(auth.uid(), private.storage_path_entity(name)) END)$p$;

  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk members upload org files" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk members upload org files" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id IN ('task-attachments', 'project-documents')
                AND private.has_organization_access(auth.uid(), private.storage_path_org(name))
                AND CASE bucket_id
                      WHEN 'task-attachments' THEN
                        private.can_access_task(auth.uid(), private.storage_path_entity(name))
                        AND private.storage_path_org(name) = private.task_org(private.storage_path_entity(name))
                      ELSE
                        private.can_access_project(auth.uid(), private.storage_path_entity(name))
                        AND private.storage_path_org(name) = private.project_org(private.storage_path_entity(name))
                    END)$p$;

  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk uploaders and managers delete org files" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk uploaders and managers delete org files" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id IN ('task-attachments', 'project-documents')
           AND CASE bucket_id
                 WHEN 'task-attachments' THEN
                   private.can_access_task(auth.uid(), private.storage_path_entity(name))
                   AND (owner = auth.uid() OR private.can_manage_task(auth.uid(), private.storage_path_entity(name)))
                 ELSE
                   private.can_access_project(auth.uid(), private.storage_path_entity(name))
                   AND (owner = auth.uid() OR private.can_manage_project(auth.uid(), private.storage_path_entity(name)))
               END)$p$;
END $$;

-- ---------------------------------------------------------------------------
-- 8. The email worker's snapshot, as in 20260926000000_email_notifications.sql
--    with each project's owner and Project Manager added, so the management
--    summaries show a team lead only the projects they are part of.
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
