import { useEffect, useState } from "react";
import { keepPreviousData, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FolderKanban,
  ListTodo,
  Sparkles,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { format, formatDistanceToNow, isToday, isTomorrow, parseISO } from "date-fns";
import {
  dashboardTimezone,
  getDashboard,
  taskDueDate,
  type DashboardActivity,
  type DashboardPayload,
  type DashboardTask,
} from "@/lib/dashboard.functions";
import { healthLabel, type ProjectHealth } from "@/lib/project-metrics";
import { useTaskSettings } from "@/lib/task-settings-data";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { todayIn } from "@/lib/today";

type Scope = "mine" | "team";
type Period = "week" | "month" | "quarter" | "custom";
type StatusLabel = (value: string) => string;

const PERIOD: Period = "month";
/** Long enough that remounts, tab focus and the scope toggle reuse what was loaded (FD-042). */
const STALE_MS = 60_000;
/** One refetch for a burst of edits (a create fires several change events). */
const REFRESH_DEBOUNCE_MS = 400;
const TREND_MAX_DAYS = 14;
const DAY_MS = 86_400_000;
const PREFERENCES_KEY = "flowdesk-dashboard-preferences";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const healthTone: Partial<Record<ProjectHealth, "danger" | "warning" | "success">> = {
  delayed: "danger",
  "at-risk": "warning",
  completed: "success",
};

// Work changed elsewhere (My Tasks, Team Tasks, …) while the dashboard was not
// mounted. Recorded at module level so the next mount refetches straight away
// instead of showing figures up to STALE_MS old.
let lastWorkChangeAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener("flowdesk-work-changed", () => { lastWorkChangeAt = Date.now(); });
}

const dashboardKey = (organizationId: string | null, scope: Scope) => ["dashboard", organizationId, scope, PERIOD] as const;

export function DashboardPage({
  onNavigate,
}: {
  onNavigate: (page: "my-tasks" | "team" | "projects", filter?: string) => void;
}) {
  const queryClient = useQueryClient();
  const fetchDashboard = useServerFn(getDashboard);
  const { statusLabel, statusLabelFor } = useTaskSettings();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("mine");
  // The query waits for the saved preferences. It used to fire once with the
  // defaults and again with the saved organization/scope, one of the duplicate
  // fetches in FD-042.
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PREFERENCES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { organizationId?: unknown; scope?: unknown };
        setOrganizationId(typeof parsed.organizationId === "string" && UUID.test(parsed.organizationId) ? parsed.organizationId : null);
        setScope(parsed.scope === "team" ? "team" : "mine");
      }
    } catch {
      try { window.localStorage.removeItem(PREFERENCES_KEY); } catch { /* storage blocked: nothing to clear */ }
    }
    setPrefsReady(true);
  }, []);
  useEffect(() => {
    if (!prefsReady) return;
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ organizationId, scope }));
    } catch { /* storage blocked (private window): the choice just isn't remembered */ }
  }, [prefsReady, organizationId, scope]);

  const dashboardQuery = (org: string | null, forScope: Scope) => queryOptions({
    queryKey: dashboardKey(org, forScope),
    queryFn: () => fetchDashboard({ data: { organizationId: org, scope: forScope, period: PERIOD, customStart: null, customEnd: null } }),
    staleTime: STALE_MS,
  });

  const query = useQuery({
    ...dashboardQuery(organizationId, scope),
    enabled: prefsReady,
    // Switching scope or organization keeps the current figures on screen while
    // the other set loads, instead of a 2-3 s skeleton (FD-042).
    placeholderData: keepPreviousData,
    refetchOnMount: (current) => (current.state.dataUpdatedAt < lastWorkChangeAt ? "always" : true),
  });

  // Debounced: this used to call refetch() on every event, so one edit fetched
  // the dashboard several times (FD-042). Invalidating the prefix also marks the
  // scope that is not on screen stale, so it reloads when toggled to.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ["dashboard"] }); }, REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener("flowdesk-work-changed", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("flowdesk-work-changed", refresh);
    };
  }, [queryClient]);

  // The server narrows an organization the user has left, or a team scope they
  // can't see, to what it actually returned. Store the answer under that key
  // before following it, so correcting local state doesn't fetch it a second time.
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return;
    const served = query.data;
    if (served.organizationId === organizationId && served.scope === scope) return;
    queryClient.setQueryData(dashboardKey(served.organizationId, served.scope), served);
    setOrganizationId(served.organizationId);
    setScope(served.scope);
  }, [organizationId, query.data, query.isPlaceholderData, queryClient, scope]);

  // A failed background refresh keeps the last figures on screen; say so.
  useEffect(() => {
    if (query.isError && query.data) toast.error("The dashboard could not refresh. Showing the last figures loaded.");
    // Once per failed fetch, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.errorUpdatedAt]);

  if (query.isPending) return <DashboardSkeleton />;
  if (!query.data) {
    return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-5"><h2 className="font-semibold">Dashboard unavailable</h2><p className="mt-1 text-sm text-muted-foreground">We couldn’t load your work overview. Your data has not been changed.</p><Button className="mt-4" variant="outline" onClick={() => query.refetch()}>Try again</Button></div>;
  }

  const data = query.data as DashboardPayload;
  const updating = query.isPlaceholderData;
  const page = data.scope === "team" ? "team" : "my-tasks";
  // The organization's calendar date, not UTC's. See src/lib/today.ts.
  const timezone = dashboardTimezone(data.organizations, data.organizationId);
  const today = todayIn(timezone);
  const open = data.tasks.filter((task) => !["done", "cancelled"].includes(task.status));
  const dueToday = open.filter((task) => taskDueDate(task) === today);
  const overdue = open.filter((task) => {
    const due = taskDueDate(task);
    return Boolean(due && due < today);
  });
  const review = open.filter((task) => task.status === "review");
  const blocked = open.filter((task) => task.blocked);
  const completed = data.tasks.filter((task) => {
    const day = task.completed_at ? dayIn(task.completed_at, timezone) : null;
    return Boolean(day && day >= data.range.start && day <= data.range.end);
  });
  const needsAttention = rankAttention(data.tasks, today).slice(0, 6);
  const deadlines = [...open.map((task) => ({ id: task.id, title: task.title, project: task.projectName, due: taskDueDate(task), type: "Task" })), ...data.milestones.map((milestone) => ({ id: milestone.id, title: milestone.title, project: milestone.projectName, due: milestone.due_date || milestone.due_at?.slice(0, 10) || null, type: "Milestone" }))].filter((item) => item.due && item.due >= today).sort((a, b) => String(a.due).localeCompare(String(b.due))).slice(0, 8);
  const trend = buildTrend(data.tasks, data.range.start, data.range.end, timezone);
  const trendHasData = trend.some((point) => point.created > 0 || point.completed > 0);
  const since = format(parseISO(data.range.start), "MMM d");
  const reviewName = statusLabel("review");
  const cards = [
    { label: "Open Tasks", value: open.length, detail: "Active work", icon: ListTodo, filter: "open", tone: "primary", ariaLabel: `Show ${count(open.length, "open task")}` },
    { label: "Due Today", value: dueToday.length, detail: "Due before day end", icon: CalendarClock, filter: "due-today", tone: "info", ariaLabel: `Show ${count(dueToday.length, "task")} due today` },
    { label: "Overdue", value: overdue.length, detail: overdue.length ? "Needs attention" : "Nothing overdue", icon: AlertTriangle, filter: "overdue", danger: overdue.length > 0, tone: "danger", ariaLabel: `Show ${count(overdue.length, "overdue task")}` },
    // The configured name for "review", not a hardcoded "Awaiting Review" (FD-018).
    { label: reviewName, value: review.length, detail: "Ready for a decision", icon: ClipboardCheck, filter: "review", tone: "violet", ariaLabel: `Show ${count(review.length, "task")} in ${reviewName}` },
    { label: "Blocked Tasks", value: blocked.length, detail: blocked.length ? "Dependencies unresolved" : "No blockers", icon: Ban, filter: "blocked", danger: blocked.length > 0, tone: "warning", ariaLabel: `Show ${count(blocked.length, "blocked task")}` },
    { label: statusLabel("done"), value: completed.length, detail: `Since ${since}`, icon: CheckCircle2, filter: "completed", tone: "success", ariaLabel: `Show ${count(completed.length, "task")} completed since ${since}` },
  ];

  return (
    <div className="space-y-5" aria-busy={updating}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0"><div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary"><Sparkles className="h-3.5 w-3.5" /> Operations overview</div><h2 className="break-words text-2xl font-semibold">{greeting()}, {data.profileName}</h2><p className="text-sm text-muted-foreground">Here’s what needs your attention across your work.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {updating && <span role="status" className="text-xs text-muted-foreground">Updating…</span>}
          {data.organizations.length > 1 && <Control label="Organization" value={organizationId ?? "all"} onChange={(value) => setOrganizationId(value === "all" ? null : value)} options={[{ value: "all", label: "All Organizations" }, ...data.organizations.map((organization) => ({ value: organization.id, label: organization.name }))]} />}
          {data.canViewTeam && <ScopeToggle scope={scope} onChange={setScope} onIntent={(next) => { void queryClient.prefetchQuery(dashboardQuery(organizationId, next)); }} />}
        </div>
      </div>

      <div className={cn("space-y-5 transition-opacity duration-200", updating && "opacity-60")}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => <button key={card.filter} type="button" aria-label={card.ariaLabel} onClick={() => onNavigate(page, card.filter)} className={cn("glass-surface group relative min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card/85 p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", card.tone === "danger" && "border-destructive/20", card.tone === "warning" && "border-warning/25")}><div className={cn("absolute inset-x-0 top-0 h-0.5 bg-primary", card.tone === "info" && "bg-info", card.tone === "danger" && "bg-destructive", card.tone === "violet" && "bg-violet", card.tone === "warning" && "bg-warning", card.tone === "success" && "bg-success")} /><div className="flex items-center justify-between gap-2"><span className="truncate text-xs font-medium text-muted-foreground">{card.label}</span><span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105", card.tone === "info" && "bg-info-soft text-info", card.tone === "danger" && "bg-destructive/10 text-destructive", card.tone === "violet" && "bg-violet-soft text-violet", card.tone === "warning" && "bg-warning-soft text-warning", card.tone === "success" && "bg-success-soft text-success")}><card.icon className="h-4 w-4" aria-hidden="true" /></span></div><div className="mt-2 text-2xl font-semibold">{card.value}</div><div className={cn("mt-1 text-[11px] text-muted-foreground", card.danger && "text-destructive")}>{card.detail}</div></button>)}
      </div>

      {/* minmax(0, …) tracks: a plain fr track grows to fit a long unbroken title,
          which pushed the page to 1962px wide at 375px (FD-019). */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Needs Attention" icon={AlertTriangle} tone="danger" action={() => onNavigate(page, "attention")}>
          {needsAttention.length ? <div className="divide-y divide-border">{needsAttention.map((task) => <TaskRow key={task.id} task={task} today={today} statusLabel={(value) => statusLabelFor(value, task.organization_id)} onClick={() => onNavigate(page, `task:${task.id}`)} />)}</div> : <Empty icon={CheckCircle2} text={`No urgent, overdue or blocked tasks, and nothing in ${reviewName}.`} />}
        </Panel>
        <Panel title="Upcoming Deadlines" icon={CalendarClock} tone="info">
          {deadlines.length ? <div className="space-y-3">{deadlines.map((item) => <button key={`${item.type}-${item.id}`} type="button" title={item.title} onClick={() => onNavigate(item.type === "Task" ? page : "projects", item.type === "Task" ? `task:${item.id}` : `project:${encodeURIComponent(item.project)}`)} className="flex w-full min-w-0 items-center justify-between gap-3 text-left"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.project} · {item.type}</p></div><span className="shrink-0 whitespace-nowrap text-xs font-medium">{deadlineLabel(String(item.due))}</span></button>)}</div> : <Empty icon={CalendarClock} text="No upcoming deadlines in this scope." />}
        </Panel>
      </div>

      {data.scope === "team" && data.organizations.length > 1 && !organizationId && <Panel title="Organization Overview" icon={Users} tone="violet"><div className="grid gap-3 md:grid-cols-2">{data.organizations.map((organization) => { const orgTasks = data.tasks.filter((task) => task.organization_id === organization.id); const orgOpen = orgTasks.filter((task) => !["done", "cancelled"].includes(task.status)); return <button key={organization.id} type="button" onClick={() => setOrganizationId(organization.id)} className="min-w-0 rounded-lg border border-border p-4 text-left transition hover:border-primary/25 hover:bg-primary/5"><div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{organization.name}</span><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /></div><p className="mt-2 text-sm text-muted-foreground">{orgOpen.length} open · {orgOpen.filter((task) => task.blocked).length} blocked</p></button>; })}</div></Panel>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Project Health" icon={FolderKanban} tone="primary" action={() => onNavigate("projects")}>
          {data.projects.length ? <div className="divide-y divide-border">{data.projects.slice(0, 6).map((project) => <button key={project.id} type="button" onClick={() => onNavigate("projects", `project:${encodeURIComponent(project.name)}`)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 text-left"><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{project.name}</span><Status text={healthLabel[project.health]} tone={healthTone[project.health]} /></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${project.progress}%` }} /></div><p className="mt-1 text-[11px] text-muted-foreground">{project.complete} of {project.taskCount} tasks completed</p></div><span className="text-sm font-semibold">{project.progress}%</span></button>)}</div> : <Empty icon={FolderKanban} text="No active projects in this scope." />}
        </Panel>
        <Panel title="Recent Activity" icon={Clock3} tone="info">
          {data.activity.length ? <div className="space-y-4">{data.activity.slice(0, 7).map((item) => { const sentence = describe(item, (value) => statusLabelFor(value, item.organization_id)); return <div key={item.id} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" /><div className="min-w-0"><p className="line-clamp-2 break-words text-sm"><span className="font-medium">{item.actorName}</span> {sentence.verb} <span className="font-medium">{sentence.target}</span>{sentence.suffix}</p><p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(item.occurred_at), { addSuffix: true })}</p></div></div>; })}</div> : <Empty icon={AlertCircle} text="No recorded activity in this scope." />}
        </Panel>
      </div>

      <div className={cn("grid gap-4", data.scope === "team" && "xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
        <Panel title="Task Completion Trend" icon={TrendingUp} tone="success" className="flex flex-col">
          {/* Was two unlabeled areas with no axis values, and a caption describing a
              single "created minus completed" metric that was never plotted (FD-041). */}
          {trendHasData ? <><ChartContainer config={{ created: { label: "Created", color: "var(--primary)" }, completed: { label: statusLabel("done"), color: "var(--status-done)" } }} className="aspect-auto min-h-52 w-full flex-1"><AreaChart data={trend} accessibilityLayer margin={{ top: 4, right: 8, bottom: 0, left: 0 }}><CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={16} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} /><ChartTooltip cursor content={<ChartTooltipContent indicator="dot" />} /><ChartLegend content={<ChartLegendContent />} /><Area type="monotone" dataKey="created" stroke="var(--color-created)" fill="var(--color-created)" fillOpacity={0.12} /><Area type="monotone" dataKey="completed" stroke="var(--color-completed)" fill="var(--color-completed)" fillOpacity={0.14} /></AreaChart></ChartContainer><p className="mt-3 shrink-0 text-xs text-muted-foreground">{data.scope === "team" ? "Team tasks" : "Your tasks"} created and completed each day over the last {count(trend.length, "day")}, from recorded timestamps.</p></> : <Empty icon={Clock3} text={`No tasks were created or completed in the last ${count(trend.length, "day")}.`} />}
        </Panel>
        {data.scope === "team" && <Panel title="Team Workload" icon={Users} tone="violet">{data.workload.length ? <div className="divide-y divide-border">{data.workload.slice(0, 7).map((person) => <button key={person.userId} type="button" onClick={() => onNavigate("team", `assignee:${person.userId}`)} className="w-full min-w-0 py-3 text-left"><div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{person.name}</span><span className="text-sm font-semibold">{person.open}</span></div><p className="mt-1 text-xs text-muted-foreground">{person.estimatedHours}h planned · {person.overdue} overdue · {person.blocked} blocked</p></button>)}</div> : <Empty icon={Users} text="No assigned team workload in this scope." />}</Panel>}
      </div>
      </div>
    </div>
  );
}

function count(value: number, noun: string) { return `${value} ${noun}${value === 1 ? "" : "s"}`; }
/** Was always "Good afternoon". The authenticated area renders client-side only, so the local hour is safe here. */
function greeting() { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; }

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
/** The calendar day (yyyy-mm-dd) a timestamp falls on in the organization's timezone, not UTC's. */
function dayIn(iso: string, timezone?: string) {
  if (!timezone) return iso.slice(0, 10);
  try {
    let formatter = dayFormatters.get(timezone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
      dayFormatters.set(timezone, formatter);
    }
    return formatter.format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function rankAttention(tasks: DashboardTask[], today: string) { return tasks.filter((task) => { const due = taskDueDate(task); return !["done", "cancelled"].includes(task.status) && (task.blocked || task.status === "review" || task.priority === "critical" || Boolean(due && due < today)); }).sort((a, b) => Number(b.blocked) - Number(a.blocked) || String(taskDueDate(a)).localeCompare(String(taskDueDate(b)))); }
function deadlineLabel(value: string) { const date = parseISO(value); if (isToday(date)) return "Today"; if (isTomorrow(date)) return "Tomorrow"; return format(date, "EEE, MMM d"); }

/** Tasks created and completed per day, for the last TREND_MAX_DAYS days of the period, bucketed by the organization's calendar day. */
function buildTrend(tasks: DashboardTask[], start: string, end: string, timezone?: string) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const days = Math.min(TREND_MAX_DAYS, Math.max(1, Math.round((endMs - startMs) / DAY_MS) + 1));
  const tally = (values: (string | null)[]) => values.reduce((totals, day) => (day ? totals.set(day, (totals.get(day) ?? 0) + 1) : totals), new Map<string, number>());
  const created = tally(tasks.map((task) => dayIn(task.created_at, timezone)));
  const completed = tally(tasks.map((task) => (task.completed_at ? dayIn(task.completed_at, timezone) : null)));
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(endMs - (days - index - 1) * DAY_MS).toISOString().slice(0, 10);
    return { label: format(parseISO(day), "MMM d"), created: created.get(day) ?? 0, completed: completed.get(day) ?? 0 };
  });
}

/**
 * One activity row as "<actor> <verb> <target><suffix>". The old lookup covered six
 * event types, so status changes, edits, comments and files rendered "undefined";
 * status names come from settings (FD-018).
 */
function describe(item: DashboardActivity, statusLabel: StatusLabel): { verb: string; target: string; suffix: string } {
  const details = item.details && typeof item.details === "object" && !Array.isArray(item.details) ? item.details : {};
  const to = typeof details.to === "string" ? details.to : null;
  const target = item.taskTitle || item.projectName || "work";
  const sentence = (verb: string, suffix = "") => ({ verb, target, suffix });
  switch (item.event_type) {
    case "task_created": return sentence("created");
    case "task_completed": return sentence("completed");
    case "task_review_submitted": return sentence("sent", ` to ${statusLabel("review")}`);
    case "task_status_changed": return to ? sentence("moved", ` to ${statusLabel(to)}`) : sentence("changed the status of");
    case "task_assignee_changed": return sentence("reassigned");
    case "task_due_date_changed": return sentence("changed the due date for");
    case "task_updated": return sentence("edited");
    case "task_commented": return sentence("commented on");
    case "task_file_attached": return sentence("attached a file to");
    case "task_archived": return sentence("deleted");
    case "project_updated": return sentence("updated");
    case "project_document_added": return sentence("uploaded a document to");
    case "milestone_completed": return sentence("completed a milestone in");
    default: return sentence(String(item.event_type).replace(/_/g, " "));
  }
}

function ScopeToggle({ scope, onChange, onIntent }: { scope: Scope; onChange: (scope: Scope) => void; onIntent: (scope: Scope) => void }) {
  const options: { value: Scope; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: "mine", label: "My Overview", icon: User },
    { value: "team", label: "Team Overview", icon: Users },
  ];
  return (
    <div role="group" aria-label="Dashboard scope" className="glass-surface flex items-center gap-0.5 rounded-full border border-border/70 bg-muted/40 p-1 shadow-sm">
      {options.map((option) => {
        const active = scope === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            // Starts loading the other scope on hover/focus, so the click is usually instant.
            onPointerEnter={() => { if (!active) onIntent(option.value); }}
            onFocus={() => { if (!active) onIntent(option.value); }}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary text-primary-foreground shadow-[var(--shadow-card)]"
                : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
            )}
          >
            <option.icon className="h-3.5 w-3.5" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
// Was wrapped in "sr-only sm:not-sr-only", which left an invisible but focusable select on phones.
function Control({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) { return <label className="flex"><span className="sr-only">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 max-w-48 rounded-md border border-input bg-card px-2.5 text-xs font-medium outline-none focus:ring-2 focus:ring-ring">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
// min-w-0: a grid item otherwise refuses to shrink below its longest unbroken line (FD-019).
function Panel({ title, icon: Icon, tone = "primary", action, className, children }: { title: string; icon?: React.ComponentType<{ className?: string }>; tone?: "primary" | "danger" | "info" | "success" | "violet"; action?: () => void; className?: string; children: React.ReactNode }) { return <section className={cn("glass-surface min-w-0 rounded-xl border border-border/80 bg-card/85 p-4", className)}><div className="mb-4 flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2.5">{Icon && <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary", tone === "danger" && "bg-destructive/10 text-destructive", tone === "info" && "bg-info-soft text-info", tone === "success" && "bg-success-soft text-success", tone === "violet" && "bg-violet-soft text-violet")}><Icon className="h-4 w-4" /></span>}<h3 className="truncate text-sm font-semibold">{title}</h3></div>{action && <Button variant="ghost" size="sm" className="shrink-0" aria-label={`View all ${title}`} onClick={action}>View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Button>}</div>{children}</section>; }
function Status({ text, tone }: { text: string; tone?: "danger" | "warning" | "success" }) { return <span className={cn("shrink-0 whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground", tone === "danger" && "bg-destructive/10 text-destructive", tone === "warning" && "bg-warning-soft text-warning", tone === "success" && "bg-success-soft text-success")}>{text}</span>; }
function TaskRow({ task, today, statusLabel, onClick }: { task: DashboardTask; today: string; statusLabel: StatusLabel; onClick: () => void }) { const due = taskDueDate(task); return <button type="button" title={task.title} onClick={onClick} className="flex w-full min-w-0 items-center justify-between gap-3 py-3 text-left"><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{task.title}</span>{task.blocked && <Status text="Blocked" tone="danger" />}</div><p className="truncate text-xs text-muted-foreground">{task.projectName} · {statusLabel(task.status)}</p></div><span className={cn("shrink-0 whitespace-nowrap text-xs text-muted-foreground", due && due < today && "font-medium text-destructive")}>{due ? format(parseISO(due), "MMM d") : "No due date"}</span></button>; }
function Empty({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) { return <div className="flex min-h-28 flex-col items-center justify-center text-center"><Icon className="h-5 w-5 text-muted-foreground" /><p className="mt-2 max-w-xs text-sm text-muted-foreground">{text}</p></div>; }
function DashboardSkeleton() { return <div className="space-y-5" role="status" aria-label="Loading dashboard"><div className="flex justify-between gap-4"><div className="min-w-0 space-y-2"><Skeleton className="h-7 w-64 max-w-full" /><Skeleton className="h-4 w-80 max-w-full" /></div><Skeleton className="hidden h-9 w-80 sm:block" /></div><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-28 rounded-lg" />)}</div><div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"><Skeleton className="h-80 rounded-lg" /><Skeleton className="h-80 rounded-lg" /></div></div>; }
