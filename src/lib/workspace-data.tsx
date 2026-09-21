import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { tasks as seedTasks, allPeople, type Priority, type Status, type Task } from "@/lib/mock-data";
import { supabase } from "@/integrations/supabase/client";
import { nextRecurrenceDate, recurrenceSummary, type RecurrenceRule } from "@/lib/recurrence";

export type WorkspaceTask = Task & {
  projectId?: string;
  startDate: string;
  subtasks: { id: string; title: string; completed: boolean }[];
  dependencies: string[];
  attachments: string[];
  comments: number;
  organizationId?: string;
  assigneeId?: string | null;
  reviewerId?: string | null;
  blocked: boolean;
  blockedReason?: string;
  createdAt: string;
  completedAt?: string | null;
  recurrenceId?: string | null;
  occurrenceNumber?: number | null;
  recurrence?: RecurrenceRule;
  recurrenceSummary?: string;
};

export type NewWorkspaceTask = Omit<WorkspaceTask, "id" | "progress" | "comments" | "blocked" | "createdAt" | "completedAt"> & {
  blocked?: boolean;
  blockedReason?: string;
};

export type WorkspaceStatus = "loading" | "ready" | "error";

type WorkspaceContextValue = {
  tasks: WorkspaceTask[];
  /**
   * Load state of the work_tasks query. Consumers must distinguish "still loading"
   * from "loaded and genuinely empty" — otherwise a slow network renders as an empty
   * board, and a failed query renders as an empty board too.
   */
  status: WorkspaceStatus;
  addTask: (task: NewWorkspaceTask) => WorkspaceTask;
  updateTask: (id: string, updates: Partial<WorkspaceTask>) => void;
};

const dayBefore = (iso: string, days: number) => {
  const date = new Date(iso);
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

const initialTasks: WorkspaceTask[] = seedTasks.map((task, index) => ({
  ...task,
  projectId:
    task.project === "Orbit Web"
      ? "P-1"
      : task.project === "Payments"
        ? "P-2"
        : task.project === "Platform"
          ? "P-3"
          : task.project === "Growth"
            ? "P-4"
            : task.project === "Operations"
              ? "P-5"
              : undefined,
  description:
    task.description ??
    `Complete ${task.title.toLowerCase()} with the project team and document the outcome.`,
  startDate: dayBefore(task.dueDate, 3 + (index % 4)),
  subtasks: [
    { id: `${task.id}-1`, title: "Prepare first draft", completed: task.progress >= 30 },
    { id: `${task.id}-2`, title: "Team review", completed: task.progress >= 70 },
    { id: `${task.id}-3`, title: "Final approval", completed: task.status === "done" },
  ],
  dependencies:
    index > 0 && index % 4 === 0 ? ([seedTasks[index - 1]?.id].filter(Boolean) as string[]) : [],
  attachments: index % 3 === 0 ? ["project-notes.pdf"] : [],
  comments: 2 + (index % 5),
  blocked: false,
  createdAt: dayBefore(task.dueDate, 8 + index),
  completedAt: null,
}));

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  // Seeded empty, NOT with the sample tasks in mock-data.ts. Seeding fabricated tasks
  // here meant a failed or slow query rendered twelve convincing fake tasks that a user
  // could not tell from their real work. An empty list plus an explicit status is honest.
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [status, setStatus] = useState<WorkspaceStatus>("loading");

  useEffect(() => {
    let active = true;
    const load = async () => {
      const [{ data: rows, error }, { data: profile }] = await Promise.all([
        supabase.from("work_tasks").select("*, work_projects(name), task_recurrences(*)").is("archived_at", null),
        supabase.auth.getUser(),
      ]);
      if (!active) return;
      if (error || !rows) {
        console.error("[flowdesk] failed to load work_tasks", error);
        setStatus("error");
        return;
      }
      const currentName = profile.user?.user_metadata?.full_name || profile.user?.email?.split("@")[0] || "Account";
      const currentPerson = allPeople.find((person) => person.name === currentName) ?? { name: currentName, initials: currentName.split(" ").map((part: string) => part[0]).join("").slice(0, 2).toUpperCase(), color: "oklch(0.62 0.18 250)" };
      setTasks(rows.filter((row) => row.status !== "cancelled").map((row) => {
        const storedRule = row.task_recurrences ? {
          frequency: row.task_recurrences.frequency as RecurrenceRule["frequency"],
          interval: row.task_recurrences.interval_count,
          weekdays: row.task_recurrences.weekdays,
          monthlyPattern: row.task_recurrences.monthly_pattern as RecurrenceRule["monthlyPattern"],
          creationMode: row.task_recurrences.creation_mode as RecurrenceRule["creationMode"],
          endMode: row.task_recurrences.end_mode as RecurrenceRule["endMode"],
          endDate: row.task_recurrences.end_date ?? undefined,
          maxOccurrences: row.task_recurrences.max_occurrences ?? undefined,
        } : undefined;
        return ({
        id: row.id,
        title: row.title,
        description: row.description ?? undefined,
        project: row.work_projects?.name ?? "No project",
        projectId: row.project_id ?? undefined,
        organizationId: row.organization_id,
        assignee: currentPerson,
        assigneeId: row.assignee_id,
        reviewerId: row.reviewer_id,
        status: row.status as Status,
        priority: row.priority as Priority,
        dueDate: row.due_at ?? `${row.due_date ?? new Date().toISOString().slice(0, 10)}T23:59:59`,
        startDate: row.created_at,
        progress: row.progress,
        estimatedHours: row.estimated_hours ?? 0,
        tags: row.tags,
        subtasks: [],
        dependencies: [],
        attachments: [],
        comments: 0,
        blocked: row.blocked,
        blockedReason: row.blocked_reason ?? undefined,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        recurrenceId: row.recurrence_id,
        occurrenceNumber: row.occurrence_number,
        recurrence: storedRule,
        recurrenceSummary: storedRule ? recurrenceSummary(storedRule) : undefined,
      }); }));
      setStatus("ready");
    };
    void load();
    return () => { active = false; };
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      tasks,
      status,
      addTask: (input) => {
        const number =
          Math.max(100, ...tasks.map((task) => Number(task.id.replace(/\D/g, "")) || 0)) + 1;
        const task: WorkspaceTask = {
          ...input,
          id: `T-${number}`,
          progress: input.status === "done" ? 100 : 0,
          comments: 0,
          blocked: input.blocked ?? false,
          createdAt: new Date().toISOString(),
          completedAt: input.status === "done" ? new Date().toISOString() : null,
        };
        setTasks((current) => [task, ...current]);
        void (async () => {
          const { data: auth } = await supabase.auth.getUser();
          if (!auth.user) return;
          const { data: membership } = await supabase.from("organization_memberships").select("organization_id").eq("user_id", auth.user.id).eq("status", "active").order("is_primary", { ascending: false }).limit(1).maybeSingle();
          if (!membership) return;
          const { data: project } = await supabase.from("work_projects").select("id").eq("organization_id", membership.organization_id).eq("name", input.project).maybeSingle();
           let recurrenceId: string | null = null;
           if (input.recurrence) {
             const nextDueDate = input.recurrence.creationMode === "on_schedule" ? nextRecurrenceDate(input.dueDate, input.recurrence) : null;
             const { data: recurrence } = await supabase.from("task_recurrences").insert({ organization_id: membership.organization_id, project_id: project?.id ?? null, created_by: auth.user.id, title: input.title, description: input.description ?? null, assignee_id: auth.user.id, reviewer_id: input.status === "review" ? auth.user.id : null, task_status: input.status, priority: input.priority, estimated_hours: input.estimatedHours, tags: input.tags ?? [], frequency: input.recurrence.frequency, interval_count: input.recurrence.interval, weekdays: input.recurrence.weekdays, monthly_pattern: input.recurrence.monthlyPattern, creation_mode: input.recurrence.creationMode, end_mode: input.recurrence.endMode, end_date: input.recurrence.endDate ?? null, max_occurrences: input.recurrence.maxOccurrences ?? null, next_due_date: nextDueDate }).select("id").single();
             recurrenceId = recurrence?.id ?? null;
           }
           const { data: created } = await supabase.from("work_tasks").insert({ organization_id: membership.organization_id, project_id: project?.id ?? null, title: input.title, description: input.description ?? null, status: input.status, priority: input.priority, assignee_id: auth.user.id, reviewer_id: input.status === "review" ? auth.user.id : null, created_by: auth.user.id, due_date: input.dueDate.slice(0, 10), blocked: input.blocked ?? false, blocked_reason: input.blockedReason ?? null, progress: task.progress, estimated_hours: input.estimatedHours, tags: input.tags ?? [], recurrence_id: recurrenceId, occurrence_number: recurrenceId ? 1 : null }).select("id, created_at, completed_at").single();
          if (created) {
             setTasks((current) => current.map((item) => item.id === task.id ? { ...item, id: created.id, organizationId: membership.organization_id, projectId: project?.id, assigneeId: auth.user.id, createdAt: created.created_at, completedAt: created.completed_at, recurrenceId, occurrenceNumber: recurrenceId ? 1 : null } : item));
            window.dispatchEvent(new Event("flowdesk-work-changed"));
          }
        })();
        return task;
      },
      updateTask: (id, updates) => {
        setTasks((current) =>
          current.map((task) => (task.id === id ? { ...task, ...updates } : task)),
        );
        const persisted = tasks.find((task) => task.id === id && task.organizationId);
        if (persisted) {
          const payload: import("@/integrations/supabase/types").Database["public"]["Tables"]["work_tasks"]["Update"] = {};
          if (updates.status !== undefined) payload.status = updates.status;
          if (updates.progress !== undefined) payload.progress = updates.progress;
          if (updates.blocked !== undefined) payload.blocked = updates.blocked;
          if (updates.blockedReason !== undefined) payload.blocked_reason = updates.blockedReason || null;
          if (updates.dueDate !== undefined) payload.due_date = updates.dueDate.slice(0, 10);
          if (Object.keys(payload).length) void supabase.from("work_tasks").update(payload).eq("id", id).then(() => window.dispatchEvent(new Event("flowdesk-work-changed")));
        }
      },
    }),
    [tasks, status],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return context;
}

export type { Priority, Status };
