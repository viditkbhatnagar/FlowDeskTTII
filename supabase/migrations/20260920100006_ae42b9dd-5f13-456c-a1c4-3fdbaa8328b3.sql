DROP TRIGGER IF EXISTS track_work_task_activity_before ON public.work_tasks;
DROP TRIGGER IF EXISTS track_milestone_completion_after ON public.project_milestones;

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
  END IF;
  RETURN NEW;
END;
$$;

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
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id)
    VALUES (NEW.organization_id, 'task_completed', activity_actor, NEW.id, NEW.project_id);
  END IF;
  IF NEW.status = 'review' AND OLD.status IS DISTINCT FROM 'review' THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id)
    VALUES (NEW.organization_id, 'task_review_submitted', activity_actor, NEW.id, NEW.project_id);
  END IF;
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id, details)
    VALUES (NEW.organization_id, 'task_assignee_changed', activity_actor, NEW.id, NEW.project_id, jsonb_build_object('from', OLD.assignee_id, 'to', NEW.assignee_id));
  END IF;
  IF NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id, details)
    VALUES (NEW.organization_id, 'task_due_date_changed', activity_actor, NEW.id, NEW.project_id, jsonb_build_object('due_at', NEW.due_at, 'due_date', NEW.due_date));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.track_milestone_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, project_id, milestone_id)
    VALUES (NEW.organization_id, 'milestone_completed', COALESCE(auth.uid(), NEW.created_by), NEW.project_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_work_task_update_before
BEFORE UPDATE ON public.work_tasks
FOR EACH ROW EXECUTE FUNCTION private.prepare_work_task_update();

CREATE TRIGGER track_work_task_activity_after
AFTER INSERT OR UPDATE ON public.work_tasks
FOR EACH ROW EXECUTE FUNCTION private.track_work_task_activity();

CREATE TRIGGER track_milestone_completion_after
AFTER UPDATE ON public.project_milestones
FOR EACH ROW EXECUTE FUNCTION private.track_milestone_completion();

REVOKE ALL ON FUNCTION private.prepare_work_task_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.track_work_task_activity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.track_milestone_completion() FROM PUBLIC, anon, authenticated;