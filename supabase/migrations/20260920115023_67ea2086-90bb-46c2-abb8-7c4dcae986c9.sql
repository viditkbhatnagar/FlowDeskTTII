CREATE TABLE public.task_recurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.work_projects(id) ON DELETE SET NULL,
  created_by uuid NOT NULL,
  title text NOT NULL,
  description text,
  assignee_id uuid,
  reviewer_id uuid,
  task_status public.work_task_status NOT NULL DEFAULT 'todo',
  priority public.work_priority NOT NULL DEFAULT 'medium',
  estimated_hours numeric,
  tags text[] NOT NULL DEFAULT '{}',
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval_count integer NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 365),
  weekdays smallint[] NOT NULL DEFAULT '{}',
  monthly_pattern text NOT NULL DEFAULT 'day_of_month' CHECK (monthly_pattern IN ('day_of_month', 'weekday_pattern')),
  creation_mode text NOT NULL DEFAULT 'after_completion' CHECK (creation_mode IN ('on_schedule', 'after_completion')),
  end_mode text NOT NULL DEFAULT 'never' CHECK (end_mode IN ('never', 'on_date', 'after_count')),
  end_date date,
  max_occurrences integer CHECK (max_occurrences IS NULL OR max_occurrences BETWEEN 2 AND 1000),
  next_due_date date,
  occurrences_created integer NOT NULL DEFAULT 1 CHECK (occurrences_created >= 1),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_mode <> 'on_date' OR end_date IS NOT NULL),
  CHECK (end_mode <> 'after_count' OR max_occurrences IS NOT NULL),
  CHECK (frequency <> 'weekly' OR cardinality(weekdays) > 0)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_recurrences TO authenticated;
GRANT ALL ON public.task_recurrences TO service_role;

ALTER TABLE public.task_recurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view accessible task recurrences"
ON public.task_recurrences FOR SELECT TO authenticated
USING (private.has_organization_access(auth.uid(), organization_id));

CREATE POLICY "Members can create task recurrences"
ON public.task_recurrences FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND private.has_organization_access(auth.uid(), organization_id));

CREATE POLICY "Creators and managers can update task recurrences"
ON public.task_recurrences FOR UPDATE TO authenticated
USING (created_by = auth.uid() OR private.has_management_access(auth.uid(), organization_id))
WITH CHECK (private.has_organization_access(auth.uid(), organization_id));

CREATE POLICY "Creators and managers can delete task recurrences"
ON public.task_recurrences FOR DELETE TO authenticated
USING (created_by = auth.uid() OR private.has_management_access(auth.uid(), organization_id));

CREATE TRIGGER update_task_recurrences_updated_at
BEFORE UPDATE ON public.task_recurrences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.work_tasks
  ADD COLUMN recurrence_id uuid REFERENCES public.task_recurrences(id) ON DELETE SET NULL,
  ADD COLUMN occurrence_number integer;

CREATE UNIQUE INDEX work_tasks_recurrence_occurrence_unique
ON public.work_tasks(recurrence_id, occurrence_number)
WHERE recurrence_id IS NOT NULL;

CREATE INDEX task_recurrences_next_due_idx
ON public.task_recurrences(next_due_date)
WHERE active = true AND creation_mode = 'on_schedule';

CREATE OR REPLACE FUNCTION private.next_recurrence_date(
  p_current date,
  p_frequency text,
  p_interval integer,
  p_weekdays smallint[],
  p_monthly_pattern text
) RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, private
AS $$
DECLARE
  candidate date;
  offset_days integer;
  current_dow integer;
  target_dow integer;
  ordinal integer;
  last_day date;
BEGIN
  IF p_frequency = 'daily' THEN
    RETURN p_current + p_interval;
  ELSIF p_frequency = 'weekly' THEN
    FOR offset_days IN 1..(7 * p_interval) LOOP
      candidate := p_current + offset_days;
      IF extract(dow from candidate)::integer = ANY(p_weekdays)
         AND (offset_days < 7 OR extract(dow from candidate)::integer <= extract(dow from p_current)::integer OR p_interval = 1) THEN
        RETURN candidate;
      END IF;
    END LOOP;
    RETURN p_current + (7 * p_interval);
  ELSIF p_frequency = 'monthly' AND p_monthly_pattern = 'weekday_pattern' THEN
    current_dow := extract(dow from p_current)::integer;
    ordinal := ((extract(day from p_current)::integer - 1) / 7) + 1;
    candidate := (date_trunc('month', p_current) + make_interval(months => p_interval))::date;
    candidate := candidate + ((current_dow - extract(dow from candidate)::integer + 7) % 7) + ((ordinal - 1) * 7);
    last_day := (date_trunc('month', candidate) + interval '1 month - 1 day')::date;
    IF candidate > last_day THEN candidate := candidate - 7; END IF;
    RETURN candidate;
  ELSIF p_frequency = 'monthly' THEN
    RETURN (p_current + make_interval(months => p_interval))::date;
  ELSE
    RETURN (p_current + make_interval(years => p_interval))::date;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.create_next_recurring_task(p_recurrence_id uuid, p_base_due_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  recurrence public.task_recurrences%ROWTYPE;
  due_date_value date;
  created_task_id uuid;
  next_number integer;
BEGIN
  SELECT * INTO recurrence FROM public.task_recurrences WHERE id = p_recurrence_id FOR UPDATE;
  IF NOT FOUND OR NOT recurrence.active THEN RETURN NULL; END IF;
  IF recurrence.end_mode = 'after_count' AND recurrence.occurrences_created >= recurrence.max_occurrences THEN
    UPDATE public.task_recurrences SET active = false, next_due_date = NULL WHERE id = recurrence.id;
    RETURN NULL;
  END IF;

  due_date_value := CASE
    WHEN recurrence.creation_mode = 'on_schedule' AND recurrence.next_due_date IS NOT NULL THEN recurrence.next_due_date
    ELSE private.next_recurrence_date(p_base_due_date, recurrence.frequency, recurrence.interval_count, recurrence.weekdays, recurrence.monthly_pattern)
  END;

  IF recurrence.end_mode = 'on_date' AND due_date_value > recurrence.end_date THEN
    UPDATE public.task_recurrences SET active = false, next_due_date = NULL WHERE id = recurrence.id;
    RETURN NULL;
  END IF;

  next_number := recurrence.occurrences_created + 1;
  INSERT INTO public.work_tasks (
    organization_id, project_id, title, description, status, priority, assignee_id, reviewer_id,
    created_by, due_date, blocked, progress, estimated_hours, tags, recurrence_id, occurrence_number
  ) VALUES (
    recurrence.organization_id, recurrence.project_id, recurrence.title, recurrence.description,
    recurrence.task_status, recurrence.priority, recurrence.assignee_id, recurrence.reviewer_id,
    recurrence.created_by, due_date_value, false, 0, recurrence.estimated_hours, recurrence.tags,
    recurrence.id, next_number
  )
  ON CONFLICT (recurrence_id, occurrence_number) WHERE recurrence_id IS NOT NULL DO NOTHING
  RETURNING id INTO created_task_id;

  IF created_task_id IS NOT NULL THEN
    UPDATE public.task_recurrences
    SET occurrences_created = next_number,
        next_due_date = CASE WHEN creation_mode = 'on_schedule'
          THEN private.next_recurrence_date(due_date_value, frequency, interval_count, weekdays, monthly_pattern)
          ELSE NULL END
    WHERE id = recurrence.id;
  END IF;
  RETURN created_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.generate_recurring_task_after_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE mode_value text;
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' AND NEW.recurrence_id IS NOT NULL THEN
    SELECT creation_mode INTO mode_value FROM public.task_recurrences WHERE id = NEW.recurrence_id;
    IF mode_value = 'after_completion' THEN
      PERFORM private.create_next_recurring_task(NEW.recurrence_id, COALESCE(NEW.due_date, CURRENT_DATE));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER generate_recurring_task_after_completion
AFTER UPDATE OF status ON public.work_tasks
FOR EACH ROW EXECUTE FUNCTION private.generate_recurring_task_after_completion();

CREATE OR REPLACE FUNCTION public.process_scheduled_task_recurrences()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE item record; generated_count integer := 0;
BEGIN
  FOR item IN
    SELECT id, next_due_date FROM public.task_recurrences
    WHERE active = true AND creation_mode = 'on_schedule' AND next_due_date <= CURRENT_DATE
    ORDER BY next_due_date
    FOR UPDATE SKIP LOCKED
  LOOP
    IF private.create_next_recurring_task(item.id, item.next_due_date) IS NOT NULL THEN
      generated_count := generated_count + 1;
    END IF;
  END LOOP;
  RETURN generated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.process_scheduled_task_recurrences() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_scheduled_task_recurrences() TO service_role;
REVOKE ALL ON FUNCTION private.next_recurrence_date(date, text, integer, smallint[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.create_next_recurring_task(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.generate_recurring_task_after_completion() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-task-recurrences') THEN
      PERFORM cron.schedule('process-scheduled-task-recurrences', '15 * * * *', 'SELECT public.process_scheduled_task_recurrences()');
    END IF;
  END IF;
END $$;