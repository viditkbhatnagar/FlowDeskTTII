CREATE TYPE public.work_task_status AS ENUM ('todo', 'progress', 'review', 'done', 'cancelled');
CREATE TYPE public.work_priority AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE public.project_lifecycle_status AS ENUM ('planning', 'active', 'on_hold', 'completed', 'cancelled', 'archived');
CREATE TYPE public.activity_event_type AS ENUM ('task_created', 'task_completed', 'task_review_submitted', 'task_assignee_changed', 'task_due_date_changed', 'milestone_completed');

CREATE OR REPLACE FUNCTION private.has_management_access(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles r
    JOIN public.organization_memberships m
      ON m.user_id = r.user_id AND m.organization_id = r.organization_id
    WHERE r.user_id = _user_id
      AND r.organization_id = _organization_id
      AND r.role IN ('admin', 'manager', 'team_lead')
      AND m.status = 'active'
  )
$$;
REVOKE ALL ON FUNCTION private.has_management_access(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_management_access(UUID, UUID) TO authenticated, service_role;

CREATE TABLE public.work_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL,
  start_date DATE,
  due_date DATE,
  status public.project_lifecycle_status NOT NULL DEFAULT 'planning',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_projects TO authenticated;
GRANT ALL ON public.work_projects TO service_role;
ALTER TABLE public.work_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view organization projects" ON public.work_projects FOR SELECT TO authenticated USING (private.has_organization_access(auth.uid(), organization_id));
CREATE POLICY "Managers can create organization projects" ON public.work_projects FOR INSERT TO authenticated WITH CHECK (private.has_management_access(auth.uid(), organization_id) AND owner_id = auth.uid());
CREATE POLICY "Managers can update organization projects" ON public.work_projects FOR UPDATE TO authenticated USING (private.has_management_access(auth.uid(), organization_id)) WITH CHECK (private.has_management_access(auth.uid(), organization_id));
CREATE POLICY "Admins can delete organization projects" ON public.work_projects FOR DELETE TO authenticated USING (private.has_organization_role(auth.uid(), organization_id, 'admin'));
CREATE TRIGGER update_work_projects_updated_at BEFORE UPDATE ON public.work_projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.work_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id UUID REFERENCES public.work_projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status public.work_task_status NOT NULL DEFAULT 'todo',
  priority public.work_priority NOT NULL DEFAULT 'medium',
  assignee_id UUID,
  reviewer_id UUID,
  created_by UUID NOT NULL,
  due_at TIMESTAMPTZ,
  due_date DATE,
  blocked BOOLEAN NOT NULL DEFAULT false,
  blocked_reason TEXT,
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  estimated_hours NUMERIC(8,2),
  tags TEXT[] NOT NULL DEFAULT '{}',
  archived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (due_at IS NULL OR due_date IS NULL),
  CHECK (NOT blocked OR status NOT IN ('done', 'cancelled'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_tasks TO authenticated;
GRANT ALL ON public.work_tasks TO service_role;
ALTER TABLE public.work_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "People can view assigned or managed tasks" ON public.work_tasks FOR SELECT TO authenticated USING (created_by = auth.uid() OR assignee_id = auth.uid() OR reviewer_id = auth.uid() OR private.has_management_access(auth.uid(), organization_id));
CREATE POLICY "Members can create organization tasks" ON public.work_tasks FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid() AND private.has_organization_access(auth.uid(), organization_id));
CREATE POLICY "People can update assigned or managed tasks" ON public.work_tasks FOR UPDATE TO authenticated USING (created_by = auth.uid() OR assignee_id = auth.uid() OR reviewer_id = auth.uid() OR private.has_management_access(auth.uid(), organization_id)) WITH CHECK (private.has_organization_access(auth.uid(), organization_id));
CREATE POLICY "Managers can delete organization tasks" ON public.work_tasks FOR DELETE TO authenticated USING (private.has_management_access(auth.uid(), organization_id));
CREATE TRIGGER update_work_tasks_updated_at BEFORE UPDATE ON public.work_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id UUID NOT NULL REFERENCES public.work_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  owner_id UUID,
  due_at TIMESTAMPTZ,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (due_at IS NULL OR due_date IS NULL)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_milestones TO authenticated;
GRANT ALL ON public.project_milestones TO service_role;
ALTER TABLE public.project_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view organization milestones" ON public.project_milestones FOR SELECT TO authenticated USING (private.has_organization_access(auth.uid(), organization_id));
CREATE POLICY "Managers can create organization milestones" ON public.project_milestones FOR INSERT TO authenticated WITH CHECK (private.has_management_access(auth.uid(), organization_id));
CREATE POLICY "Managers can update organization milestones" ON public.project_milestones FOR UPDATE TO authenticated USING (private.has_management_access(auth.uid(), organization_id)) WITH CHECK (private.has_management_access(auth.uid(), organization_id));
CREATE POLICY "Managers can delete organization milestones" ON public.project_milestones FOR DELETE TO authenticated USING (private.has_management_access(auth.uid(), organization_id));
CREATE TRIGGER update_project_milestones_updated_at BEFORE UPDATE ON public.project_milestones FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.work_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  event_type public.activity_event_type NOT NULL,
  actor_id UUID NOT NULL,
  task_id UUID REFERENCES public.work_tasks(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.work_projects(id) ON DELETE SET NULL,
  milestone_id UUID REFERENCES public.project_milestones(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.work_activity TO authenticated;
GRANT ALL ON public.work_activity TO service_role;
ALTER TABLE public.work_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "People can view authorized organization activity" ON public.work_activity FOR SELECT TO authenticated USING (private.has_management_access(auth.uid(), organization_id) OR actor_id = auth.uid() OR EXISTS (SELECT 1 FROM public.work_tasks t WHERE t.id = task_id AND (t.assignee_id = auth.uid() OR t.reviewer_id = auth.uid() OR t.created_by = auth.uid())));
CREATE POLICY "Members can create organization activity" ON public.work_activity FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid() AND private.has_organization_access(auth.uid(), organization_id));

CREATE OR REPLACE FUNCTION public.track_work_task_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id)
    VALUES (NEW.organization_id, 'task_created', NEW.created_by, NEW.id, NEW.project_id);
    RETURN NEW;
  END IF;

  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.progress := 100;
    NEW.blocked := false;
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id)
    VALUES (NEW.organization_id, 'task_completed', auth.uid(), NEW.id, NEW.project_id);
  ELSIF NEW.status IS DISTINCT FROM 'done' AND OLD.status = 'done' THEN
    NEW.completed_at := NULL;
  END IF;

  IF NEW.status = 'review' AND OLD.status IS DISTINCT FROM 'review' THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id)
    VALUES (NEW.organization_id, 'task_review_submitted', auth.uid(), NEW.id, NEW.project_id);
  END IF;
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id, details)
    VALUES (NEW.organization_id, 'task_assignee_changed', auth.uid(), NEW.id, NEW.project_id, jsonb_build_object('from', OLD.assignee_id, 'to', NEW.assignee_id));
  END IF;
  IF NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, task_id, project_id, details)
    VALUES (NEW.organization_id, 'task_due_date_changed', auth.uid(), NEW.id, NEW.project_id, jsonb_build_object('due_at', NEW.due_at, 'due_date', NEW.due_date));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER track_work_task_activity_before BEFORE INSERT OR UPDATE ON public.work_tasks FOR EACH ROW EXECUTE FUNCTION public.track_work_task_activity();

CREATE OR REPLACE FUNCTION public.track_milestone_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    INSERT INTO public.work_activity (organization_id, event_type, actor_id, project_id, milestone_id)
    VALUES (NEW.organization_id, 'milestone_completed', auth.uid(), NEW.project_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER track_milestone_completion_after AFTER UPDATE ON public.project_milestones FOR EACH ROW EXECUTE FUNCTION public.track_milestone_completion();

CREATE INDEX work_projects_org_status_idx ON public.work_projects (organization_id, status);
CREATE INDEX work_tasks_org_status_due_idx ON public.work_tasks (organization_id, status, due_date, due_at);
CREATE INDEX work_tasks_assignee_idx ON public.work_tasks (assignee_id, status);
CREATE INDEX work_tasks_reviewer_idx ON public.work_tasks (reviewer_id, status);
CREATE INDEX work_tasks_project_idx ON public.work_tasks (project_id);
CREATE INDEX project_milestones_org_due_idx ON public.project_milestones (organization_id, due_date, due_at);
CREATE INDEX work_activity_org_occurred_idx ON public.work_activity (organization_id, occurred_at DESC);