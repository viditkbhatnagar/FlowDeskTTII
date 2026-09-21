import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Filter,
  ArrowUpDown,
  Plus,
  LayoutGrid,
  List,
  Flag,
  Calendar as CalIcon,
  Paperclip,
  MessageSquare,
  CheckCircle2,
  Clock,
  Hash,
  GitBranch,
  Activity,
  Send,
  Timer,
  History,
  Link2,
  Sparkles,
} from "lucide-react";
import { projects, type Task, type Status, type Priority } from "@/lib/mock-data";
import { useWorkspace } from "@/lib/workspace-data";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const columns: { id: Status | "waiting"; label: string; dot: string }[] = [
  { id: "todo", label: "To Do", dot: "bg-status-todo" },
  { id: "progress", label: "In Progress", dot: "bg-status-progress" },
  { id: "waiting", label: "Waiting Approval", dot: "bg-status-review" },
  { id: "done", label: "Completed", dot: "bg-status-done" },
];

const priorityChip: Record<Priority, string> = {
  low: "bg-priority-low/15 text-priority-low",
  medium: "bg-priority-medium/15 text-priority-medium",
  high: "bg-priority-high/15 text-priority-high",
  critical: "bg-priority-critical/15 text-priority-critical",
};

const priorityRank: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Map mock 'review' status to 'waiting' bucket for this page
function bucket(t: Task): Status | "waiting" {
  return t.status === "review" ? "waiting" : t.status;
}

type View = "kanban" | "list" | "priority";

const subtasksByTask: Record<string, { id: string; label: string; done: boolean }[]> = {
  default: [
    { id: "s1", label: "Draft initial spec", done: true },
    { id: "s2", label: "Review with stakeholders", done: true },
    { id: "s3", label: "Implement first pass", done: false },
    { id: "s4", label: "Add unit tests", done: false },
    { id: "s5", label: "Write release notes", done: false },
  ],
};

const activity = [
  { id: "a1", who: "Priya Shah", what: "moved this task to In Progress", when: "2h ago" },
  { id: "a2", who: "Alex Morgan", what: "added a checklist item", when: "5h ago" },
  { id: "a3", who: "Sam Chen", what: "attached design-v3.fig", when: "Yesterday" },
  { id: "a4", who: "Jordan Lee", what: "created this task", when: "3d ago" },
];

const comments = [
  {
    id: "c1",
    who: "Priya Shah",
    initials: "PS",
    color: "oklch(0.72 0.15 30)",
    text: "Pushed a draft — would love a quick look at the empty state.",
    when: "1h ago",
  },
  {
    id: "c2",
    who: "Alex Morgan",
    initials: "AM",
    color: "oklch(0.7 0.15 265)",
    text: "Looks great. Let's tighten the spacing on mobile and ship.",
    when: "20m ago",
  },
];

export function MyTasksPage({ onNewTask, dashboardFilter }: { onNewTask: () => void; dashboardFilter?: string }) {
  // Treat all tasks as "mine" for the demo
  const { tasks: items, updateTask } = useWorkspace();
  const [view, setView] = useState<View>("kanban");
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"due" | "priority" | "progress">("due");
  const [selectedId, setSelectedId] = useState<string>(items[0]?.id ?? "");
  const [dragId, setDragId] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const filtered = useMemo(() => {
    let list = items.filter((t) => {
      const today = new Date().toISOString().slice(0, 10);
      if (dashboardFilter === "open" && t.status === "done") return false;
      if (dashboardFilter === "due-today" && t.dueDate.slice(0, 10) !== today) return false;
      if (dashboardFilter === "overdue" && !(t.status !== "done" && t.dueDate.slice(0, 10) < today)) return false;
      if (dashboardFilter === "review" && t.status !== "review") return false;
      if (dashboardFilter === "completed" && t.status !== "done") return false;
      if (dashboardFilter === "blocked" && !t.blocked) return false;
      if (dashboardFilter === "attention" && !(t.blocked || t.status === "review" || t.priority === "critical" || (t.status !== "done" && t.dueDate.slice(0, 10) < today))) return false;
      if (dashboardFilter?.startsWith("task:") && t.id !== dashboardFilter.slice(5)) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (projectFilter !== "all" && t.project !== projectFilter) return false;
      if (query && !`${t.title} ${t.project} ${t.id}`.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortBy === "due") return +new Date(a.dueDate) - +new Date(b.dueDate);
      if (sortBy === "priority") return priorityRank[a.priority] - priorityRank[b.priority];
      return b.progress - a.progress;
    });
    return list;
  }, [items, query, priorityFilter, projectFilter, sortBy, dashboardFilter]);

  const counts = useMemo(() => {
    const now = new Date();
    return {
      total: items.length,
      pending: items.filter((t) => t.status === "todo").length,
      progress: items.filter((t) => t.status === "progress").length,
      completed: items.filter((t) => t.status === "done").length,
      overdue: items.filter((t) => new Date(t.dueDate) < now && t.status !== "done").length,
    };
  }, [items]);

  const productivity = Math.round((counts.completed / Math.max(counts.total, 1)) * 100);
  const focus = filtered.filter((t) => t.status !== "done").slice(0, 3);
  const selected = items.find((t) => t.id === selectedId) ?? items[0];

  useEffect(() => {
    if (dashboardFilter?.startsWith("task:")) {
      setSelectedId(dashboardFilter.slice(5));
      setDetailOpen(true);
    }
  }, [dashboardFilter]);

  const setStatus = (id: string, status: Status) => {
    const task = items.find((item) => item.id === id);
    updateTask(id, { status, progress: status === "done" ? 100 : task?.progress });
    if (status === "done") {
      setJustCompleted(id);
      setTimeout(() => setJustCompleted(null), 700);
    }
  };

  const drop = (col: Status | "waiting") => {
    if (!dragId) return;
    setStatus(dragId, col === "waiting" ? "review" : col);
    setDragId(null);
  };

  return (
    <div className="space-y-6">
      {/* Top heading */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">My Tasks</h2>
          <p className="text-sm text-muted-foreground">Stay focused on what you own this week.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onNewTask}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition"
          >
            <Plus className="h-4 w-4" /> Quick Add Task
          </button>
        </div>
      </div>

      {/* Summary widgets */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          {
            label: "Total",
            value: counts.total,
            accent: "text-foreground",
            dot: "bg-muted-foreground/40",
          },
          {
            label: "Pending",
            value: counts.pending,
            accent: "text-foreground",
            dot: "bg-status-todo",
          },
          {
            label: "In Progress",
            value: counts.progress,
            accent: "text-foreground",
            dot: "bg-status-progress",
          },
          {
            label: "Completed",
            value: counts.completed,
            accent: "text-foreground",
            dot: "bg-status-done",
          },
          {
            label: "Overdue",
            value: counts.overdue,
            accent: "text-destructive",
            dot: "bg-destructive",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="group rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)] hover:-translate-y-0.5 transition"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {s.label}
              </span>
              <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
            </div>
            <div className={cn("mt-2 text-2xl font-semibold tabular-nums", s.accent)}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Controls bar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
            {[
              { id: "kanban", label: "Kanban", Icon: LayoutGrid },
              { id: "list", label: "List", Icon: List },
              { id: "priority", label: "Priority", Icon: Flag },
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id as View)}
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

          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs shadow-[var(--shadow-soft)]">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as Priority | "all")}
              className="bg-transparent outline-none text-xs py-1 pr-1"
            >
              <option value="all">All priority</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs shadow-[var(--shadow-soft)]">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="bg-transparent outline-none text-xs py-1 pr-1"
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs shadow-[var(--shadow-soft)]">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="bg-transparent outline-none text-xs py-1 pr-1"
            >
              <option value="due">Sort: Due date</option>
              <option value="priority">Sort: Priority</option>
              <option value="progress">Sort: Progress</option>
            </select>
          </div>
        </div>

        <div className="relative w-full lg:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search my tasks…"
            className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </div>
      </div>

      {/* Daily focus + productivity */}
      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Today's Focus</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">Pick 3 high-impact tasks</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {focus.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className="text-left rounded-lg border border-border bg-secondary/40 p-3 hover:border-ring/40 hover:bg-secondary transition"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{t.project}</span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize",
                      priorityChip[t.priority],
                    )}
                  >
                    {t.priority}
                  </span>
                </div>
                <div className="mt-1.5 text-xs font-medium line-clamp-2">{t.title}</div>
                <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <CalIcon className="h-3 w-3" /> {format(new Date(t.dueDate), "MMM d")}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Productivity Score</h3>
            <span className="text-[11px] text-muted-foreground">This week</span>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <ProductivityRing value={productivity} />
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-status-done" /> {counts.completed}{" "}
                completed
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-status-progress" /> {counts.progress}{" "}
                in progress
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive" /> {counts.overdue}{" "}
                overdue
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main split: tasks + details */}
      <div className={cn("grid gap-4", view !== "kanban" && "xl:grid-cols-[1fr_380px]")}>
        <div className="min-w-0">
          {view === "kanban" && (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
              {columns.map((col) => {
                const colTasks = filtered.filter((t) => bucket(t) === col.id);
                return (
                  <div
                    key={col.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => drop(col.id)}
                    className="rounded-xl border border-border bg-secondary/40 p-3 flex flex-col min-h-[260px]"
                  >
                    <div className="flex items-center justify-between px-1 pb-3">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          {col.label}
                        </span>
                        <span className="rounded-md bg-card border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {colTasks.length}
                        </span>
                      </div>
                      <button
                        onClick={onNewTask}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-col gap-2 flex-1">
                      {colTasks.map((t) => (
                        <MyTaskCard
                          key={t.id}
                          task={t}
                          active={selectedId === t.id}
                          completedPulse={justCompleted === t.id}
                          onSelect={() => {
                            setSelectedId(t.id);
                            setDetailOpen(true);
                          }}
                          onDragStart={() => setDragId(t.id)}
                          onStatus={(s) => setStatus(t.id, s)}
                        />
                      ))}
                      {colTasks.length === 0 && (
                        <div className="flex-1 rounded-lg border border-dashed border-border/70 flex items-center justify-center text-[11px] text-muted-foreground py-6">
                          Drop tasks here
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {view === "list" && (
            <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)] overflow-hidden">
              <div className="grid grid-cols-[1.5rem_1fr_8rem_7rem_7rem_5rem] gap-3 px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-secondary/30">
                <div></div>
                <div>Task</div>
                <div>Project</div>
                <div>Priority</div>
                <div>Due</div>
                <div className="text-right">Progress</div>
              </div>
              {filtered.map((t) => {
                const overdue = new Date(t.dueDate) < new Date() && t.status !== "done";
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={cn(
                      "w-full text-left grid grid-cols-[1.5rem_1fr_8rem_7rem_7rem_5rem] gap-3 items-center px-4 py-3 border-b border-border last:border-0 hover:bg-accent/40 transition",
                      selectedId === t.id && "bg-accent/50",
                      justCompleted === t.id && "animate-pulse",
                    )}
                  >
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setStatus(t.id, t.status === "done" ? "todo" : "done");
                      }}
                      className={cn(
                        "inline-flex h-5 w-5 items-center justify-center rounded-full border transition",
                        t.status === "done"
                          ? "bg-status-done border-status-done text-white"
                          : "border-border hover:border-primary",
                      )}
                    >
                      {t.status === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <div
                        className={cn(
                          "text-sm font-medium truncate",
                          t.status === "done" && "line-through text-muted-foreground",
                        )}
                      >
                        {t.title}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {t.id} · {t.tags?.join(" · ")}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{t.project}</div>
                    <span
                      className={cn(
                        "inline-flex w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize",
                        priorityChip[t.priority],
                      )}
                    >
                      {t.priority}
                    </span>
                    <div
                      className={cn(
                        "text-xs",
                        overdue ? "text-destructive font-medium" : "text-muted-foreground",
                      )}
                    >
                      {format(new Date(t.dueDate), "MMM d")}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${t.progress}%` }} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {view === "priority" && (
            <div className="space-y-4">
              {(["critical", "high", "medium", "low"] as Priority[]).map((p) => {
                const list = filtered.filter((t) => t.priority === p);
                if (!list.length) return null;
                return (
                  <div
                    key={p}
                    className="rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-soft)]"
                  >
                    <div className="flex items-center justify-between px-1 pb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize",
                            priorityChip[p],
                          )}
                        >
                          {p}
                        </span>
                        <span className="text-xs text-muted-foreground">{list.length} tasks</span>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {list.map((t) => (
                        <MyTaskCard
                          key={t.id}
                          task={t}
                          active={selectedId === t.id}
                          completedPulse={justCompleted === t.id}
                          onSelect={() => setSelectedId(t.id)}
                          onStatus={(s) => setStatus(t.id, s)}
                          compact
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right detail panel — docked beside List/Priority, centered modal over Kanban */}
        {view !== "kanban" && (
          <TaskDetailPanel
            task={selected}
            onClose={() => {
              /* no-op on desktop */
            }}
            onStatus={(s) => setStatus(selected.id, s)}
          />
        )}
        {view === "kanban" && (
          <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-hidden gap-0 p-0">
              {selected && (
                <TaskDetailPanel
                  bare
                  task={selected}
                  onClose={() => setDetailOpen(false)}
                  onStatus={(s) => setStatus(selected.id, s)}
                />
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}

function ProductivityRing({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const off = c - (value / 100) * c;
  return (
    <div className="relative h-20 w-20">
      <svg viewBox="0 0 64 64" className="h-20 w-20 -rotate-90">
        <circle cx="32" cy="32" r={r} stroke="var(--muted)" strokeWidth="6" fill="none" />
        <circle
          cx="32"
          cy="32"
          r={r}
          stroke="var(--primary)"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums">
        {value}%
      </div>
    </div>
  );
}

function MyTaskCard({
  task,
  active,
  compact,
  completedPulse,
  onSelect,
  onDragStart,
  onStatus,
}: {
  task: Task;
  active?: boolean;
  compact?: boolean;
  completedPulse?: boolean;
  onSelect: () => void;
  onDragStart?: () => void;
  onStatus: (s: Status) => void;
}) {
  const overdue = new Date(task.dueDate) < new Date() && task.status !== "done";
  const checklistDone = Math.round(task.progress / 20);
  const checklistTotal = 5;
  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onClick={onSelect}
      className={cn(
        "group cursor-pointer rounded-lg border bg-card p-3 shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)] hover:-translate-y-0.5 transition-all",
        active ? "border-primary/60 ring-2 ring-primary/15" : "border-border",
        completedPulse && "animate-pulse",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-muted-foreground">
          {task.id} · {task.project}
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize",
            priorityChip[task.priority],
          )}
        >
          {task.priority}
        </span>
      </div>
      <h4
        className={cn(
          "mt-1.5 text-sm font-medium leading-snug",
          task.status === "done" && "line-through text-muted-foreground",
        )}
      >
        {task.title}
      </h4>
      {!compact && (
        <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
          Owned by {task.assignee.name}. Tagged {task.tags?.join(", ") ?? "general"}.
        </p>
      )}

      <div className="mt-2.5 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Progress</span>
          <span className="font-medium text-foreground">{task.progress}%</span>
        </div>
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${task.progress}%` }}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span
            className={cn(
              "inline-flex items-center gap-0.5",
              overdue && "text-destructive font-medium",
            )}
          >
            <CalIcon className="h-3 w-3" /> {format(new Date(task.dueDate), "MMM d")}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <CheckCircle2 className="h-3 w-3" />
            {checklistDone}/{checklistTotal}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <Timer className="h-3 w-3" />
            {task.estimatedHours ?? 0}h
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-flex items-center gap-0.5 text-[10px]">
            <Paperclip className="h-3 w-3" />2
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px]">
            <MessageSquare className="h-3 w-3" />4
          </span>
          <div
            className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white ring-2 ring-card"
            style={{ background: task.assignee.color }}
            title={task.assignee.name}
          >
            {task.assignee.initials}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <select
          value={task.status}
          onChange={(e) => onStatus(e.target.value as Status)}
          className="text-[10px] rounded border border-border bg-background px-1.5 py-0.5 outline-none focus:border-ring"
        >
          <option value="todo">To Do</option>
          <option value="progress">In Progress</option>
          <option value="review">Waiting Approval</option>
          <option value="done">Completed</option>
        </select>
      </div>
    </div>
  );
}

function TaskDetailPanel({
  task,
  onStatus,
  bare,
}: {
  task: Task;
  onClose: () => void;
  onStatus: (s: Status) => void;
  /** bare removes the docked/sticky frame so the panel can sit inside a modal. */
  bare?: boolean;
}) {
  const { tasks: items } = useWorkspace();
  const [subs, setSubs] = useState(subtasksByTask.default);
  const [draft, setDraft] = useState("");
  const [localComments, setLocalComments] = useState(comments);

  const toggle = (id: string) =>
    setSubs((prev) => prev.map((s) => (s.id === id ? { ...s, done: !s.done } : s)));

  const send = () => {
    if (!draft.trim()) return;
    setLocalComments((prev) => [
      ...prev,
      {
        id: `c${prev.length + 1}`,
        who: "Alex Morgan",
        initials: "AM",
        color: "oklch(0.7 0.15 265)",
        text: draft,
        when: "now",
      },
    ]);
    setDraft("");
  };

  return (
    <aside
      className={cn(
        "rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]",
        !bare && "xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto",
        bare && "max-h-[calc(100dvh-2rem)] overflow-y-auto border-0 shadow-none",
      )}
    >
      <div className={cn("flex items-center justify-between px-4 py-3 border-b border-border", bare && "pr-16")}>
        <div className="min-w-0">
          <div className="text-[10px] text-muted-foreground">
            {task.id} · {task.project}
          </div>
          <h3 className="text-sm font-semibold truncate">{task.title}</h3>
        </div>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize",
            priorityChip[task.priority],
          )}
        >
          {task.priority}
        </span>
      </div>

      <div className="p-4 space-y-5">
        {/* Status quick actions */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { id: "todo", label: "To Do" },
            { id: "progress", label: "In Progress" },
            { id: "review", label: "Waiting" },
            { id: "done", label: "Complete" },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => onStatus(s.id as Status)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] transition",
                task.status === s.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Description
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">
            We're refining {task.title.toLowerCase()} for the {task.project} workstream. Focus on
            accessibility, consistency with the design system, and motion polish. Pair with QA
            before shipping.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <Meta label="Due" value={format(new Date(task.dueDate), "MMM d, yyyy")} />
          <Meta label="Estimate" value={`${task.estimatedHours ?? 0}h`} />
          <Meta label="Assignee" value={task.assignee.name} />
          <Meta label="Recurring" value={("recurrenceSummary" in task && typeof task.recurrenceSummary === "string") ? task.recurrenceSummary : "No"} />
        </div>

        {/* Subtasks */}
        <Section title="Subtasks" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
          <ul className="space-y-1.5">
            {subs.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <button
                  onClick={() => toggle(s.id)}
                  className={cn(
                    "inline-flex h-4 w-4 items-center justify-center rounded border transition",
                    s.done
                      ? "bg-status-done border-status-done text-white"
                      : "border-border hover:border-primary",
                  )}
                >
                  {s.done && <CheckCircle2 className="h-3 w-3" />}
                </button>
                <span className={cn("text-sm", s.done && "line-through text-muted-foreground")}>
                  {s.label}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Activity */}
        <Section title="Activity" icon={<Activity className="h-3.5 w-3.5" />}>
          <ol className="relative border-l border-border ml-1.5 pl-4 space-y-3">
            {activity.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[1.4rem] top-1 h-2 w-2 rounded-full bg-primary/70 ring-2 ring-card" />
                <p className="text-xs">
                  <span className="font-medium">{a.who}</span>{" "}
                  <span className="text-muted-foreground">{a.what}</span>
                </p>
                <p className="text-[10px] text-muted-foreground">{a.when}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Comments */}
        <Section title="Comments" icon={<MessageSquare className="h-3.5 w-3.5" />}>
          <div className="space-y-2.5">
            {localComments.map((c) => (
              <div key={c.id} className="flex gap-2">
                <div
                  className="h-6 w-6 shrink-0 rounded-full text-[10px] font-semibold text-white flex items-center justify-center"
                  style={{ background: c.color }}
                >
                  {c.initials}
                </div>
                <div className="flex-1 rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium">{c.who}</span>
                    <span className="text-[10px] text-muted-foreground">{c.when}</span>
                  </div>
                  <p className="text-xs mt-0.5">{c.text}</p>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Write a comment…"
                className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
              <button
                onClick={send}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </Section>

        {/* Attachments */}
        <Section title="Attachments" icon={<Paperclip className="h-3.5 w-3.5" />}>
          <div className="grid gap-1.5">
            {["spec-v3.pdf", "wireframes.fig", "research.csv"].map((f) => (
              <div
                key={f}
                className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-2.5 py-1.5"
              >
                <div className="flex items-center gap-2 text-xs">
                  <Paperclip className="h-3 w-3 text-muted-foreground" />
                  {f}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  2.{Math.floor(Math.random() * 9)}MB
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* Time logs */}
        <Section title="Time Logs" icon={<Clock className="h-3.5 w-3.5" />}>
          <div className="space-y-1.5 text-xs">
            {[
              { who: "Alex Morgan", h: "1h 45m", when: "Today" },
              { who: "Priya Shah", h: "3h 10m", when: "Yesterday" },
              { who: "Sam Chen", h: "45m", when: "2 days ago" },
            ].map((l, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md bg-secondary/30 px-2.5 py-1.5"
              >
                <span>{l.who}</span>
                <span className="text-muted-foreground">
                  {l.h} · {l.when}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* History */}
        <Section title="Task History" icon={<History className="h-3.5 w-3.5" />}>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <div>Created {formatDistanceToNow(new Date(Date.now() - 1000 * 60 * 60 * 72))} ago</div>
            <div>Last updated 2h ago</div>
            <div>Priority changed Medium → {task.priority} · Yesterday</div>
          </div>
        </Section>

        {/* Related */}
        <Section title="Related Tasks" icon={<Link2 className="h-3.5 w-3.5" />}>
          <div className="space-y-1.5">
            {items
              .filter((t) => t.project === task.project && t.id !== task.id)
              .slice(0, 3)
              .map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-2.5 py-1.5"
                >
                  <div className="text-xs truncate">
                    <GitBranch className="inline h-3 w-3 mr-1 text-muted-foreground" />
                    {t.title}
                  </div>
                  <span
                    className={cn(
                      "rounded px-1 py-0.5 text-[10px] font-semibold capitalize",
                      priorityChip[t.priority],
                    )}
                  >
                    {t.priority}
                  </span>
                </div>
              ))}
          </div>
        </Section>
      </div>
    </aside>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/30 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xs font-medium truncate">{value}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
