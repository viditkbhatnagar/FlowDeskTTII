-- 14 Oct 2026: repeating group tasks (Sharon, 14 Oct: "When adding multiple
-- people to a task, we aren't able to turn on the recurring task option").
--
-- A repeat schedule can now hold the people of a group task (assignee_ids).
-- Each time it comes round, Flowdesk makes a new group task with a part for
-- each of them. The first group task is made by create_group_task with the
-- schedule's id (p_task.recurrenceId).
--
-- Needs 20261009000000 and 20261014000000. Safe to run twice.

DO $pre$
BEGIN
  IF to_regprocedure('public.create_group_task(jsonb, uuid[], text[])') IS NULL
     OR to_regprocedure('private.guard_task_move()') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261009000000 and 20261014000000 first';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1. The schedule's people
-- ---------------------------------------------------------------------------
ALTER TABLE public.task_recurrences ADD COLUMN IF NOT EXISTS assignee_ids UUID[];
ALTER TABLE public.task_recurrences DROP CONSTRAINT IF EXISTS task_recurrences_group_people;
ALTER TABLE public.task_recurrences ADD CONSTRAINT task_recurrences_group_people
  CHECK (assignee_ids IS NULL OR (cardinality(assignee_ids) >= 2 AND assignee_id IS NULL));

-- Its people see that their group task repeats (the task embeds its schedule).
DROP POLICY IF EXISTS "People can view their recurring tasks" ON public.task_recurrences;
CREATE POLICY "People can view their recurring tasks" ON public.task_recurrences
  FOR SELECT TO authenticated
  USING (CASE WHEN project_id IS NULL THEN private.has_organization_access(auth.uid(), organization_id)
         ELSE created_by = auth.uid()
              OR project_id IN (SELECT private.accessible_project_ids(auth.uid()))
              OR ((assignee_id = auth.uid() OR reviewer_id = auth.uid()
                   OR auth.uid() = ANY (COALESCE(assignee_ids, '{}')))
                  AND private.has_organization_access(auth.uid(), organization_id))
         END);

-- ---------------------------------------------------------------------------
-- 2. The group guard, as in 20261009000000, except that parts the database
--    itself makes (a repeating group task coming round) skip the "only its
--    creator or an admin adds people" check.
-- ---------------------------------------------------------------------------
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
  -- Not when the database itself makes the parts (trigger depth > 1): the
  -- next time a repeating group task comes round, it is made as whoever
  -- finished the last part (14 Oct).
  IF v_actor IS NOT NULL AND v_joining AND pg_trigger_depth() <= 1 THEN
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

-- ---------------------------------------------------------------------------
-- 3. create_group_task, as in 20261009000000, plus p_task.recurrenceId.
-- ---------------------------------------------------------------------------
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
  v_recurrence UUID;
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
    v_recurrence := NULLIF(p_task->>'recurrenceId', '')::UUID;
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

  -- A repeating group task (14 Oct): the schedule its creator just saved for
  -- these people, not yet used by any task.
  IF v_recurrence IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.task_recurrences r
        WHERE r.id = v_recurrence AND r.created_by = v_uid AND r.organization_id = v_org
          AND r.assignee_id IS NULL AND cardinality(COALESCE(r.assignee_ids, '{}')) >= 2
          AND NOT EXISTS (SELECT 1 FROM public.work_tasks w WHERE w.recurrence_id = r.id)) THEN
    RAISE EXCEPTION 'That repeat schedule can''t be used for this task' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.work_tasks (
    organization_id, project_id, title, description, status, priority, assignee_id, reviewer_id,
    created_by, due_date, due_at, start_date, estimated_hours, tags, progress, completed_at,
    recurrence_id, occurrence_number
  ) VALUES (
    v_org, v_project, v_title, v_description, v_status, v_priority, NULL, v_reviewer,
    v_uid, v_due_date, v_due_at, v_start_date, v_estimate, v_tags,
    CASE WHEN v_status = 'done' THEN 100 ELSE 0 END,
    CASE WHEN v_status = 'done' THEN now() END,
    v_recurrence, CASE WHEN v_recurrence IS NOT NULL THEN 1 END
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

-- ---------------------------------------------------------------------------
-- 4. The next occurrence. A single task as before; a group task comes round as
--    a new group task with a part for each of its people who is still an
--    active member (anyone who has left is skipped; with nobody left the
--    schedule stops).
-- ---------------------------------------------------------------------------
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
  people uuid[];
  person uuid;
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

  IF cardinality(COALESCE(recurrence.assignee_ids, '{}')) > 0 THEN
    SELECT COALESCE(array_agg(a ORDER BY ord), '{}') INTO people
      FROM unnest(recurrence.assignee_ids) WITH ORDINALITY AS u(a, ord)
     WHERE private.has_organization_access(a, recurrence.organization_id);
    IF cardinality(people) = 0 THEN
      UPDATE public.task_recurrences SET active = false, next_due_date = NULL WHERE id = recurrence.id;
      RETURN NULL;
    END IF;
  END IF;

  next_number := recurrence.occurrences_created + 1;
  INSERT INTO public.work_tasks (
    organization_id, project_id, title, description, status, priority, assignee_id, reviewer_id,
    created_by, due_date, blocked, progress, estimated_hours, tags, recurrence_id, occurrence_number
  ) VALUES (
    recurrence.organization_id, recurrence.project_id, recurrence.title, recurrence.description,
    recurrence.task_status, recurrence.priority,
    CASE WHEN people IS NULL THEN recurrence.assignee_id END, recurrence.reviewer_id,
    recurrence.created_by, due_date_value, false, 0, recurrence.estimated_hours, recurrence.tags,
    recurrence.id, next_number
  )
  ON CONFLICT (recurrence_id, occurrence_number) WHERE recurrence_id IS NOT NULL DO NOTHING
  RETURNING id INTO created_task_id;

  IF created_task_id IS NOT NULL AND people IS NOT NULL THEN
    FOREACH person IN ARRAY people LOOP
      INSERT INTO public.work_tasks (
        organization_id, project_id, parent_task_id, title, description, status, priority, assignee_id,
        reviewer_id, created_by, due_date, blocked, progress, estimated_hours, tags
      ) VALUES (
        recurrence.organization_id, recurrence.project_id, created_task_id, recurrence.title,
        recurrence.description, recurrence.task_status, recurrence.priority, person,
        recurrence.reviewer_id, recurrence.created_by, due_date_value, false, 0,
        recurrence.estimated_hours, recurrence.tags
      );
    END LOOP;
  END IF;

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
REVOKE ALL ON FUNCTION private.create_next_recurring_task(uuid, date) FROM PUBLIC, anon, authenticated;
