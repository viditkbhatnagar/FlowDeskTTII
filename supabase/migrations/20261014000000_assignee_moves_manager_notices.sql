-- 14 Oct 2026, after the 10 Oct release (20261009000000_task_groups_visibility_links.sql).
--
-- 1. Only the person a task is assigned to moves it (Naji, 14 Oct: "even the
--    managers or admin shouldn't be able to move"). Two exceptions keep work
--    from getting stuck: the task's reviewer may approve or send back a task
--    that is waiting for approval, and a task with nobody assigned is moved by
--    whoever made it. A group task still moves only with its parts.
-- 2. A person's managers (reporting manager, department head, team lead) get an
--    in-app notification when that person creates a task (Sharon, 14 Oct).
--
-- Needs 20261009000000 (private.manages_person, private.notify). Safe to run twice.

DO $pre$
BEGIN
  IF to_regprocedure('private.manages_person(uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('private.notify(uuid, uuid, text, uuid, uuid, uuid, jsonb, text)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261009000000_task_groups_visibility_links.sql first';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Moving a task
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.guard_task_move()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  -- The SQL editor and the service role (no signed-in user) and changes made
  -- by other triggers (a group task following its parts) are not checked.
  IF v_actor IS NULL OR pg_trigger_depth() > 1 OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.assignee_id = v_actor
     OR (OLD.assignee_id IS NULL AND OLD.created_by = v_actor)
     OR (OLD.status = 'review' AND OLD.reviewer_id = v_actor) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only the person this task is assigned to can move it' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.guard_task_move() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS work_task_move_guard_before ON public.work_tasks;
CREATE TRIGGER work_task_move_guard_before
  BEFORE UPDATE OF status ON public.work_tasks
  FOR EACH ROW EXECUTE FUNCTION private.guard_task_move();

-- ---------------------------------------------------------------------------
-- 2. A person's managers: the active people who manage them there
--    (private.manages_person), never themselves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.managers_of(_person UUID, _organization_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT x.manager_id
    FROM public.organization_memberships m
    LEFT JOIN public.departments d ON d.id = m.department_id
    LEFT JOIN public.teams tm ON tm.id = m.team_id
    CROSS JOIN LATERAL (VALUES (m.reporting_manager_id), (d.head_user_id), (tm.lead_user_id)) AS x(manager_id)
   WHERE m.user_id = _person
     AND m.organization_id = _organization_id
     AND m.status = 'active'
     AND x.manager_id IS NOT NULL
     AND x.manager_id <> _person
     AND private.has_organization_access(x.manager_id, _organization_id)
$$;
REVOKE ALL ON FUNCTION private.managers_of(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.managers_of(UUID, UUID) TO service_role;

-- notify_work_task as in 20261009000000, plus the creator's managers on a new task.
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
      -- A new task: the creator's managers hear of it (14 Oct: "managers
      -- aren't getting a notification when their team members create a
      -- task"). Once per group task, not once per person's part.
      IF NEW.parent_task_id IS NULL THEN
        FOR v_watcher IN SELECT private.managers_of(NEW.created_by, NEW.organization_id) LOOP
          CONTINUE WHEN v_watcher = ANY (v_done) OR v_watcher = v_actor;
          PERFORM private.notify(v_watcher, NEW.organization_id, 'task_created_in_project', v_actor, NEW.id,
                                 NEW.project_id, v_payload || jsonb_build_object('byTeamMember', true),
                                 'task_created_in_project:' || NEW.id || ':' || v_key);
          v_done := v_done || v_watcher;
        END LOOP;
      END IF;
      -- A new task in a project someone owns or runs (a group task once, not
      -- once per person). private.notify skips anyone who can't open the task.
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
