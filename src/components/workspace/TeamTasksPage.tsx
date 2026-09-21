import { Fragment, useEffect, useMemo, useState } from "react";
import { allPeople, projects, type Task, type Priority } from "@/lib/mock-data";
import { useWorkspace, type WorkspaceTask } from "@/lib/workspace-data";
import { WorkspaceState } from "@/components/workspace/WorkspaceState";
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
  MoreHorizontal,
  ArrowUpRight,
  Flame,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

type TeamStatus = "backlog" | "assigned" | "progress" | "review" | "done";

interface TeamTask extends Omit<WorkspaceTask, "status"> {
  status: TeamStatus;
  department: string;
  comments: number;
}

const departments = ["Engineering", "Design", "Marketing", "Operations", "Research"];

const mapStatus = (s: Task["status"]): TeamStatus =>
  s === "todo" ? (Math.random() > 0.5 ? "backlog" : "assigned") : s;

const columns: { id: TeamStatus; label: string; dot: string }[] = [
  { id: "backlog", label: "Backlog", dot: "bg-muted-foreground/50" },
  { id: "assigned", label: "Assigned", dot: "bg-status-todo" },
  { id: "progress", label: "In Progress", dot: "bg-status-progress" },
  { id: "review", label: "Under Review", dot: "bg-status-review" },
  { id: "done", label: "Completed", dot: "bg-status-done" },
];

const priorityClass: Record<Priority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-status-review/15 text-status-review",
  high: "bg-priority-high/15 text-priority-high",
  critical: "bg-destructive/15 text-destructive",
};

const workloadData = allPeople.map((p, i) => {
  const active = [7, 5, 9, 6, 4][i];
  const capacity = 10;
  const pct = Math.round((active / capacity) * 100);
  const productivity = [92, 87, 78, 95, 84][i];
  const availability = pct > 80 ? "Busy" : pct > 50 ? "Available" : "Free";
  return { ...p, active, capacity, pct, productivity, availability };
});

export function TeamTasksPage({ onNewTask, dashboardFilter }: { onNewTask: () => void; dashboardFilter?: string }) {
  const [view, setView] = useState<"kanban" | "table" | "timeline">("kanban");
  const { tasks: workspaceTasks, updateTask, status: loadStatus } = useWorkspace();
  const items = useMemo<TeamTask[]>(
    () =>
      workspaceTasks.map((task, index) => ({
        ...task,
        status: task.status === "todo" ? (index % 2 ? "backlog" : "assigned") : task.status,
        department: departments[index % departments.length],
        comments: task.comments,
      })),
    [workspaceTasks],
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string>();

  const filtered = useMemo(
    () =>
      items.filter(
        (t) =>
          (!dashboardFilter ||
            (dashboardFilter === "open" && t.status !== "done") ||
            (dashboardFilter === "review" && t.status === "review") ||
            (dashboardFilter === "completed" && t.status === "done") ||
            (dashboardFilter === "overdue" && t.status !== "done" && t.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10)) ||
            (dashboardFilter === "due-today" && t.dueDate.slice(0, 10) === new Date().toISOString().slice(0, 10)) ||
            (dashboardFilter.startsWith("task:") && t.id === dashboardFilter.slice(5)) ||
            (dashboardFilter === "attention" && (t.blocked || t.status === "review" || t.priority === "critical" || (t.status !== "done" && t.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10)))) ||
            (dashboardFilter === "blocked" && t.blocked) ||
            (dashboardFilter.startsWith("assignee:") && t.assigneeId === dashboardFilter.slice(9))) &&
          (dept === "all" || t.department === dept) &&
          (query === "" ||
            t.title.toLowerCase().includes(query.toLowerCase()) ||
            t.assignee.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [items, query, dept, dashboardFilter],
  );
  useEffect(() => {
    if (dashboardFilter?.startsWith("task:")) setSelectedId(dashboardFilter.slice(5));
  }, [dashboardFilter]);

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.filter((t) => t.status === "progress" || t.status === "assigned").length;
    const delayed = items.filter(
      (t) => new Date(t.dueDate) < new Date() && t.status !== "done",
    ).length;
    const completedToday = items.filter((t) => t.status === "done").length;
    const reviews = items.filter((t) => t.status === "review").length;
    const productivity = Math.round(
      workloadData.reduce((s, p) => s + p.productivity, 0) / workloadData.length,
    );
    // total is items.length, which is 0 while loading and for an empty organization.
    const completionRate = Math.round((completedToday / Math.max(total, 1)) * 100);
    return { total, active, delayed, completedToday, reviews, productivity, completionRate };
  }, [items]);

  const drop = (status: TeamStatus) => {
    if (!dragId) return;
    updateTask(dragId, { status: status === "backlog" || status === "assigned" ? "todo" : status });
    setDragId(null);
  };

  return (
    <div className="space-y-6">
      <WorkspaceState status={loadStatus} hasTasks={workspaceTasks.length > 0} />
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Team Tasks</h2>
          <p className="text-sm text-muted-foreground">
            Collaborate, assign, and track progress across {workloadData.length} active members.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-2 shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <div className="leading-tight">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Members
                </div>
                <div className="text-sm font-semibold">{workloadData.length} active</div>
              </div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-status-done" />
              <div className="leading-tight">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Completion
                </div>
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

      {/* Analytics cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          {
            label: "Active Tasks",
            value: stats.active,
            Icon: Flame,
            color: "text-status-progress",
            bg: "bg-status-progress/10",
          },
          {
            label: "Delayed",
            value: stats.delayed,
            Icon: AlertTriangle,
            color: "text-destructive",
            bg: "bg-destructive/10",
          },
          {
            label: "Completed Today",
            value: stats.completedToday,
            Icon: CheckCircle2,
            color: "text-status-done",
            bg: "bg-status-done/10",
          },
          {
            label: "Avg Productivity",
            value: `${stats.productivity}%`,
            Icon: TrendingUp,
            color: "text-primary",
            bg: "bg-primary/10",
          },
          {
            label: "Pending Reviews",
            value: stats.reviews,
            Icon: ShieldAlert,
            color: "text-status-review",
            bg: "bg-status-review/10",
          },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] hover:shadow-md transition"
          >
            <div className="flex items-center justify-between">
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", c.bg)}>
                <c.Icon className={cn("h-4 w-4", c.color)} />
              </div>
              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
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
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                view === v.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
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
              className="h-8 w-48 rounded-md border border-border bg-card pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-accent">
            <Filter className="h-3.5 w-3.5" /> Filters
          </button>
        </div>
      </div>

      {/* Full-width work view */}
      <section className="min-w-0">
          {view === "kanban" && (
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-5">
              {columns.map((col) => {
                const cards = filtered.filter((t) => t.status === col.id);
                return (
                  <div
                    key={col.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => drop(col.id)}
                    className="rounded-xl border border-border bg-secondary/40 p-3 min-h-[320px] flex flex-col"
                  >
                    <div className="flex items-center justify-between px-1 pb-2">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                        <span className="text-[11px] font-semibold uppercase tracking-wide">
                          {col.label}
                        </span>
                        <span className="rounded-md bg-card border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {cards.length}
                        </span>
                      </div>
                      <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex flex-col gap-2 flex-1">
                      {cards.map((task) => (
                        <TeamTaskCard
                          key={task.id}
                          task={task}
                          onDragStart={() => setDragId(task.id)}
                         onOpen={() => setSelectedId(task.id)}
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

          {view === "table" && <TableView tasks={filtered} onOpen={setSelectedId} />}
          {view === "timeline" && <TimelineView tasks={filtered} />}

      </section>

      {/* Team insights */}
      <section className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ActivityFeed />
        <WorkloadPanel />
        <HeatmapPanel />
      </section>
      <TaskDetailDrawer variant={view === "kanban" ? "modal" : "sheet"} task={workspaceTasks.find((task) => task.id === selectedId)} open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(undefined)} />
    </div>
  );
}

function TeamTaskCard({ task, onDragStart, onOpen }: { task: TeamTask; onDragStart: () => void; onOpen: () => void }) {
  const project = projects.find((p) => p.name === task.project);
  const overdue = new Date(task.dueDate) < new Date() && task.status !== "done";
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="group rounded-lg border border-border bg-card p-3 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium leading-snug">{task.title}</div>
        <button className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-foreground">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium capitalize",
            priorityClass[task.priority],
          )}
        >
          {task.priority}
        </span>
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {task.department}
        </span>
        {project && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} />
            {project.name}
          </span>
        )}
      </div>
      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
          <span>Progress</span>
          <span>{task.progress}%</span>
        </div>
        <div className="h-1 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${task.progress}%` }}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{ background: task.assignee.color }}
            title={task.assignee.name}
          >
            {task.assignee.initials}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {task.assignee.name.split(" ")[0]}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> {task.comments}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1",
              overdue && "text-destructive font-medium",
            )}
          >
            <Clock className="h-3 w-3" />
            {new Date(task.dueDate).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

function TableView({ tasks, onOpen }: { tasks: TeamTask[]; onOpen: (id: string) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              {[
                "Task",
                "Assigned To",
                "Department",
                "Status",
                "Priority",
                "Due Date",
                "Progress",
                "Last Updated",
              ].map((h) => (
                <th key={h} className="text-left font-medium px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => {
              const overdue = new Date(t.dueDate) < new Date() && t.status !== "done";
              return (
                <tr key={t.id} onClick={() => onOpen(t.id)} className="cursor-pointer border-t border-border hover:bg-accent/40 transition">
                  <td className="px-4 py-2.5 font-medium">{t.title}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                        style={{ background: t.assignee.color }}
                      >
                        {t.assignee.initials}
                      </div>
                      <span className="text-xs">{t.assignee.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{t.department}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs capitalize">
                      {columns.find((c) => c.id === t.status)?.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium capitalize",
                        priorityClass[t.priority],
                      )}
                    >
                      {t.priority}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2.5 text-xs",
                      overdue ? "text-destructive font-medium" : "text-muted-foreground",
                    )}
                  >
                    {new Date(t.dueDate).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-2.5 w-40">
                    <div className="flex items-center gap-2">
                      <div className="h-1 flex-1 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${t.progress}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-8">{t.progress}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{(i + 1) * 2}h ago</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TimelineView({ tasks }: { tasks: TeamTask[] }) {
  const days = 14;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 3);
  const dayWidth = 56;
  const labelWidth = 192;
  const timelineWidth = dayWidth * days;

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)] p-4 overflow-x-auto">
      <div style={{ minWidth: labelWidth + timelineWidth }}>
        <div
          className="grid"
          style={{ gridTemplateColumns: `${labelWidth}px ${timelineWidth}px` }}
        >
          <div className="border-b border-border" />
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${days}, ${dayWidth}px)` }}
          >
            {Array.from({ length: days }).map((_, i) => {
              const d = new Date(start);
              d.setDate(d.getDate() + i);
              const isToday = d.getTime() === today.getTime();
              return (
                <div
                  key={i}
                  className={cn(
                    "text-[10px] text-center pb-2 border-b border-border",
                    isToday && "text-primary font-semibold",
                  )}
                >
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                  <div>{d.getDate()}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-2 space-y-1.5">
          {tasks.slice(0, 10).map((t) => {
            const due = new Date(t.dueDate);
            due.setHours(0, 0, 0, 0);
            const offset = Math.round((due.getTime() - start.getTime()) / 86400000);
            const length = 3;
            const clamped = Math.max(0, Math.min(days - 1, offset));
            const visibleLength = Math.min(length, days - clamped);
            return (
              <div
                key={t.id}
                className="grid items-center"
                style={{ gridTemplateColumns: `${labelWidth}px ${timelineWidth}px` }}
              >
                <div className="min-w-0 pr-3 truncate text-xs">{t.title}</div>
                <div
                  className="relative h-7 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_55px,var(--border)_56px)]"
                >
                  <div
                    className="absolute top-1 h-5 rounded-md text-[10px] text-white flex items-center px-2 truncate"
                    style={{
                      left: clamped * dayWidth,
                      width: visibleLength * dayWidth - 4,
                      background: t.assignee.color,
                    }}
                  >
                    {t.assignee.initials} · {t.progress}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WorkloadPanel() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Team Workload</h3>
        <button className="text-[11px] text-primary hover:underline">Manage</button>
      </div>
      <div className="mt-3 space-y-3">
        {workloadData.map((m) => {
          const color =
            m.pct > 80 ? "bg-destructive" : m.pct > 50 ? "bg-status-progress" : "bg-status-done";
          const availColor =
            m.availability === "Busy"
              ? "bg-destructive/15 text-destructive"
              : m.availability === "Available"
                ? "bg-status-progress/15 text-status-progress"
                : "bg-status-done/15 text-status-done";
          return (
            <div key={m.name} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ background: m.color }}
                  >
                    {m.initials}
                  </div>
                  <div className="leading-tight">
                    <div className="text-xs font-medium">{m.name}</div>
                    <div className="text-[10px] text-muted-foreground">{m.active} active tasks</div>
                  </div>
                </div>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", availColor)}>
                  {m.availability}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className={cn("h-full transition-all", color)}
                    style={{ width: `${m.pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground w-9 text-right">
                  {m.productivity}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HeatmapPanel() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  // 5 members x 5 days deterministic intensities
  const intensities = workloadData.map((_, r) => days.map((_, c) => ((r * 3 + c * 2 + 1) % 5) + 1));

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <h3 className="text-sm font-semibold">Productivity Heatmap</h3>
      <p className="text-[11px] text-muted-foreground mt-0.5">
        Tasks completed per member · last 5 days
      </p>
      <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: "70px repeat(5, 1fr)" }}>
        <div />
        {days.map((d) => (
          <div key={d} className="text-[10px] text-center text-muted-foreground">
            {d}
          </div>
        ))}
        {workloadData.map((m, r) => (
          <Fragment key={m.name}>
            <div className="text-[11px] text-muted-foreground truncate">{m.name.split(" ")[0]}</div>
            {days.map((_, c) => {
              const v = intensities[r][c];
              const opacity = 0.15 + v * 0.17;
              return (
                <div
                  key={c}
                  className="h-7 rounded-md"
                  style={{
                    background: `color-mix(in oklab, var(--primary) ${opacity * 100}%, transparent)`,
                  }}
                  title={`${v * 2} tasks`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function ActivityFeed() {
  const events = [
    {
      who: "Alex Morgan",
      what: "approved",
      target: "Design onboarding flow v2",
      time: "8m ago",
      type: "approval",
    },
    {
      who: "Priya Shah",
      what: "mentioned you in",
      target: "Q3 OKR planning doc",
      time: "22m ago",
      type: "mention",
    },
    {
      who: "Jordan Lee",
      what: "escalated",
      target: "Fix billing webhook retries",
      time: "1h ago",
      type: "escalation",
    },
    {
      who: "Sam Chen",
      what: "attached file to",
      target: "Write API documentation",
      time: "3h ago",
      type: "attachment",
    },
    {
      who: "Riley Park",
      what: "completed",
      target: "Launch marketing newsletter",
      time: "Yesterday",
      type: "complete",
    },
  ];
  const colorFor = (t: string) =>
    t === "approval"
      ? "bg-status-done"
      : t === "mention"
        ? "bg-primary"
        : t === "escalation"
          ? "bg-destructive"
          : t === "attachment"
            ? "bg-status-review"
            : "bg-muted-foreground";

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Activity Feed</h3>
        <button className="text-[11px] text-primary hover:underline">View all</button>
      </div>
      <ul className="mt-3 space-y-3">
        {events.map((e, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", colorFor(e.type))} />
            <div className="flex-1 text-xs">
              <span className="font-medium">{e.who}</span>{" "}
              <span className="text-muted-foreground">{e.what}</span>{" "}
              <span className="font-medium">{e.target}</span>
              <div className="text-[10px] text-muted-foreground mt-0.5">{e.time}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
