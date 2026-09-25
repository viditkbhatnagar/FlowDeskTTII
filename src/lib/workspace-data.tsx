import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Priority, Status, Task } from "@/lib/mock-data";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { nextRecurrenceDate, recurrenceSummary, type RecurrenceRule } from "@/lib/recurrence";
import { personRef, uploadTaskFiles, type PersonRef } from "@/lib/task-api";

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export type WorkspaceTask = Task & {
  projectId?: string;
  /** Real start date when one was set, otherwise the creation time. */
  startDate: string;
  /** True only when a start date was actually saved (FD-032). */
  hasStartDate: boolean;
  subtasks: Subtask[];
  dependencies: string[];
  /** File names of saved attachments. */
  attachments: string[];
  /** Number of saved comments. */
  comments: number;
  organizationId?: string;
  assigneeId?: string | null;
  reviewerId?: string | null;
  blocked: boolean;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  recurrenceId?: string | null;
  occurrenceNumber?: number | null;
  recurrence?: RecurrenceRule;
  recurrenceSummary?: string;
};

export type NewWorkspaceTask = Omit<
  WorkspaceTask,
  "id" | "progress" | "comments" | "blocked" | "createdAt" | "updatedAt" | "completedAt" | "hasStartDate" | "attachments"
> & {
  blocked?: boolean;
  blockedReason?: string;
  /** The person picked in the form. Was ignored: the creator was always saved (FD-001). */
  assigneeId?: string | null;
  /** Files to upload once the task exists (FD-058). */
  files?: File[];
};

export type AddTaskResult =
  | { ok: true; task: WorkspaceTask; rejectedFiles: { name: string; reason: string }[] }
  | { ok: false; error: string };

export type WorkspaceStatus = "loading" | "ready" | "error";

type WorkspaceContextValue = {
  tasks: WorkspaceTask[];
  /**
   * Load state of the work_tasks query. Consumers must distinguish "still loading"
   * from "loaded and genuinely empty" — otherwise a slow network renders as an empty
   * board, and a failed query renders as an empty board too.
   */
  status: WorkspaceStatus;
  /** Everyone whose profile this user can see, for pickers and avatars. */
  people: PersonRef[];
  addTask: (task: NewWorkspaceTask) => Promise<AddTaskResult>;
  /** Optimistic; reverts and shows an error when the database refuses the write. */
  updateTask: (id: string, updates: Partial<WorkspaceTask>) => Promise<boolean>;
  /** Soft delete (archived_at), so history and activity survive (FD-006). */
  deleteTask: (id: string) => Promise<boolean>;
  addSubtask: (taskId: string, title: string) => Promise<boolean>;
  toggleSubtask: (taskId: string, subtaskId: string, completed: boolean) => Promise<boolean>;
  removeSubtask: (taskId: string, subtaskId: string) => Promise<boolean>;
  /** Re-read everything, e.g. after a recurring task spawns its next occurrence. */
  refresh: () => Promise<void>;
};

type TaskRow = Database["public"]["Tables"]["work_tasks"]["Row"] & {
  work_projects: { name: string } | null;
  task_recurrences: Database["public"]["Tables"]["task_recurrences"]["Row"] | null;
  task_subtasks: { id: string; title: string; completed: boolean; sort_order: number }[] | null;
  task_attachments: { id: string; file_name: string }[] | null;
  task_comments: { count: number }[] | null;
};

const TASK_SELECT =
  "*, work_projects(name), task_recurrences(*), task_subtasks(id, title, completed, sort_order), task_attachments(id, file_name), task_comments(count)";

const today = () => new Date().toISOString().slice(0, 10);

/** Progress is the subtask ratio when there are subtasks (mirrors the database trigger). */
function derivedProgress(task: Pick<WorkspaceTask, "status" | "progress" | "subtasks">): number {
  if (task.status === "done") return 100;
  if (!task.subtasks.length) return task.progress;
  return Math.round((task.subtasks.filter((s) => s.completed).length / task.subtasks.length) * 100);
}

function mapRow(row: TaskRow, personFor: (id: string | null | undefined) => PersonRef): WorkspaceTask {
  const rule = row.task_recurrences
    ? {
        frequency: row.task_recurrences.frequency as RecurrenceRule["frequency"],
        interval: row.task_recurrences.interval_count,
        weekdays: row.task_recurrences.weekdays,
        monthlyPattern: row.task_recurrences.monthly_pattern as RecurrenceRule["monthlyPattern"],
        creationMode: row.task_recurrences.creation_mode as RecurrenceRule["creationMode"],
        endMode: row.task_recurrences.end_mode as RecurrenceRule["endMode"],
        endDate: row.task_recurrences.end_date ?? undefined,
        maxOccurrences: row.task_recurrences.max_occurrences ?? undefined,
      }
    : undefined;
  const assignee = personFor(row.assignee_id);
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    project: row.work_projects?.name ?? "No project",
    projectId: row.project_id ?? undefined,
    organizationId: row.organization_id,
    assignee: { name: assignee.name, initials: assignee.initials, color: assignee.color },
    assigneeId: row.assignee_id,
    reviewerId: row.reviewer_id,
    status: row.status as Status,
    priority: row.priority as Priority,
    dueDate: row.due_at ?? `${row.due_date ?? today()}T23:59:59`,
    startDate: row.start_date ? `${row.start_date}T00:00:00` : row.created_at,
    hasStartDate: Boolean(row.start_date),
    progress: row.progress,
    // No estimate stays "no estimate"; turning it into 0 showed "0h" on cards.
    estimatedHours: row.estimated_hours ?? undefined,
    tags: row.tags ?? [],
    subtasks: [...(row.task_subtasks ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({ id: s.id, title: s.title, completed: s.completed })),
    dependencies: [],
    attachments: (row.task_attachments ?? []).map((a) => a.file_name),
    comments: row.task_comments?.[0]?.count ?? 0,
    blocked: row.blocked,
    blockedReason: row.blocked_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    recurrenceId: row.recurrence_id,
    occurrenceNumber: row.occurrence_number,
    recurrence: rule,
    recurrenceSummary: rule ? recurrenceSummary(rule) : undefined,
  };
}

/** Turn a Postgres/PostgREST error into something a person can act on. */
function friendlyError(error: unknown, fallback: string): string {
  const message = (error as { message?: string } | null)?.message ?? "";
  if (/row-level security|permission denied/i.test(message)) return "You don't have permission to do that.";
  // Messages raised by our own validation triggers are already written for people.
  if (/must be|cannot be|at most|or fewer/i.test(message)) return message;
  return fallback;
}

const announce = () => window.dispatchEvent(new Event("flowdesk-work-changed"));

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // Seeded empty, NOT with the sample tasks in mock-data.ts. Seeding fabricated tasks
  // here meant a failed or slow query rendered twelve convincing fake tasks that a user
  // could not tell from their real work. An empty list plus an explicit status is honest.
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [status, setStatus] = useState<WorkspaceStatus>("loading");
  const [people, setPeople] = useState<PersonRef[]>([]);
  // Latest tasks for callbacks that must not go stale between renders.
  const tasksRef = useRef<WorkspaceTask[]>([]);
  tasksRef.current = tasks;
  const peopleRef = useRef<Map<string, PersonRef>>(new Map());

  const personFor = useCallback(
    (id: string | null | undefined): PersonRef =>
      (id ? peopleRef.current.get(id) : undefined) ?? personRef(id, null),
    [],
  );

  const fetchAll = useCallback(async (): Promise<boolean> => {
    const [{ data: rows, error }, { data: profiles }] = await Promise.all([
      supabase.from("work_tasks").select(TASK_SELECT).is("archived_at", null),
      supabase.from("profiles").select("user_id, full_name, username"),
    ]);
    if (error || !rows) {
      console.error("[flowdesk] failed to load work_tasks", error);
      return false;
    }
    const map = new Map<string, PersonRef>();
    for (const p of profiles ?? []) map.set(p.user_id, personRef(p.user_id, p.full_name || p.username));
    peopleRef.current = map;
    setPeople([...map.values()].sort((a, b) => a.name.localeCompare(b.name)));
    setTasks(
      (rows as unknown as TaskRow[])
        .filter((row) => row.status !== "cancelled")
        .map((row) => mapRow(row, (id) => (id ? map.get(id) : undefined) ?? personRef(id, null))),
    );
    return true;
  }, []);

  useEffect(() => {
    let active = true;
    void fetchAll().then((ok) => {
      if (active) setStatus(ok ? "ready" : "error");
    });
    return () => {
      active = false;
    };
  }, [fetchAll]);

  const refresh = useCallback(async () => {
    const ok = await fetchAll();
    if (ok) setStatus("ready");
  }, [fetchAll]);

  /** Re-read one task so database-side changes (progress, tags, completed_at) show up. */
  const reloadTask = useCallback(async (id: string) => {
    const { data } = await supabase.from("work_tasks").select(TASK_SELECT).eq("id", id).maybeSingle();
    if (!data) return;
    const fresh = mapRow(data as unknown as TaskRow, personFor);
    setTasks((current) => current.map((task) => (task.id === id ? fresh : task)));
  }, [personFor]);

  const addTask = useCallback(async (input: NewWorkspaceTask): Promise<AddTaskResult> => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return { ok: false, error: "Your session has expired. Sign in again." };

    const { data: membership } = await supabase
      .from("organization_memberships")
      .select("organization_id")
      .eq("user_id", auth.user.id)
      .eq("status", "active")
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!membership) return { ok: false, error: "You are not a member of an active organization." };

    // A task belongs to its project's organization. Using the creator's primary
    // organization would file a task for another organization's project in the
    // wrong place (RLS would then hide it from that project's members).
    let organizationId = membership.organization_id;
    if (input.projectId) {
      const { data: owner } = await supabase
        .from("work_projects")
        .select("organization_id")
        .eq("id", input.projectId)
        .maybeSingle();
      if (owner) organizationId = owner.organization_id;
    }

    const projectId =
      input.projectId ??
      (
        await supabase
          .from("work_projects")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("name", input.project)
          .maybeSingle()
      ).data?.id ??
      null;

    // The person picked in the form. This used to be auth.user.id unconditionally,
    // so every task was silently assigned to its creator (FD-001).
    const assigneeId = input.assigneeId === undefined ? auth.user.id : input.assigneeId;

    let recurrenceId: string | null = null;
    if (input.recurrence) {
      const nextDueDate =
        input.recurrence.creationMode === "on_schedule" ? nextRecurrenceDate(input.dueDate, input.recurrence) : null;
      const { data: recurrence, error: recurrenceError } = await supabase
        .from("task_recurrences")
        .insert({
          organization_id: organizationId,
          project_id: projectId,
          created_by: auth.user.id,
          title: input.title,
          description: input.description ?? null,
          assignee_id: assigneeId,
          reviewer_id: input.status === "review" ? auth.user.id : null,
          task_status: input.status,
          priority: input.priority,
          estimated_hours: input.estimatedHours,
          tags: input.tags ?? [],
          frequency: input.recurrence.frequency,
          interval_count: input.recurrence.interval,
          weekdays: input.recurrence.weekdays,
          monthly_pattern: input.recurrence.monthlyPattern,
          creation_mode: input.recurrence.creationMode,
          end_mode: input.recurrence.endMode,
          end_date: input.recurrence.endDate ?? null,
          max_occurrences: input.recurrence.maxOccurrences ?? null,
          next_due_date: nextDueDate,
        })
        .select("id")
        .single();
      // Previously ignored: a rejected rule (e.g. "every -3 weeks") still created
      // the task, without its recurrence, while the UI claimed it repeated (FD-064).
      if (recurrenceError || !recurrence) {
        console.error("[flowdesk] recurrence insert failed", recurrenceError);
        return { ok: false, error: friendlyError(recurrenceError, "The repeat schedule could not be saved.") };
      }
      recurrenceId = recurrence.id;
    }

    const { data: created, error } = await supabase
      .from("work_tasks")
      .insert({
        organization_id: organizationId,
        project_id: projectId,
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        assignee_id: assigneeId,
        reviewer_id: input.status === "review" ? auth.user.id : null,
        created_by: auth.user.id,
        start_date: input.startDate ? input.startDate.slice(0, 10) : null,
        due_date: input.dueDate.slice(0, 10),
        blocked: input.blocked ?? false,
        blocked_reason: input.blockedReason ?? null,
        progress: input.status === "done" ? 100 : 0,
        estimated_hours: input.estimatedHours,
        tags: input.tags ?? [],
        recurrence_id: recurrenceId,
        occurrence_number: recurrenceId ? 1 : null,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[flowdesk] task insert failed", error);
      if (recurrenceId) await supabase.from("task_recurrences").delete().eq("id", recurrenceId);
      return { ok: false, error: friendlyError(error, "The task could not be created.") };
    }

    // Subtasks the user typed into the form. They were discarded before (FD-004).
    const subtaskTitles = (input.subtasks ?? []).map((s) => s.title.trim()).filter(Boolean);
    if (subtaskTitles.length) {
      const { error: subtaskError } = await supabase.from("task_subtasks").insert(
        subtaskTitles.map((title, index) => ({ task_id: created.id, title, sort_order: index + 1 })),
      );
      if (subtaskError) console.error("[flowdesk] subtask insert failed", subtaskError);
    }

    let rejectedFiles: { name: string; reason: string }[] = [];
    if (input.files?.length) {
      const upload = await uploadTaskFiles({ id: created.id, organizationId }, input.files);
      rejectedFiles = upload.rejected;
    }

    const { data: row } = await supabase.from("work_tasks").select(TASK_SELECT).eq("id", created.id).single();
    const task = row
      ? mapRow(row as unknown as TaskRow, personFor)
      : ({ ...input, id: created.id } as unknown as WorkspaceTask);
    setTasks((current) => [task, ...current]);
    announce();
    return { ok: true, task, rejectedFiles };
  }, [personFor]);

  const updateTask = useCallback(async (id: string, updates: Partial<WorkspaceTask>): Promise<boolean> => {
    const before = tasksRef.current.find((task) => task.id === id);
    if (!before) return false;

    const next: WorkspaceTask = { ...before, ...updates };
    // Clearing the start date falls back to the creation time, as on load.
    if (updates.startDate !== undefined && !updates.startDate) {
      next.startDate = before.createdAt;
      next.hasStartDate = false;
    } else if (updates.startDate) {
      next.hasStartDate = true;
    }
    if (updates.assigneeId !== undefined) {
      const person = personFor(updates.assigneeId);
      next.assignee = { name: person.name, initials: person.initials, color: person.color };
    }
    if (updates.status !== undefined || updates.subtasks !== undefined) next.progress = derivedProgress(next);
    setTasks((current) => current.map((task) => (task.id === id ? next : task)));

    if (!before.organizationId) return true;

    const payload: Database["public"]["Tables"]["work_tasks"]["Update"] = {};
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.description !== undefined) payload.description = updates.description || null;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.priority !== undefined) payload.priority = updates.priority;
    if (updates.assigneeId !== undefined) payload.assignee_id = updates.assigneeId;
    if (updates.reviewerId !== undefined) payload.reviewer_id = updates.reviewerId;
    if (updates.blocked !== undefined) payload.blocked = updates.blocked;
    if (updates.blockedReason !== undefined) payload.blocked_reason = updates.blockedReason || null;
    if (updates.dueDate !== undefined) {
      payload.due_date = updates.dueDate.slice(0, 10);
      // The table allows only one of due_at / due_date. Rows that carry due_at
      // (the seeded ones do) refused every due-date edit until it was cleared.
      payload.due_at = null;
    }
    if (updates.startDate !== undefined) payload.start_date = updates.startDate ? updates.startDate.slice(0, 10) : null;
    if (updates.estimatedHours !== undefined) payload.estimated_hours = updates.estimatedHours;
    if (updates.tags !== undefined) payload.tags = updates.tags;
    if (updates.projectId !== undefined) payload.project_id = updates.projectId || null;
    // Progress is only written directly for tasks without subtasks; otherwise
    // the database derives it from the subtasks.
    if (updates.progress !== undefined && !before.subtasks.length) payload.progress = updates.progress;
    if (!Object.keys(payload).length) return true;

    const { error } = await supabase.from("work_tasks").update(payload).eq("id", id);
    if (error) {
      console.error("[flowdesk] task update failed", error);
      setTasks((current) => current.map((task) => (task.id === id ? before : task)));
      toast.error(friendlyError(error, "Your change could not be saved."));
      return false;
    }

    // Completing a recurring task can create its next occurrence server-side;
    // pull it in now instead of on the next full reload (FD-065).
    if (updates.status === "done" && before.recurrenceId) await refresh();
    else await reloadTask(id);
    announce();
    return true;
  }, [personFor, refresh, reloadTask]);

  const deleteTask = useCallback(async (id: string): Promise<boolean> => {
    const before = tasksRef.current.find((task) => task.id === id);
    if (!before) return false;
    setTasks((current) => current.filter((task) => task.id !== id));
    const { error } = await supabase.from("work_tasks").update({ archived_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      console.error("[flowdesk] task delete failed", error);
      setTasks((current) => [before, ...current]);
      toast.error(friendlyError(error, "The task could not be deleted."));
      return false;
    }
    announce();
    return true;
  }, []);

  const setSubtasksLocally = useCallback((taskId: string, change: (subtasks: Subtask[]) => Subtask[]) => {
    setTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) return task;
        const subtasks = change(task.subtasks);
        return { ...task, subtasks, progress: derivedProgress({ ...task, subtasks }) };
      }),
    );
  }, []);

  const addSubtask = useCallback(async (taskId: string, title: string): Promise<boolean> => {
    const text = title.trim();
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!text || !task) return false;
    const { data, error } = await supabase
      .from("task_subtasks")
      .insert({ task_id: taskId, title: text, sort_order: task.subtasks.length + 1 })
      .select("id, title, completed")
      .single();
    if (error || !data) {
      console.error("[flowdesk] subtask insert failed", error);
      toast.error(friendlyError(error, "The subtask could not be added."));
      return false;
    }
    setSubtasksLocally(taskId, (subtasks) => [...subtasks, data]);
    announce();
    return true;
  }, [setSubtasksLocally]);

  const toggleSubtask = useCallback(async (taskId: string, subtaskId: string, completed: boolean): Promise<boolean> => {
    setSubtasksLocally(taskId, (subtasks) => subtasks.map((s) => (s.id === subtaskId ? { ...s, completed } : s)));
    const { error } = await supabase.from("task_subtasks").update({ completed }).eq("id", subtaskId);
    if (error) {
      console.error("[flowdesk] subtask update failed", error);
      setSubtasksLocally(taskId, (subtasks) => subtasks.map((s) => (s.id === subtaskId ? { ...s, completed: !completed } : s)));
      toast.error(friendlyError(error, "The subtask could not be updated."));
      return false;
    }
    await reloadTask(taskId);
    announce();
    return true;
  }, [reloadTask, setSubtasksLocally]);

  const removeSubtask = useCallback(async (taskId: string, subtaskId: string): Promise<boolean> => {
    const task = tasksRef.current.find((t) => t.id === taskId);
    const removed = task?.subtasks.find((s) => s.id === subtaskId);
    if (!task || !removed) return false;
    setSubtasksLocally(taskId, (subtasks) => subtasks.filter((s) => s.id !== subtaskId));
    const { error } = await supabase.from("task_subtasks").delete().eq("id", subtaskId);
    if (error) {
      console.error("[flowdesk] subtask delete failed", error);
      setSubtasksLocally(taskId, () => task.subtasks);
      toast.error(friendlyError(error, "The subtask could not be removed."));
      return false;
    }
    await reloadTask(taskId);
    announce();
    return true;
  }, [reloadTask, setSubtasksLocally]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({ tasks, status, people, addTask, updateTask, deleteTask, addSubtask, toggleSubtask, removeSubtask, refresh }),
    [tasks, status, people, addTask, updateTask, deleteTask, addSubtask, toggleSubtask, removeSubtask, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}

export type { Priority, Status };
