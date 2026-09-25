import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Priority, Status } from "@/lib/mock-data";
import { useWorkspace, type WorkspaceTask } from "@/lib/workspace-data";
import { useOrganizations } from "@/lib/organizations-data";
import { useTaskSettings } from "@/lib/task-settings-data";
import { colorFor, describeActivity, listRecentActivity, type ActivityEntry } from "@/lib/task-api";
import { todayIn } from "@/lib/today";
import { WorkspaceState } from "@/components/workspace/WorkspaceState";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Plus,
  LayoutGrid,
  Table as TableIcon,
  GanttChart,
  Users,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  MessageSquare,
  Search,
  Filter,
  Flame,
  ShieldAlert,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

interface TeamTask extends WorkspaceTask {
  department: string;
}

// One column per real status. There used to be "Backlog" and "Assigned" columns,
// neither of which exists in Settings › Task Status: both were `todo`, split first
// by row parity and later by "has an assignee", so a To Do card sat in the wrong
// column and drops onto either snapped back (FD-010, FD-061).
const BOARD_STATUSES: Status[] = ["todo", "progress", "review", "done"];
const statusDot: Record<Status, string> = {
  todo: "bg-status-todo",
  progress: "bg-status-progress",
  review: "bg-status-review",
  done: "bg-status-done",
};

const priorityClass: Record<Priority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-status-review/15 text-status-review",
  high: "bg-priority-high/15 text-priority-high",
  critical: "bg-destructive/15 text-destructive",
};

const NO_DEPARTMENT = "No department";
const UNASSIGNED = "__unassigned";
const isOpen = (status: string) => status !== "done" && status !== "cancelled";
const dueDay = (task: WorkspaceTask) => task.dueDate.slice(0, 10);

/** The calendar date of an instant in the organization's timezone (UTC when unknown), as yyyy-mm-dd. */
function dayIn(iso: string, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** "8m ago", "3h ago", "Yesterday", "4d ago", then a date. */
function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "Yesterday";
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Whether a task belongs in the view a dashboard card linked to. Unknown filters filter nothing. */
function matchesDashboardFilter(task: TeamTask, filter: string | undefined, today: string): boolean {
  if (!filter || filter.startsWith("task:")) return true;
  const open = isOpen(task.status);
  const overdue = open && dueDay(task) < today;
  if (filter === "open") return open;
  if (filter === "due-today") return open && dueDay(task) === today;
  if (filter === "overdue") return overdue;
  if (filter === "review") return task.status === "review";
  if (filter === "completed") return task.status === "done";
  if (filter === "blocked") return open && task.blocked;
  if (filter === "attention") return open && (task.blocked || task.status === "review" || task.priority === "critical" || overdue);
  if (filter.startsWith("assignee:")) return task.assigneeId === filter.slice(9);
  return true;
}

/**
 * Team workload, computed from the tasks in view.
 *
 * This was five invented people with the literal arrays [7,5,9,6,4] and
 * [92,87,78,95,84] rendered next to live Supabase data. Keyed by user id, not
 * name, so two people who share a name are not merged.
 */
const CAPACITY = 10;
function buildWorkload(tasks: TeamTask[]) {
  const byPerson = new Map<string, { key: string; name: string; initials: string; color: string; active: number; done: number }>();
  for (const task of tasks) {
    if (!task.assigneeId) continue;
    const entry = byPerson.get(task.assigneeId) ?? { key: task.assigneeId, ...task.assignee, active: 0, done: 0 };
    byPerson.set(task.assigneeId, {
      ...entry,
      done: entry.done + (task.status === "done" ? 1 : 0),
      active: entry.active + (isOpen(task.status) ? 1 : 0),
    });
  }
  return [...byPerson.values()]
    .map((person) => {
      const total = person.active + person.done;
      const pct = Math.min(100, Math.round((person.active / CAPACITY) * 100));
      return {
        ...person,
        pct,
        // Share of their work that is finished — a real ratio, not a fixed score.
        productivity: total ? Math.round((person.done / total) * 100) : 0,
        availability: pct > 80 ? "Busy" : pct > 50 ? "Available" : "Free",
      };
    })
    .sort((a, b) => b.active - a.active);
}

export function TeamTasksPage({
  onNewTask,
  dashboardFilter,
  onClearFilter,
  onManageMembers,
  linkedTaskId: emailTaskId,
  onLinkedTaskClosed,
}: {
  onNewTask: () => void;
  dashboardFilter?: string;
  onClearFilter?: () => void;
  /** Opens Settings › Users. The Workload "Manage" link is hidden without it, rather than inert (FD-031). */
  onManageMembers?: () => void;
  /** ?task=<id> from an email: the task to open once the tasks have loaded. */
  linkedTaskId?: string;
  /** Called when that task's drawer closes, to drop the id from the URL. */
  onLinkedTaskClosed?: () => void;
}) {
  const [view, setView] = useState<"kanban" | "table" | "timeline">("kanban");
  const { tasks: workspaceTasks, updateTask, status: loadStatus, people } = useWorkspace();
  const { users, departments: orgDepartments, organizations, activeOrgId, canManageUsers } = useOrganizations();
  const { statusLabel, priorities } = useTaskSettings();

  // "Today" and "completed today" are the organization's calendar day, not UTC's.
  const orgTimezone = useMemo(
    () => organizations.find((o) => o.id === activeOrgId)?.timezone ?? organizations[0]?.timezone,
    [organizations, activeOrgId],
  );
  const today = todayIn(orgTimezone);

  // Which department a task belongs to, via the assignee's membership in the
  // task's organization. Was `departments[index % departments.length]` over five
  // hardcoded names, so one task was Engineering on Kanban and Marketing in
  // Table (FD-009); the names now come from Teams & Departments (FD-036).
  const departmentOf = useMemo(() => {
    const nameById = new Map(orgDepartments.map((d) => [d.id, d.name]));
    const membershipsByUser = new Map(users.map((u) => [u.id, u.memberships]));
    return (task: WorkspaceTask) => {
      const memberships = (task.assigneeId && membershipsByUser.get(task.assigneeId)) || [];
      const membership =
        memberships.find((m) => m.orgId === task.organizationId && m.departmentId) ??
        memberships.find((m) => m.departmentId);
      return (membership?.departmentId && nameById.get(membership.departmentId)) || NO_DEPARTMENT;
    };
  }, [users, orgDepartments]);

  const items = useMemo<TeamTask[]>(
    () => workspaceTasks.map((task) => ({ ...task, department: departmentOf(task) })),
    [workspaceTasks, departmentOf],
  );

  // Only offer options that actually appear, so no filter can match nothing.
  const departmentOptions = useMemo(() => [...new Set(items.map((t) => t.department))].sort(), [items]);
  const assigneeOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const task of items) byId.set(task.assigneeId ?? UNASSIGNED, task.assigneeId ? task.assignee.name : "Unassigned");
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const projectOptions = useMemo(() => [...new Set(items.map((t) => t.project))].sort(), [items]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<Status | null>(null);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const activeFilterCount = [priorityFilter, assigneeFilter, projectFilter].filter((v) => v !== "all").length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (t) =>
        matchesDashboardFilter(t, dashboardFilter, today) &&
        (dept === "all" || t.department === dept) &&
        (priorityFilter === "all" || t.priority === priorityFilter) &&
        (assigneeFilter === "all" || (t.assigneeId ?? UNASSIGNED) === assigneeFilter) &&
        (projectFilter === "all" || t.project === projectFilter) &&
        (q === "" || t.title.toLowerCase().includes(q) || t.assignee.name.toLowerCase().includes(q)),
    );
  }, [items, query, dept, priorityFilter, assigneeFilter, projectFilter, dashboardFilter, today]);

  // "task:<id>" opens that task (C3); it does not narrow the board to one card.
  useEffect(() => {
    if (dashboardFilter?.startsWith("task:")) setSelectedId(dashboardFilter.slice(5));
  }, [dashboardFilter]);

  // ?task=<id> (management summaries): open it once, after the tasks load. A task
  // this person cannot see (RLS), or one archived since, is not in the list.
  const openedEmailTask = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!emailTaskId) {
      openedEmailTask.current = undefined;
      return;
    }
    if (loadStatus !== "ready" || openedEmailTask.current === emailTaskId) return;
    openedEmailTask.current = emailTaskId;
    if (workspaceTasks.some((task) => task.id === emailTaskId)) {
      setSelectedId(emailTaskId);
      return;
    }
    toast.error("That task isn't available to you.", {
      description: "It may have been archived, or you may no longer have access to it.",
    });
    onLinkedTaskClosed?.();
  }, [emailTaskId, loadStatus, workspaceTasks, onLinkedTaskClosed]);

  // The chip names the filter a dashboard card applied. It used to be applied
  // invisibly, so Team Tasks silently showed 4 tasks with no way back (FD-030).
  const filterLabel = useMemo(() => {
    if (!dashboardFilter) return null;
    const labels: Record<string, string> = {
      open: "Open tasks",
      "due-today": "Due today",
      overdue: "Overdue",
      review: statusLabel("review"),
      completed: statusLabel("done"),
      blocked: "Blocked",
      attention: "Needs attention",
    };
    if (labels[dashboardFilter]) return labels[dashboardFilter];
    if (dashboardFilter.startsWith("assignee:")) {
      const id = dashboardFilter.slice(9);
      return `Assigned to ${people.find((p) => p.id === id)?.name ?? "a team member"}`;
    }
    return null;
  }, [dashboardFilter, statusLabel, people]);

  const workloadData = useMemo(() => buildWorkload(filtered), [filtered]);

  // Every figure describes the tasks in view (FD-013). "Active" counted In
  // Progress plus only some To Do tasks, and "Completed Today" was the all-time total.
  const stats = useMemo(() => {
    const total = filtered.length;
    const active = filtered.filter((t) => isOpen(t.status)).length;
    const delayed = filtered.filter((t) => isOpen(t.status) && dueDay(t) < today).length;
    const done = filtered.filter((t) => t.status === "done").length;
    const completedToday = filtered.filter(
      (t) => t.status === "done" && t.completedAt && dayIn(t.completedAt, orgTimezone) === today,
    ).length;
    const reviews = filtered.filter((t) => t.status === "review").length;
    const completionRate = total ? Math.round((done / total) * 100) : 0;
    return { active, delayed, completedToday, reviews, completionRate };
  }, [filtered, today, orgTimezone]);

  const move = async (id: string, status: Status) => {
    const task = workspaceTasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    // updateTask reverts and shows its own error toast when the write fails.
    if (await updateTask(id, { status })) toast.success(`Moved to ${statusLabel(status)}`, { description: task.title });
  };

  const drop = (event: React.DragEvent, status: Status) => {
    // preventDefault stops Firefox navigating to the dropped text.
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || dragId;
    setDragId(null);
    setOverColumn(null);
    if (id) void move(id, status);
  };

  const closeDetail = (open: boolean) => {
    if (open) return;
    setSelectedId(undefined);
    // Clearing the filter clears the whole query string, ?task included.
    if (dashboardFilter?.startsWith("task:")) onClearFilter?.();
    else if (emailTaskId) onLinkedTaskClosed?.();
  };

  const selectClass =
    "h-8 w-full rounded-md border border-border bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="space-y-6">
      <WorkspaceState status={loadStatus} hasTasks={workspaceTasks.length > 0} />
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Team Tasks</h2>
          <p className="text-sm text-muted-foreground">
            Collaborate, assign, and track progress across {workloadData.length}{" "}
            {workloadData.length === 1 ? "member" : "members"} with tasks.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-2 shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <div className="leading-tight">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Members</div>
                <div className="text-sm font-semibold">{workloadData.length} with tasks</div>
              </div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-status-done" />
              <div className="leading-tight">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Completion</div>
                <div className="text-sm font-semibold">{stats.completionRate}%</div>
              </div>
            </div>
          </div>
          <button
            onClick={onNewTask}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition"
          >
            <Plus className="h-4 w-4" /> Add Team Task
          </button>
        </div>
      </div>

      {filterLabel && (
        <div className="flex">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            Filtered: {filterLabel}
            {onClearFilter && (
              <button
                type="button"
                onClick={onClearFilter}
                aria-label={`Clear filter: ${filterLabel}`}
                className="rounded-full p-0.5 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        </div>
      )}

      {/* Analytics cards. "Avg Productivity" had no real source and is gone; the
          arrow icons implied a link that did nothing (FD-013, FD-031). */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Active Tasks", value: stats.active, Icon: Flame, color: "text-status-progress", bg: "bg-status-progress/10" },
          { label: "Delayed", value: stats.delayed, Icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" },
          { label: "Completed Today", value: stats.completedToday, Icon: CheckCircle2, color: "text-status-done", bg: "bg-status-done/10" },
          { label: statusLabel("review"), value: stats.reviews, Icon: ShieldAlert, color: "text-status-review", bg: "bg-status-review/10" },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] hover:shadow-md transition"
          >
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", c.bg)}>
              <c.Icon className={cn("h-4 w-4", c.color)} />
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight">{c.value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
          {[
            { id: "kanban", label: "Kanban", Icon: LayoutGrid },
            { id: "table", label: "Table", Icon: TableIcon },
            { id: "timeline", label: "Timeline", Icon: GanttChart },
          ].map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id as typeof view)}
              aria-pressed={view === v.id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                view === v.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <v.Icon className="h-3.5 w-3.5" /> {v.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search team tasks…"
              aria-label="Search team tasks"
              className="h-8 w-48 rounded-md border border-border bg-card pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            aria-label="Filter by department"
            className="h-8 rounded-md border border-border bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All departments</option>
            {departmentOptions.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          {/* Was a button that only toggled its own highlight (FD-031). */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-accent",
                  activeFilterCount > 0 && "border-primary/40 text-primary",
                )}
              >
                <Filter className="h-3.5 w-3.5" /> Filters
                {activeFilterCount > 0 && (
                  <span className="rounded bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-3 p-3">
              <label className="block space-y-1 text-[11px] font-medium text-muted-foreground">
                <span>Priority</span>
                <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | "all")} className={selectClass}>
                  <option value="all">All priorities</option>
                  {priorities.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1 text-[11px] font-medium text-muted-foreground">
                <span>Assignee</span>
                <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className={selectClass}>
                  <option value="all">Everyone</option>
                  {assigneeOptions.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1 text-[11px] font-medium text-muted-foreground">
                <span>Project</span>
                <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className={selectClass}>
                  <option value="all">All projects</option>
                  {projectOptions.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={activeFilterCount === 0}
                onClick={() => { setPriorityFilter("all"); setAssigneeFilter("all"); setProjectFilter("all"); }}
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
              >
                Clear filters
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Full-width work view */}
      <section className="min-w-0">
        {view === "kanban" && (
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
            {BOARD_STATUSES.map((status) => {
              const cards = filtered.filter((t) => t.status === status);
              return (
                <div
                  key={status}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overColumn !== status) setOverColumn(status);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverColumn(null);
                  }}
                  onDrop={(e) => drop(e, status)}
                  className={cn(
                    "rounded-xl border border-border bg-secondary/40 p-3 min-h-[320px] flex flex-col transition",
                    overColumn === status && "ring-2 ring-primary/40 bg-primary/5",
                  )}
                >
                  <div className="flex items-center justify-between px-1 pb-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", statusDot[status])} />
                      <span className="text-[11px] font-semibold uppercase tracking-wide">{statusLabel(status)}</span>
                      <span className="rounded-md bg-card border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {cards.length}
                      </span>
                    </div>
                    {/* New tasks start in To Do, so only that column offers "+"; the
                        other columns' "+" buttons did nothing (FD-031). */}
                    {status === "todo" && (
                      <button
                        onClick={onNewTask}
                        aria-label="New task"
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    {cards.map((task) => (
                      <TeamTaskCard
                        key={task.id}
                        task={task}
                        today={today}
                        onDragStart={(e) => {
                          // Firefox starts no drag without data (FD-071).
                          e.dataTransfer.setData("text/plain", task.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(task.id);
                        }}
                        onDragEnd={() => { setDragId(null); setOverColumn(null); }}
                        onOpen={() => setSelectedId(task.id)}
                        onMove={(next) => void move(task.id, next)}
                      />
                    ))}
                    {cards.length === 0 && (
                      <div className="flex-1 rounded-lg border border-dashed border-border/70 flex items-center justify-center text-[11px] text-muted-foreground py-6">
                        No tasks
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === "table" && <TableView tasks={filtered} today={today} onOpen={setSelectedId} />}
        {view === "timeline" && <TimelineView tasks={filtered} today={today} onOpen={setSelectedId} />}
      </section>

      {/* Team insights */}
      <section className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ActivityFeed tasks={workspaceTasks} onOpenTask={setSelectedId} />
        <WorkloadPanel members={workloadData} onManage={canManageUsers ? onManageMembers : undefined} />
        <HeatmapPanel members={workloadData} tasks={filtered} today={today} timezone={orgTimezone} />
      </section>
      <TaskDetailDrawer
        variant={view === "kanban" ? "modal" : "sheet"}
        task={workspaceTasks.find((task) => task.id === selectedId)}
        open={Boolean(selectedId)}
        onOpenChange={closeDetail}
      />
    </div>
  );
}

function TeamTaskCard({
  task,
  today,
  onDragStart,
  onDragEnd,
  onOpen,
  onMove,
}: {
  task: TeamTask;
  today: string;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onMove: (status: Status) => void;
}) {
  const { statusLabel } = useTaskSettings();
  const overdue = isOpen(task.status) && dueDay(task) < today;
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className="group rounded-lg border border-border bg-card p-3 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        {/* A real button, so the card opens from the keyboard too. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          title={task.title}
          className="min-w-0 text-left text-sm font-medium leading-snug line-clamp-3 break-words rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {task.title}
        </button>
        {/* Keyboard alternative to dragging (FD-071); replaces a "…" button that did nothing. */}
        <select
          value={task.status}
          aria-label={`Status of ${task.title}`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => onMove(e.target.value as Status)}
          className="h-6 max-w-[7.5rem] shrink-0 rounded border border-border bg-card px-1 text-[10px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {BOARD_STATUSES.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", priorityClass[task.priority])}>
          {task.priority}
        </span>
        <span className="whitespace-nowrap rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {task.department}
        </span>
        {task.projectId && (
          <span className="inline-flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colorFor(task.project) }} />
            <span className="truncate">{task.project}</span>
          </span>
        )}
      </div>
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
          <span>Progress</span>
          <span>{task.progress}%</span>
        </div>
        <div className="h-1 rounded-full bg-secondary overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${task.progress}%` }} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: task.assignee.color }}
            title={task.assignee.name}
          >
            {task.assignee.initials}
          </div>
          <span className="truncate text-[11px] text-muted-foreground">{task.assignee.name.split(" ")[0]}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1" aria-label={`${task.comments} comments`}>
            <MessageSquare className="h-3 w-3" /> {task.comments}
          </span>
          <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", overdue && "text-destructive font-medium")}>
            <Clock className="h-3 w-3" />
            {shortDate(task.dueDate)}
          </span>
        </div>
      </div>
    </div>
  );
}

function TableView({ tasks, today, onOpen }: { tasks: TeamTask[]; today: string; onOpen: (id: string) => void }) {
  const { statusLabel } = useTaskSettings();
  const headings = ["Task", "Assigned To", "Department", "Status", "Priority", "Due Date", "Progress", "Last Updated"];
  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              {headings.map((h) => (
                <th key={h} className="whitespace-nowrap text-left font-medium px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan={headings.length} className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No tasks match these filters.
                </td>
              </tr>
            )}
            {tasks.map((t) => {
              const overdue = isOpen(t.status) && dueDay(t) < today;
              return (
                <tr key={t.id} onClick={() => onOpen(t.id)} className="cursor-pointer border-t border-border hover:bg-accent/40 transition">
                  <td className="px-4 py-2.5 font-medium">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}
                      title={t.title}
                      className="max-w-[22rem] text-left line-clamp-2 break-words rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t.title}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ background: t.assignee.color }}
                      >
                        {t.assignee.initials}
                      </div>
                      <span className="whitespace-nowrap text-xs">{t.assignee.name}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{t.department}</td>
                  {/* Status names come from Settings; "review" was hardcoded as "Under Review" (FD-018). */}
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs">{statusLabel(t.status)}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", priorityClass[t.priority])}>
                      {t.priority}
                    </span>
                  </td>
                  <td className={cn("whitespace-nowrap px-4 py-2.5 text-xs", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
                    {shortDate(t.dueDate)}
                  </td>
                  <td className="px-4 py-2.5 w-40">
                    <div className="flex items-center gap-2">
                      <div className="h-1 flex-1 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${t.progress}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-8">{t.progress}%</span>
                    </div>
                  </td>
                  {/* Was `(row index + 1) * 2` hours ago (FD-011). */}
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                    <time dateTime={t.updatedAt} title={new Date(t.updatedAt).toLocaleString()}>{timeAgo(t.updatedAt)}</time>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DAY_MS = 86_400_000;
const TIMELINE_MIN_DAYS = 14;
const TIMELINE_MAX_DAYS = 28;
const TIMELINE_STEP_DAYS = 7;
/** Whole days since the epoch for a yyyy-mm-dd key, so day arithmetic ignores DST and timezones. */
const dayNumber = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
const dayLabel = (day: number, options: Intl.DateTimeFormatOptions) =>
  new Date(day * DAY_MS).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });

/**
 * Bars run from the task's start date to its due date on a window fitted to the
 * tasks in view, with previous/next navigation. Every bar was three days long,
 * ending on its due date, on a fixed today−3 … today+10 window, so a Sep 14–19
 * task drew as Sep 21–23 and there was no way to look elsewhere (FD-032).
 */
function TimelineView({ tasks, today, onOpen }: { tasks: TeamTask[]; today: string; onOpen: (id: string) => void }) {
  const todayNumber = dayNumber(today);
  const spans = useMemo(
    () =>
      tasks
        .map((task) => {
          const due = dayNumber(dueDay(task));
          // Without a saved start date only the deadline is known, so the bar is that one day.
          const start = task.hasStartDate ? Math.min(dayNumber(task.startDate.slice(0, 10)), due) : due;
          return { task, start, due };
        })
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.due))
        .sort((a, b) => a.start - b.start || a.due - b.due),
    [tasks],
  );
  const fit = useMemo(() => {
    if (!spans.length) return { start: todayNumber - 3, days: TIMELINE_MIN_DAYS };
    const first = Math.min(...spans.map((s) => s.start));
    const last = Math.max(...spans.map((s) => s.due));
    const span = last - first + 1;
    const days = Math.min(Math.max(span, TIMELINE_MIN_DAYS), TIMELINE_MAX_DAYS);
    if (span <= TIMELINE_MAX_DAYS) return { start: first - Math.floor((days - span) / 2), days };
    // Too wide for one window: open around today, kept inside the task range.
    return { start: Math.min(Math.max(todayNumber - 3, first), last - days + 1), days };
  }, [spans, todayNumber]);
  const [shift, setShift] = useState(0);
  useEffect(() => setShift(0), [fit.start, fit.days]);

  const start = fit.start + shift;
  const days = fit.days;
  const end = start + days - 1;
  const dayWidth = days > TIMELINE_MIN_DAYS ? 40 : 56;
  const labelWidth = 192;
  const timelineWidth = dayWidth * days;
  const navButton = "inline-flex h-7 items-center justify-center rounded-md border border-border bg-card px-2 text-xs hover:bg-accent";

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium">
          {dayLabel(start, { month: "short", day: "numeric" })} – {dayLabel(end, { month: "short", day: "numeric", year: "numeric" })}
        </div>
        <div className="inline-flex items-center gap-1">
          <button type="button" className={navButton} aria-label="Previous week" onClick={() => setShift((s) => s - TIMELINE_STEP_DAYS)}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={navButton} onClick={() => setShift(todayNumber - 3 - fit.start)}>Today</button>
          <button type="button" className={navButton} aria-label="Next week" onClick={() => setShift((s) => s + TIMELINE_STEP_DAYS)}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: labelWidth + timelineWidth }}>
          <div className="grid" style={{ gridTemplateColumns: `${labelWidth}px ${timelineWidth}px` }}>
            <div className="border-b border-border" />
            <div className="grid" style={{ gridTemplateColumns: `repeat(${days}, ${dayWidth}px)` }}>
              {Array.from({ length: days }).map((_, i) => {
                const day = start + i;
                return (
                  <div
                    key={day}
                    className={cn("text-[10px] text-center pb-2 border-b border-border", day === todayNumber && "text-primary font-semibold")}
                  >
                    {dayLabel(day, { weekday: "short" })}
                    <div>{new Date(day * DAY_MS).getUTCDate()}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {spans.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">No tasks in this view.</p>}
            {spans.map(({ task: t, start: taskStart, due }) => {
              const from = Math.max(taskStart, start);
              const to = Math.min(due, end);
              const range = `${t.hasStartDate ? `${dayLabel(taskStart, { month: "short", day: "numeric" })} – ` : "No start date · due "}${dayLabel(due, { month: "short", day: "numeric" })}`;
              return (
                <div key={t.id} className="grid items-center" style={{ gridTemplateColumns: `${labelWidth}px ${timelineWidth}px` }}>
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    title={t.title}
                    className="min-w-0 pr-3 truncate text-left text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    {t.title}
                  </button>
                  <div
                    className="relative h-7"
                    style={{
                      backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${dayWidth - 1}px, var(--border) ${dayWidth}px)`,
                    }}
                  >
                    {to >= from ? (
                      <div
                        className="absolute top-1 h-5 rounded-md text-[10px] text-white flex items-center px-2 truncate"
                        style={{ left: (from - start) * dayWidth, width: (to - from + 1) * dayWidth - 4, background: t.assignee.color }}
                        title={`${t.title}: ${range}`}
                      >
                        {t.assignee.initials} · {t.progress}%
                      </div>
                    ) : (
                      // Outside the window: say which way it is instead of drawing it in the wrong place.
                      <span
                        className={cn("absolute top-1.5 whitespace-nowrap text-[10px] text-muted-foreground", due < start ? "left-1" : "right-1")}
                        title={range}
                      >
                        {due < start ? `← ${range}` : `${range} →`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

type WorkloadMember = ReturnType<typeof buildWorkload>[number];

function WorkloadPanel({ members, onManage }: { members: WorkloadMember[]; onManage?: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Team Workload</h3>
        {onManage && (
          <button onClick={onManage} className="text-[11px] text-primary hover:underline">Manage</button>
        )}
      </div>
      <div className="mt-3 space-y-3">
        {members.length === 0 && <p className="text-xs text-muted-foreground">No tasks are assigned yet.</p>}
        {members.map((m) => {
          const color = m.pct > 80 ? "bg-destructive" : m.pct > 50 ? "bg-status-progress" : "bg-status-done";
          const availColor =
            m.availability === "Busy"
              ? "bg-destructive/15 text-destructive"
              : m.availability === "Available"
                ? "bg-status-progress/15 text-status-progress"
                : "bg-status-done/15 text-status-done";
          return (
            <div key={m.key} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: m.color }}
                  >
                    {m.initials}
                  </div>
                  <div className="min-w-0 leading-tight">
                    <div className="truncate text-xs font-medium">{m.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {m.active} open · {m.done} done
                    </div>
                  </div>
                </div>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", availColor)}>{m.availability}</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden"
                  title={`${m.active} of ${CAPACITY} open tasks`}
                >
                  <div className={cn("h-full transition-all", color)} style={{ width: `${m.pct}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground w-14 text-right whitespace-nowrap" title="Share of their tasks that are completed">
                  {m.productivity}% done
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HeatmapPanel({
  members,
  tasks,
  today,
  timezone,
}: {
  members: WorkloadMember[];
  tasks: TeamTask[];
  today: string;
  timezone?: string;
}) {
  // The last five days, ending today in the organization's timezone.
  const todayNumber = dayNumber(today);
  const dayNumbers = Array.from({ length: 5 }, (_, i) => todayNumber - (4 - i));
  const dayKeys = dayNumbers.map((day) => new Date(day * DAY_MS).toISOString().slice(0, 10));

  // Real completions per person per day. This was `((r * 3 + c * 2 + 1) % 5) + 1`.
  const intensities = members.map((member) =>
    dayKeys.map(
      (key) =>
        tasks.filter(
          (task) =>
            task.assigneeId === member.key &&
            task.status === "done" &&
            task.completedAt &&
            dayIn(task.completedAt, timezone) === key,
        ).length,
    ),
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <h3 className="text-sm font-semibold">Productivity Heatmap</h3>
      <p className="text-[11px] text-muted-foreground mt-0.5">Tasks completed per member · last 5 days</p>
      {members.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No assigned tasks in this view.</p>
      ) : (
        <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: "70px repeat(5, 1fr)" }}>
          <div />
          {dayNumbers.map((day) => (
            <div key={day} className="text-[10px] text-center text-muted-foreground">
              {dayLabel(day, { weekday: "short" })}
            </div>
          ))}
          {members.map((m, r) => (
            <Fragment key={m.key}>
              <div className="text-[11px] text-muted-foreground truncate" title={m.name}>{m.name.split(" ")[0]}</div>
              {dayKeys.map((key, c) => {
                const v = intensities[r][c];
                // Saturate at four completions so one busy day does not flatten the rest.
                const opacity = v === 0 ? 0.06 : 0.2 + Math.min(v, 4) * 0.19;
                return (
                  <div
                    key={key}
                    className="h-7 rounded-md"
                    style={{ background: `color-mix(in oklab, var(--primary) ${opacity * 100}%, transparent)` }}
                    title={`${m.name}: ${v} task${v === 1 ? "" : "s"} completed`}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

const FEED_LIMIT = 30;
const FEED_PREVIEW = 5;
const feedDot = (type: string) =>
  type === "task_completed"
    ? "bg-status-done"
    : type === "task_created"
      ? "bg-primary"
      : type === "task_archived"
        ? "bg-destructive"
        : type === "task_status_changed" || type === "task_review_submitted"
          ? "bg-status-progress"
          : type.includes("file") || type.includes("document")
            ? "bg-status-review"
            : "bg-muted-foreground";

/**
 * The workspace's real activity, newest first. This was five hardcoded events
 * by demo people — one "approved" a task that was still In Progress — and
 * "View all" did nothing (FD-012, FD-031).
 */
function ActivityFeed({ tasks, onOpenTask }: { tasks: WorkspaceTask[]; onOpenTask: (id: string) => void }) {
  const { statusLabel } = useTaskSettings();
  // undefined = loading, null = the query failed.
  const [entries, setEntries] = useState<ActivityEntry[] | null | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () =>
      void listRecentActivity(FEED_LIMIT)
        .then((rows) => { if (active) setEntries(rows); })
        .catch((error: unknown) => {
          console.error("[flowdesk] activity feed failed", error);
          if (active) setEntries(null);
        });
    load();
    // Task edits announce themselves, so the feed follows along without a reload.
    window.addEventListener("flowdesk-work-changed", load);
    return () => {
      active = false;
      window.removeEventListener("flowdesk-work-changed", load);
    };
  }, [attempt]);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const projectNameById = useMemo(
    () => new Map(tasks.filter((t) => t.projectId).map((t) => [t.projectId as string, t.project])),
    [tasks],
  );

  // Status words come from Settings rather than describeActivity's fixed names (FD-018).
  const sentence = (entry: ActivityEntry) => {
    if (entry.type === "task_status_changed") {
      const to = (entry.details as { to?: string }).to;
      return `moved this task to ${to ? statusLabel(to) : "a new status"}`;
    }
    if (entry.type === "task_completed") return `marked this task ${statusLabel("done")}`;
    return describeActivity(entry, entry.taskId ? "task" : "project");
  };

  const visible = entries ? (expanded ? entries : entries.slice(0, FEED_PREVIEW)) : [];

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Activity Feed</h3>
        {entries && entries.length > FEED_PREVIEW && (
          <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="text-[11px] text-primary hover:underline">
            {expanded ? "Show less" : "View all"}
          </button>
        )}
      </div>
      {entries === undefined && <p className="mt-3 text-xs text-muted-foreground">Loading activity…</p>}
      {entries === null && (
        <p className="mt-3 text-xs text-muted-foreground">
          Activity could not be loaded.{" "}
          <button onClick={() => setAttempt((n) => n + 1)} className="text-primary hover:underline">Try again</button>
        </p>
      )}
      {entries && entries.length === 0 && <p className="mt-3 text-xs text-muted-foreground">No activity yet.</p>}
      <ul className={cn("mt-3 space-y-3", expanded && "max-h-96 overflow-y-auto pr-1")}>
        {visible.map((e) => {
          const task = e.taskId ? taskById.get(e.taskId) : undefined;
          const projectName = e.projectId ? projectNameById.get(e.projectId) : undefined;
          return (
            <li key={e.id} className="flex items-start gap-3">
              <span className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", feedDot(e.type))} />
              <div className="min-w-0 flex-1 text-xs">
                <span className="font-medium">{e.actor.name}</span>{" "}
                <span className="text-muted-foreground">{sentence(e)}</span>
                <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                  {task ? (
                    <button onClick={() => onOpenTask(task.id)} title={task.title} className="min-w-0 truncate font-medium text-foreground hover:underline">
                      {task.title}
                    </button>
                  ) : e.taskId ? (
                    <span className="truncate">Task no longer available</span>
                  ) : projectName ? (
                    <span className="truncate font-medium text-foreground">{projectName}</span>
                  ) : null}
                  {(task || e.taskId || projectName) && <span aria-hidden>·</span>}
                  <time dateTime={e.occurredAt} title={new Date(e.occurredAt).toLocaleString()} className="shrink-0">
                    {timeAgo(e.occurredAt)}
                  </time>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
