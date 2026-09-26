import { useEffect, useMemo, useRef, useState } from "react";
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
  Hash,
  Timer,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  useWorkspace,
  type Priority,
  type Status,
  type WorkspaceStatus,
  type WorkspaceTask,
} from "@/lib/workspace-data";
import { supabase } from "@/integrations/supabase/client";
import { useOrganizations } from "@/lib/organizations-data";
import { useTaskSettings } from "@/lib/task-settings-data";
import { todayIn } from "@/lib/today";
import { WorkspaceState } from "@/components/workspace/WorkspaceState";
import { TaskDetailDrawer } from "@/components/workspace/TaskDetailDrawer";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// Column names come from Settings › Task Status via statusLabel. They were
// hardcoded, so the configured "Review" showed here as "Waiting Approval" (FD-018).
const columns: { id: Status; dot: string }[] = [
  { id: "todo", dot: "bg-status-todo" },
  { id: "progress", dot: "bg-status-progress" },
  { id: "review", dot: "bg-status-review" },
  { id: "done", dot: "bg-status-done" },
];
const statusValues: Status[] = columns.map((column) => column.id);

const priorityChip: Record<Priority, string> = {
  low: "bg-priority-low/15 text-priority-low",
  medium: "bg-priority-medium/15 text-priority-medium",
  high: "bg-priority-high/15 text-priority-high",
  critical: "bg-priority-critical/15 text-priority-critical",
};

const priorityRank: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const DAY_MS = 86_400_000;

type View = "kanban" | "list" | "priority";

interface MyTasksPageProps {
  onNewTask: () => void;
  dashboardFilter?: string;
  /** Clears the filter the dashboard applied (FD-030). */
  onClearFilter?: () => void;
  /** ?task=<id> from an email: the task to open once the list has loaded. */
  linkedTaskId?: string;
  /** Called when that task's drawer closes, to drop the id from the URL. */
  onLinkedTaskClosed?: () => void;
}

/**
 * Short, human-quotable references for task ids, unique within the loaded list.
 *
 * Was `#` + the first 8 characters of the uuid. Seeded ids share their prefix
 * (5c120001-6e51-…-0000000000NN), so eight completed tasks all read #5c120001
 * (FD-024). uuids differ at the tail, so take the last eight hex characters and
 * lengthen only the ones that still collide.
 */
function buildTaskRefs(ids: string[]): Map<string, string> {
  const hexById = new Map(ids.map((id) => [id, id.replace(/-/g, "")]));
  const refs = new Map<string, string>();
  for (let length = 8; refs.size < hexById.size && length <= 32; length++) {
    const pending = [...hexById].filter(([id]) => !refs.has(id));
    const counts = new Map<string, number>();
    for (const [, hex] of pending) {
      const suffix = hex.slice(-length);
      counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
    }
    for (const [id, hex] of pending) {
      const suffix = hex.slice(-length);
      if (counts.get(suffix) === 1) refs.set(id, `#${suffix}`);
    }
  }
  for (const id of ids) if (!refs.has(id)) refs.set(id, `#${id}`);
  return refs;
}

const cardDomId = (id: string) => `my-task-${id}`;

const isOverdue = (task: WorkspaceTask, today: string) =>
  task.status !== "done" && task.dueDate.slice(0, 10) < today;

/** Same rules as the dashboard cards that link here, on the organization's date. */
function matchesDashboardFilter(
  task: WorkspaceTask,
  filter: string | undefined,
  today: string,
): boolean {
  switch (filter) {
    case "open":
      return task.status !== "done";
    case "due-today":
      return task.dueDate.slice(0, 10) === today;
    case "overdue":
      return isOverdue(task, today);
    case "review":
      return task.status === "review";
    case "completed":
      return task.status === "done";
    case "blocked":
      return task.blocked;
    case "attention":
      return (
        task.blocked ||
        task.status === "review" ||
        task.priority === "critical" ||
        isOverdue(task, today)
      );
    // "task:<id>" opens and highlights one task; it does not narrow the board (FD-029).
    default:
      return true;
  }
}

function dashboardFilterLabel(filter: string, statusLabel: (value: string) => string): string {
  switch (filter) {
    case "open":
      return "Open tasks";
    case "due-today":
      return "Due today";
    case "overdue":
      return "Overdue";
    case "review":
      return statusLabel("review");
    case "completed":
      return statusLabel("done");
    case "blocked":
      return "Blocked";
    case "attention":
      return "Needs attention";
    default:
      return filter;
  }
}

/** yyyy-mm-dd of an instant in the organization's timezone (cf. todayIn). */
function dateIn(iso: string, timezone?: string): string {
  if (!timezone) return iso.slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Monday–Sunday week containing `today` (yyyy-mm-dd). */
function weekOf(today: string): { start: string; end: string } {
  const day = new Date(`${today}T00:00:00Z`);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  const start = new Date(day.getTime() - sinceMonday * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Productivity for this week: of the tasks due this week or completed this week,
 * how many are done. Was completed / total over all time (11/21) under a
 * "This week" label (FD-046). Null when nothing falls in the week.
 */
function weekProductivity(items: WorkspaceTask[], today: string, timezone?: string) {
  const { start, end } = weekOf(today);
  const inWeek = (day: string) => day >= start && day <= end;
  const inScope = items.filter(
    (task) =>
      inWeek(task.dueDate.slice(0, 10)) ||
      (task.status === "done" && task.completedAt
        ? inWeek(dateIn(task.completedAt, timezone))
        : false),
  );
  const done = inScope.filter((task) => task.status === "done").length;
  return {
    start,
    end,
    done,
    scope: inScope.length,
    stillDue: inScope.filter((task) => task.status !== "done").length,
    score: inScope.length ? Math.round((done / inScope.length) * 100) : null,
  };
}

export function MyTasksPage({
  onNewTask,
  dashboardFilter,
  onClearFilter,
  linkedTaskId: emailTaskId,
  onLinkedTaskClosed,
}: MyTasksPageProps) {
  const { tasks: allTasks, updateTask, status: loadStatus } = useWorkspace();
  const { statusLabel } = useTaskSettings();
  // Due-date comparisons must use the organization's calendar date, not UTC's.
  const { organizations, activeOrgId } = useOrganizations();
  const orgTimezone = useMemo(
    () => organizations.find((o) => o.id === activeOrgId)?.timezone ?? organizations[0]?.timezone,
    [organizations, activeOrgId],
  );
  const today = todayIn(orgTimezone);
  // undefined while the session is read; null when nobody is signed in.
  const [currentUserId, setCurrentUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setCurrentUserId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  // "My Tasks" means the tasks assigned to me — the same set as the dashboard's
  // My Overview. It used to fall back to everyone's tasks while the user loaded
  // and whenever nothing was assigned yet, so it listed Priya Shah's work (FD-020).
  const items = useMemo(
    () => (currentUserId ? allTasks.filter((task) => task.assigneeId === currentUserId) : []),
    [allTasks, currentUserId],
  );
  const pageStatus: WorkspaceStatus =
    currentUserId === undefined && loadStatus !== "error" ? "loading" : loadStatus;
  const taskRefs = useMemo(() => buildTaskRefs(allTasks.map((task) => task.id)), [allTasks]);

  const [view, setView] = useState<View>("kanban");
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"due" | "priority" | "progress">("due");
  const [selectedId, setSelectedId] = useState<string>("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState<string | null>(null);
  const [scrollToId, setScrollToId] = useState<string | null>(null);

  // Projects I actually have tasks in. This listed the demo projects from
  // mock-data, whose names matched none of the real tasks.
  const projectOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const task of items) byKey.set(task.projectId ?? task.project, task.project);
    return [...byKey].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = items.filter((t) => {
      if (!matchesDashboardFilter(t, dashboardFilter, today)) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (projectFilter !== "all" && (t.projectId ?? t.project) !== projectFilter) return false;
      if (
        needle &&
        !`${t.title} ${t.project} ${taskRefs.get(t.id) ?? ""} ${(t.tags ?? []).join(" ")}`
          .toLowerCase()
          .includes(needle)
      )
        return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sortBy === "due") return +new Date(a.dueDate) - +new Date(b.dueDate);
      if (sortBy === "priority") return priorityRank[a.priority] - priorityRank[b.priority];
      return b.progress - a.progress;
    });
  }, [items, query, priorityFilter, projectFilter, sortBy, dashboardFilter, today, taskRefs]);

  const counts = useMemo(
    () => ({
      total: items.length,
      pending: items.filter((t) => t.status === "todo").length,
      progress: items.filter((t) => t.status === "progress").length,
      completed: items.filter((t) => t.status === "done").length,
      overdue: items.filter((t) => isOverdue(t, today)).length,
    }),
    [items, today],
  );

  const week = useMemo(
    () => weekProductivity(items, today, orgTimezone),
    [items, today, orgTimezone],
  );

  // Top three open tasks by priority, then due date. It used to take the first
  // three of the board's current sort, so a Medium task beat High ones (FD-045).
  const focus = useMemo(
    () =>
      filtered
        .filter((t) => t.status !== "done")
        .sort(
          (a, b) =>
            priorityRank[a.priority] - priorityRank[b.priority] ||
            +new Date(a.dueDate) - +new Date(b.dueDate),
        )
        .slice(0, 3),
    [filtered],
  );
  const hasOpenTasks = items.some((t) => t.status !== "done");

  // Looked up in the whole workspace so a link to a task that is not assigned to
  // me (e.g. from global search) still opens it.
  const selected: WorkspaceTask | undefined = allTasks.find((t) => t.id === selectedId);
  const linkedTaskId = dashboardFilter?.startsWith("task:") ? dashboardFilter.slice(5) : null;

  const openTask = (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
  };

  // "task:<id>" (dashboard rows, global search): open that task and bring its card
  // into view. It used to land on the board with nothing opened (FD-029).
  useEffect(() => {
    if (!linkedTaskId) return;
    setSelectedId(linkedTaskId);
    setDetailOpen(true);
    setScrollToId(linkedTaskId);
  }, [linkedTaskId]);

  // ?task=<id> (email links): open it once, after the tasks load. A task this
  // person cannot see (RLS), or one archived since, is not in the list.
  const openedEmailTask = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!emailTaskId) {
      openedEmailTask.current = undefined;
      return;
    }
    if (pageStatus !== "ready" || openedEmailTask.current === emailTaskId) return;
    openedEmailTask.current = emailTaskId;
    if (allTasks.some((task) => task.id === emailTaskId)) {
      setSelectedId(emailTaskId);
      setDetailOpen(true);
      setScrollToId(emailTaskId);
      return;
    }
    toast.error("That task isn't available to you.", {
      description: "It may have been archived, or you may no longer have access to it.",
    });
    onLinkedTaskClosed?.();
  }, [emailTaskId, pageStatus, allTasks, onLinkedTaskClosed]);

  const changeDetailOpen = (open: boolean) => {
    setDetailOpen(open);
    if (!open && emailTaskId) onLinkedTaskClosed?.();
  };

  useEffect(() => {
    if (!scrollToId) return;
    // Not rendered yet while tasks load; the effect re-runs when they arrive.
    const card = document.getElementById(cardDomId(scrollToId));
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    setScrollToId(null);
  }, [scrollToId, filtered, view]);

  // A task deleted from the drawer disappears from the list; close the drawer too.
  useEffect(() => {
    if (detailOpen && selectedId && !selected && pageStatus === "ready") setDetailOpen(false);
  }, [detailOpen, selectedId, selected, pageStatus]);

  const setStatus = (id: string, status: Status) => {
    const task = allTasks.find((item) => item.id === id);
    if (!task || task.status === status) return;
    // Was `progress: status === "done" ? 100 : task.progress`, which wrote 100%
    // back onto a reopened task (FD-025). The database now derives progress on
    // reopen — the subtask ratio, or 0 without subtasks — and updateTask derives
    // it locally from subtasks; mirror the no-subtask case so the card does not
    // show 100% until the reload lands.
    const reopenedWithoutSubtasks = task.status === "done" && !task.subtasks.length;
    void updateTask(id, reopenedWithoutSubtasks ? { status, progress: 0 } : { status });
    if (status === "done") {
      setJustCompleted(id);
      setTimeout(() => setJustCompleted(null), 700);
    }
  };

  const drop = (col: Status) => {
    if (!dragId) return;
    setStatus(dragId, col);
    setDragId(null);
  };

  // FD-030: a filter applied from the dashboard is named on screen and clearable.
  const filterChip = !dashboardFilter
    ? null
    : linkedTaskId
      ? pageStatus !== "ready"
        ? null
        : selected
          ? `Opened: ${selected.title}${selected.assigneeId === currentUserId ? "" : " (not assigned to you)"}`
          : "The linked task was not found"
      : `Filtered: ${dashboardFilterLabel(dashboardFilter, statusLabel)}`;

  const focusEmptyText = hasOpenTasks
    ? "No open tasks match the current filters."
    : items.length
      ? "Everything assigned to you is complete."
      : "Nothing is assigned to you yet.";

  return (
    <div className="space-y-6">
      <WorkspaceState status={pageStatus} hasTasks={items.length > 0} />
      {/* Top heading */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">My Tasks</h2>
          {/* Was "what you own this week", but the list is every open and past task assigned to you (FD-020). */}
          <p className="text-sm text-muted-foreground">
            Everything assigned to you, across all your projects.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNewTask}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Quick Add Task
          </button>
        </div>
      </div>

      {pageStatus === "ready" && items.length === 0 && (
        <div
          className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-6 text-center"
          role="status"
        >
          <p className="text-sm font-medium">Nothing is assigned to you yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tasks assigned to you will appear here. Use Quick Add Task to create one.
          </p>
        </div>
      )}

      {/* Summary widgets */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          {
            key: "total",
            label: "Total",
            value: counts.total,
            accent: "text-foreground",
            dot: "bg-muted-foreground/40",
          },
          {
            key: "todo",
            label: statusLabel("todo"),
            value: counts.pending,
            accent: "text-foreground",
            dot: "bg-status-todo",
          },
          {
            key: "progress",
            label: statusLabel("progress"),
            value: counts.progress,
            accent: "text-foreground",
            dot: "bg-status-progress",
          },
          {
            key: "done",
            label: statusLabel("done"),
            value: counts.completed,
            accent: "text-foreground",
            dot: "bg-status-done",
          },
          {
            key: "overdue",
            label: "Overdue",
            value: counts.overdue,
            accent: "text-destructive",
            dot: "bg-destructive",
          },
        ].map((s) => (
          <div
            key={s.key}
            className="group rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)] hover:-translate-y-0.5 transition"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {s.label}
              </span>
              <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden="true" />
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
          <div
            className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-soft)]"
            role="group"
            aria-label="Board view"
          >
            {[
              { id: "kanban", label: "Kanban", Icon: LayoutGrid },
              { id: "list", label: "List", Icon: List },
              { id: "priority", label: "Priority", Icon: Flag },
            ].map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={view === v.id}
                onClick={() => setView(v.id as View)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                  view === v.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <v.Icon className="h-3.5 w-3.5" aria-hidden="true" /> {v.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs shadow-[var(--shadow-soft)]">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <select
              aria-label="Filter by priority"
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
            <Hash className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <select
              aria-label="Filter by project"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="bg-transparent outline-none text-xs py-1 pr-1"
            >
              <option value="all">All projects</option>
              {projectOptions.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs shadow-[var(--shadow-soft)]">
            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <select
              aria-label="Sort tasks"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="bg-transparent outline-none text-xs py-1 pr-1"
            >
              <option value="due">Sort: Due date</option>
              <option value="priority">Sort: Priority</option>
              <option value="progress">Sort: Progress</option>
            </select>
          </div>

          {filterChip && (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary">
              <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate" title={filterChip}>
                {filterChip}
              </span>
              {onClearFilter && (
                <button
                  type="button"
                  onClick={onClearFilter}
                  aria-label="Clear dashboard filter"
                  className="shrink-0 rounded-full p-0.5 transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </span>
          )}
        </div>

        <div className="relative w-full lg:w-72">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            aria-label="Search my tasks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search my tasks…"
            className="h-9 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </div>
      </div>

      {/* Daily focus + productivity */}
      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <div className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              <h3 className="text-sm font-semibold">Today's Focus</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Top 3 open by priority, then due date
            </span>
          </div>
          {focus.length ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {focus.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTask(t.id)}
                  title={t.title}
                  className="min-w-0 text-left rounded-lg border border-border bg-secondary/40 p-3 hover:border-ring/40 hover:bg-secondary transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                      {t.project}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize",
                        priorityChip[t.priority],
                      )}
                    >
                      {t.priority}
                    </span>
                  </div>
                  <div className="mt-1.5 text-xs font-medium line-clamp-2 [overflow-wrap:anywhere]">
                    {t.title}
                  </div>
                  <div
                    className={cn(
                      "mt-2 flex items-center gap-1 whitespace-nowrap text-[10px] text-muted-foreground",
                      isOverdue(t, today) && "text-destructive font-medium",
                    )}
                  >
                    <CalIcon className="h-3 w-3" aria-hidden="true" />{" "}
                    {format(new Date(t.dueDate), "MMM d")}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              {focusEmptyText}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Productivity Score</h3>
            <span
              className="whitespace-nowrap text-[11px] text-muted-foreground"
              title={`${format(new Date(`${week.start}T00:00:00`), "EEE MMM d")} – ${format(new Date(`${week.end}T00:00:00`), "EEE MMM d")}`}
            >
              This week
            </span>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <ProductivityRing value={week.score} />
            <div className="space-y-1 text-xs">
              {week.scope ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-status-done" aria-hidden="true" />{" "}
                    {week.done} of {week.scope} done
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-status-progress"
                      aria-hidden="true"
                    />{" "}
                    {week.stillDue} still due this week
                  </div>
                </>
              ) : (
                <div className="text-muted-foreground">Nothing due or completed this week.</div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />{" "}
                {counts.overdue} overdue
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tasks. Detail opens in the shared TaskDetailDrawer: a modal over the Kanban
          board so columns don't reflow, a side sheet beside List/Priority. This page
          had its own panel with a generated description, five fake subtasks and
          demo activity, comments, files and time logs (FD-003, FD-004, FD-005). */}
      <div className="min-w-0">
        {view === "kanban" && (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
            {columns.map((col) => {
              const colTasks = filtered.filter((t) => t.status === col.id);
              const label = statusLabel(col.id);
              return (
                <section
                  key={col.id}
                  aria-label={label}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(col.id);
                  }}
                  className="min-w-0 rounded-xl border border-border bg-secondary/40 p-3 flex flex-col min-h-[260px]"
                >
                  <div className="flex items-center justify-between px-1 pb-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn("h-2 w-2 shrink-0 rounded-full", col.dot)}
                        aria-hidden="true"
                      />
                      <span className="truncate text-xs font-semibold uppercase tracking-wide">
                        {label}
                      </span>
                      <span className="rounded-md bg-card border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {colTasks.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={onNewTask}
                      aria-label="New task"
                      title="New task"
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    {colTasks.map((t) => (
                      <MyTaskCard
                        key={t.id}
                        task={t}
                        reference={taskRefs.get(t.id) ?? ""}
                        today={today}
                        active={selectedId === t.id}
                        completedPulse={justCompleted === t.id}
                        onSelect={() => openTask(t.id)}
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
                </section>
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
              const done = t.status === "done";
              const tags = t.tags ?? [];
              return (
                // A <div> row: the completion toggle is a real button now, and a
                // button cannot sit inside another button (FD-054).
                <div
                  key={t.id}
                  id={cardDomId(t.id)}
                  onClick={() => openTask(t.id)}
                  className={cn(
                    "w-full cursor-pointer text-left grid grid-cols-[1.5rem_1fr_8rem_7rem_7rem_5rem] gap-3 items-center px-4 py-3 border-b border-border last:border-0 hover:bg-accent/40 transition",
                    selectedId === t.id && "bg-accent/50",
                    justCompleted === t.id && "animate-pulse",
                  )}
                >
                  <button
                    type="button"
                    aria-label={done ? `Reopen “${t.title}”` : `Mark “${t.title}” complete`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStatus(t.id, done ? "todo" : "done");
                    }}
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded-full border transition",
                      done
                        ? "bg-status-done border-status-done text-white"
                        : "border-border hover:border-primary",
                    )}
                  >
                    {done && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  </button>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openTask(t.id);
                      }}
                      title={t.title}
                      className={cn(
                        "block w-full truncate text-left text-sm font-medium rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        done && "line-through text-muted-foreground",
                      )}
                    >
                      {t.title}
                    </button>
                    {/* Was the full uuid followed by " · " even with no tags. */}
                    <div className="truncate text-[10px] text-muted-foreground">
                      {taskRefs.get(t.id)}
                      {tags.length > 0 && ` · ${tags.join(" · ")}`}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{t.project}</div>
                  <span
                    className={cn(
                      "inline-flex w-fit whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize",
                      priorityChip[t.priority],
                    )}
                  >
                    {t.priority}
                  </span>
                  <div
                    className={cn(
                      "whitespace-nowrap text-xs",
                      isOverdue(t, today)
                        ? "text-destructive font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    {format(new Date(t.dueDate), "MMM d")}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <div
                      className="h-1.5 w-16 rounded-full bg-muted overflow-hidden"
                      role="progressbar"
                      aria-label={`Progress of “${t.title}”`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={t.progress}
                    >
                      <div className="h-full bg-primary" style={{ width: `${t.progress}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                {items.length
                  ? "No tasks match the current filters."
                  : "Nothing is assigned to you yet."}
              </div>
            )}
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
                        reference={taskRefs.get(t.id) ?? ""}
                        today={today}
                        active={selectedId === t.id}
                        completedPulse={justCompleted === t.id}
                        onSelect={() => openTask(t.id)}
                        onStatus={(s) => setStatus(t.id, s)}
                        compact
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                {items.length
                  ? "No tasks match the current filters."
                  : "Nothing is assigned to you yet."}
              </div>
            )}
          </div>
        )}
      </div>

      <TaskDetailDrawer
        task={selected}
        open={detailOpen && Boolean(selected)}
        onOpenChange={changeDetailOpen}
        variant={view === "kanban" ? "modal" : "sheet"}
      />
    </div>
  );
}

function ProductivityRing({ value }: { value: number | null }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const off = c - ((value ?? 0) / 100) * c;
  return (
    <div
      className="relative h-20 w-20 shrink-0"
      role="img"
      aria-label={
        value === null ? "No productivity score this week" : `Productivity score ${value}%`
      }
    >
      <svg viewBox="0 0 64 64" className="h-20 w-20 -rotate-90" aria-hidden="true">
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
      <div
        className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums"
        aria-hidden="true"
      >
        {value === null ? "—" : `${value}%`}
      </div>
    </div>
  );
}

function MyTaskCard({
  task,
  reference,
  today,
  active,
  compact,
  completedPulse,
  onSelect,
  onDragStart,
  onStatus,
}: {
  task: WorkspaceTask;
  reference: string;
  today: string;
  active?: boolean;
  compact?: boolean;
  completedPulse?: boolean;
  onSelect: () => void;
  onDragStart?: () => void;
  onStatus: (s: Status) => void;
}) {
  // The card's status picker reads in the task's own organization's words.
  const { statusLabelFor } = useTaskSettings();
  const statusLabel = (value: string) => statusLabelFor(value, task.organizationId);
  const overdue = isOverdue(task, today);
  // Real subtasks. This was progress / 20 out of a fixed 5, so a task with no
  // subtasks at 100% read "5/5" (FD-023).
  const subtasksDone = task.subtasks.filter((s) => s.completed).length;
  const tags = task.tags ?? [];
  return (
    <div
      id={cardDomId(task.id)}
      draggable={!!onDragStart}
      onDragStart={(e) => {
        // Firefox starts no drag without data on the transfer.
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onClick={onSelect}
      className={cn(
        "group min-w-0 cursor-pointer rounded-lg border bg-card p-3 shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)] hover:-translate-y-0.5 transition-all",
        active ? "border-primary/60 ring-2 ring-primary/15" : "border-border",
        completedPulse && "animate-pulse",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] font-medium text-muted-foreground">
          {reference} · {task.project}
        </span>
        <span
          className={cn(
            "shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize",
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
        {/* The title is the keyboard way in (FD-054). Clamped to three lines with
            the full text on hover; a 280-character title made a ~170px block (FD-047). */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          title={task.title}
          className="block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="line-clamp-3 [overflow-wrap:anywhere]">{task.title}</span>
        </button>
      </h4>
      {!compact && (
        // Was "Tagged ." on untagged tasks (FD-044).
        <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2 [overflow-wrap:anywhere]">
          Owned by {task.assignee.name}.{tags.length > 0 && ` Tagged ${tags.join(", ")}.`}
        </p>
      )}

      <div className="mt-2.5 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Progress</span>
          <span className="font-medium text-foreground">{task.progress}%</span>
        </div>
        <div className="h-1 rounded-full bg-muted overflow-hidden" aria-hidden="true">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${task.progress}%` }}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 whitespace-nowrap",
              overdue && "text-destructive font-medium",
            )}
          >
            <CalIcon className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">{overdue ? "Overdue, due" : "Due"} </span>
            {format(new Date(task.dueDate), "MMM d")}
          </span>
          {task.subtasks.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 whitespace-nowrap"
              title={`${subtasksDone} of ${task.subtasks.length} subtasks done`}
            >
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              {subtasksDone}/{task.subtasks.length}
              <span className="sr-only"> subtasks done</span>
            </span>
          )}
          <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
            <Timer className="h-3 w-3" aria-hidden="true" />
            {task.estimatedHours ?? 0}h<span className="sr-only"> estimated</span>
          </span>
        </div>
        {/* Real counts, hidden at zero. Both were hardcoded to 2 and 4 (FD-022). */}
        <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
          {task.attachments.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px]"
              title={`${task.attachments.length} attachment${task.attachments.length === 1 ? "" : "s"}`}
            >
              <Paperclip className="h-3 w-3" aria-hidden="true" />
              {task.attachments.length}
              <span className="sr-only"> attachments</span>
            </span>
          )}
          {task.comments > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px]"
              title={`${task.comments} comment${task.comments === 1 ? "" : "s"}`}
            >
              <MessageSquare className="h-3 w-3" aria-hidden="true" />
              {task.comments}
              <span className="sr-only"> comments</span>
            </span>
          )}
          <div
            className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white ring-2 ring-card"
            style={{ background: task.assignee.color }}
            title={task.assignee.name}
            role="img"
            aria-label={`Assigned to ${task.assignee.name}`}
          >
            <span aria-hidden="true">{task.assignee.initials}</span>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <select
          aria-label={`Status of “${task.title}”`}
          value={task.status}
          onChange={(e) => onStatus(e.target.value as Status)}
          className="text-[10px] rounded border border-border bg-background px-1.5 py-0.5 outline-none focus:border-ring"
        >
          {statusValues.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
