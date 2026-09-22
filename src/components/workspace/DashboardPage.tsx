import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
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
import { getDashboard, type DashboardPayload, type DashboardTask } from "@/lib/dashboard.functions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { todayIn } from "@/lib/today";

type Scope = "mine" | "team";
type Period = "week" | "month" | "quarter" | "custom";
const statusLabel: Record<string, string> = { todo: "To do", progress: "In progress", review: "Awaiting review", done: "Completed", cancelled: "Cancelled" };
const activityLabel: Record<string, string> = {
  task_created: "created",
  task_completed: "completed",
  task_review_submitted: "submitted for review",
  task_assignee_changed: "reassigned",
  task_due_date_changed: "changed the due date for",
  milestone_completed: "completed a milestone in",
};

export function DashboardPage({
  onNavigate,
}: {
  onNavigate: (page: "my-tasks" | "team" | "projects", filter?: string) => void;
}) {
  const fetchDashboard = useServerFn(getDashboard);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("mine");
  const period: Period = "month";

  useEffect(() => {
    const saved = window.localStorage.getItem("flowdesk-dashboard-preferences");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { organizationId?: string | null; scope?: Scope };
      setOrganizationId(parsed.organizationId ?? null);
      setScope(parsed.scope ?? "mine");
    } catch {
      window.localStorage.removeItem("flowdesk-dashboard-preferences");
    }
  }, []);
  useEffect(() => {
    window.localStorage.setItem("flowdesk-dashboard-preferences", JSON.stringify({ organizationId, scope }));
  }, [organizationId, scope]);

  const query = useQuery({
    queryKey: ["dashboard", organizationId, scope, period],
    queryFn: () => fetchDashboard({ data: { organizationId, scope, period, customStart: null, customEnd: null } }),
  });

  useEffect(() => {
    const refresh = () => { void query.refetch(); };
    window.addEventListener("flowdesk-work-changed", refresh);
    return () => window.removeEventListener("flowdesk-work-changed", refresh);
  }, [query.refetch]);

  useEffect(() => {
    if (!query.data) return;
    if (organizationId && !query.data.organizations.some((organization) => organization.id === organizationId)) setOrganizationId(null);
    if (scope === "team" && !query.data.canViewTeam) setScope("mine");
  }, [organizationId, query.data, scope]);

  if (query.isPending) return <DashboardSkeleton />;
  if (query.isError || !query.data) {
    return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-5"><h2 className="font-semibold">Dashboard unavailable</h2><p className="mt-1 text-sm text-muted-foreground">We couldn’t load your work overview. Your data has not been changed.</p><Button className="mt-4" variant="outline" onClick={() => query.refetch()}>Try again</Button></div>;
  }

  const data = query.data as DashboardPayload;
  const page = data.scope === "team" ? "team" : "my-tasks";
  // The organization's calendar date, not UTC's. See src/lib/today.ts.
  const today = todayIn(data?.organizations.find((o) => o.id === data.organizationId)?.timezone
    ?? data?.organizations[0]?.timezone);
  const open = data.tasks.filter((task) => !["done", "cancelled"].includes(task.status));
  const dueToday = open.filter((task) => dateOf(task) === today);
  const overdue = open.filter((task) => {
    const due = dateOf(task);
    return Boolean(due && due < today);
  });
  const review = open.filter((task) => task.status === "review");
  const blocked = open.filter((task) => task.blocked);
  const completed = data.tasks.filter((task) => task.completed_at && task.completed_at.slice(0, 10) >= data.range.start && task.completed_at.slice(0, 10) <= data.range.end);
  const needsAttention = rankAttention(data.tasks, today).slice(0, 6);
  const deadlines = [...open.map((task) => ({ id: task.id, title: task.title, project: task.projectName, due: dateOf(task), type: "Task" })), ...data.milestones.map((milestone) => ({ id: milestone.id, title: milestone.title, project: milestone.projectName, due: milestone.due_date || milestone.due_at?.slice(0, 10) || null, type: "Milestone" }))].filter((item) => item.due && item.due >= today).sort((a, b) => String(a.due).localeCompare(String(b.due))).slice(0, 8);
  const trend = buildTrend(data.tasks, data.range.start, data.range.end);
  const cards = [
    { label: "Open Tasks", value: open.length, detail: "Active work", icon: ListTodo, filter: "open", tone: "primary" },
    { label: "Due Today", value: dueToday.length, detail: "Due before day end", icon: CalendarClock, filter: "due-today", tone: "info" },
    { label: "Overdue", value: overdue.length, detail: overdue.length ? "Needs attention" : "Nothing overdue", icon: AlertTriangle, filter: "overdue", danger: overdue.length > 0, tone: "danger" },
    { label: "Awaiting Review", value: review.length, detail: "Ready for a decision", icon: ClipboardCheck, filter: "review", tone: "violet" },
    { label: "Blocked Tasks", value: blocked.length, detail: blocked.length ? "Dependencies unresolved" : "No blockers", icon: Ban, filter: "blocked", danger: blocked.length > 0, tone: "warning" },
    { label: "Completed", value: completed.length, detail: `Since ${format(parseISO(data.range.start), "MMM d")}`, icon: CheckCircle2, filter: "completed", tone: "success" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="mb-1 flex items-center gap-2 text-xs font-semibold text-primary"><Sparkles className="h-3.5 w-3.5" /> Operations overview</div><h2 className="text-2xl font-semibold">Good afternoon, {data.profileName}</h2><p className="text-sm text-muted-foreground">Here’s what needs your attention across your work.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {data.organizations.length > 1 && <Control label="Organization" value={organizationId ?? "all"} onChange={(value) => setOrganizationId(value === "all" ? null : value)} options={[{ value: "all", label: "All Organizations" }, ...data.organizations.map((organization) => ({ value: organization.id, label: organization.name }))]} />}
          {data.canViewTeam && <ScopeToggle scope={scope} onChange={setScope} />}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => <button key={card.label} onClick={() => onNavigate(page, card.filter)} className={cn("glass-surface group relative overflow-hidden rounded-xl border border-border/80 bg-card/85 p-4 text-left transition duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", card.tone === "danger" && "border-destructive/20", card.tone === "warning" && "border-warning/25")}><div className={cn("absolute inset-x-0 top-0 h-0.5 bg-primary", card.tone === "info" && "bg-info", card.tone === "danger" && "bg-destructive", card.tone === "violet" && "bg-violet", card.tone === "warning" && "bg-warning", card.tone === "success" && "bg-success")} /><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-muted-foreground">{card.label}</span><span className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105", card.tone === "info" && "bg-info-soft text-info", card.tone === "danger" && "bg-destructive/10 text-destructive", card.tone === "violet" && "bg-violet-soft text-violet", card.tone === "warning" && "bg-warning-soft text-warning", card.tone === "success" && "bg-success-soft text-success")}><card.icon className="h-4 w-4" /></span></div><div className="mt-2 text-2xl font-semibold">{card.value}</div><div className={cn("mt-1 text-[11px] text-muted-foreground", card.danger && "text-destructive")}>{card.detail}</div></button>)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel title="Needs Attention" icon={AlertTriangle} tone="danger" action={() => onNavigate(page, "attention")}>
          {needsAttention.length ? <div className="divide-y divide-border">{needsAttention.map((task) => <TaskRow key={task.id} task={task} onClick={() => onNavigate(page, `task:${task.id}`)} />)}</div> : <Empty icon={CheckCircle2} text="No urgent, overdue, blocked, or review tasks." />}
        </Panel>
        <Panel title="Upcoming Deadlines" icon={CalendarClock} tone="info">
          {deadlines.length ? <div className="space-y-3">{deadlines.map((item) => <button key={`${item.type}-${item.id}`} onClick={() => onNavigate(item.type === "Task" ? page : "projects", item.type === "Task" ? `task:${item.id}` : `project:${encodeURIComponent(item.project)}`)} className="flex w-full items-center justify-between gap-3 text-left"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.project} · {item.type}</p></div><span className="shrink-0 text-xs font-medium">{deadlineLabel(String(item.due))}</span></button>)}</div> : <Empty icon={CalendarClock} text="No upcoming deadlines in this scope." />}
        </Panel>
      </div>

      {data.scope === "team" && data.organizations.length > 1 && !organizationId && <Panel title="Organization Overview" icon={Users} tone="violet"><div className="grid gap-3 md:grid-cols-2">{data.organizations.map((organization) => { const orgTasks = data.tasks.filter((task) => task.organization_id === organization.id); const orgOpen = orgTasks.filter((task) => !["done", "cancelled"].includes(task.status)); return <button key={organization.id} onClick={() => setOrganizationId(organization.id)} className="rounded-lg border border-border p-4 text-left transition hover:border-primary/25 hover:bg-primary/5"><div className="flex items-center justify-between"><span className="font-medium">{organization.name}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /></div><p className="mt-2 text-sm text-muted-foreground">{orgOpen.length} open · {orgOpen.filter((task) => task.blocked).length} blocked</p></button>; })}</div></Panel>}

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel title="Project Health" icon={FolderKanban} tone="primary" action={() => onNavigate("projects")}>
          {data.projects.length ? <div className="divide-y divide-border">{data.projects.slice(0, 6).map((project) => <button key={project.id} onClick={() => onNavigate("projects", `project:${encodeURIComponent(project.name)}`)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 text-left"><div><div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{project.name}</span><Status text={project.health} danger={project.health === "Delayed"} /></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${project.progress}%` }} /></div><p className="mt-1 text-[11px] text-muted-foreground">{project.complete} of {project.taskCount} tasks completed</p></div><span className="text-sm font-semibold">{project.progress}%</span></button>)}</div> : <Empty icon={FolderKanban} text="No active projects in this scope." />}
        </Panel>
        <Panel title="Recent Activity" icon={Clock3} tone="info">
          {data.activity.length ? <div className="space-y-4">{data.activity.slice(0, 7).map((item) => <div key={item.id} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" /><div><p className="text-sm"><span className="font-medium">{item.actorName}</span> {activityLabel[item.event_type]} <span className="font-medium">{item.taskTitle || item.projectName || "work"}</span></p><p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(item.occurred_at), { addSuffix: true })}</p></div></div>)}</div> : <Empty icon={AlertCircle} text="No recorded activity in this scope." />}
        </Panel>
      </div>

      <div className={cn("grid gap-4", data.scope === "team" && "xl:grid-cols-[2fr_1fr]")}>
        <Panel title="Task Completion Trend" icon={TrendingUp} tone="success" className="flex flex-col">
          {completed.length ? <><ChartContainer config={{ created: { label: "Created", color: "var(--primary)" }, completed: { label: "Completed", color: "var(--status-done)" } }} className="w-full min-h-28 flex-1 aspect-auto"><AreaChart data={trend} accessibilityLayer margin={{ top: 4, right: 4, bottom: 0, left: 4 }}><CartesianGrid vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Area type="monotone" dataKey="created" stroke="var(--color-created)" fill="var(--color-created)" fillOpacity={0.12} /><Area type="monotone" dataKey="completed" stroke="var(--color-completed)" fill="var(--color-completed)" fillOpacity={0.14} /></AreaChart></ChartContainer><p className="mt-3 shrink-0 text-xs text-muted-foreground">Created minus completed, based only on recorded timestamps.</p></> : <Empty icon={Clock3} text="No trustworthy completion history exists for this period yet." />}
        </Panel>
        {data.scope === "team" && <Panel title="Team Workload" icon={Users} tone="violet">{data.workload.length ? <div className="divide-y divide-border">{data.workload.slice(0, 7).map((person) => <button key={person.userId} onClick={() => onNavigate("team", `assignee:${person.userId}`)} className="w-full py-3 text-left"><div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{person.name}</span><span className="text-sm font-semibold">{person.open}</span></div><p className="mt-1 text-xs text-muted-foreground">{person.estimatedHours}h planned · {person.overdue} overdue · {person.blocked} blocked</p></button>)}</div> : <Empty icon={Users} text="No assigned team workload in this scope." />}</Panel>}
      </div>
    </div>
  );
}

function dateOf(task: DashboardTask) { return task.due_date || task.due_at?.slice(0, 10) || null; }
function rankAttention(tasks: DashboardTask[], today: string) { return tasks.filter((task) => { const due = dateOf(task); return !["done", "cancelled"].includes(task.status) && (task.blocked || task.status === "review" || task.priority === "critical" || Boolean(due && due < today)); }).sort((a, b) => Number(b.blocked) - Number(a.blocked) || String(dateOf(a)).localeCompare(String(dateOf(b)))); }
function deadlineLabel(value: string) { const date = parseISO(value); if (isToday(date)) return "Today"; if (isTomorrow(date)) return "Tomorrow"; return format(date, "EEE, MMM d"); }
function buildTrend(tasks: DashboardTask[], start: string, end: string) { const startDate = parseISO(start); const endDate = parseISO(end); const days = Math.min(14, Math.max(1, Math.ceil((+endDate - +startDate) / 86400000) + 1)); return Array.from({ length: days }, (_, index) => { const date = new Date(+endDate - (days - index - 1) * 86400000); const key = date.toISOString().slice(0, 10); return { label: format(date, "MMM d"), created: tasks.filter((task) => task.created_at.slice(0, 10) === key).length, completed: tasks.filter((task) => task.completed_at?.slice(0, 10) === key).length }; }); }
function ScopeToggle({ scope, onChange }: { scope: Scope; onChange: (scope: Scope) => void }) {
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
function Control({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) { return <label className="sr-only sm:not-sr-only"><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 max-w-48 rounded-md border border-input bg-card px-2.5 text-xs font-medium outline-none focus:ring-2 focus:ring-ring">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function Panel({ title, icon: Icon, tone = "primary", action, className, children }: { title: string; icon?: React.ComponentType<{ className?: string }>; tone?: "primary" | "danger" | "info" | "success" | "violet"; action?: () => void; className?: string; children: React.ReactNode }) { return <section className={cn("glass-surface rounded-xl border border-border/80 bg-card/85 p-4", className)}><div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2.5">{Icon && <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary", tone === "danger" && "bg-destructive/10 text-destructive", tone === "info" && "bg-info-soft text-info", tone === "success" && "bg-success-soft text-success", tone === "violet" && "bg-violet-soft text-violet")}><Icon className="h-4 w-4" /></span>}<h3 className="text-sm font-semibold">{title}</h3></div>{action && <Button variant="ghost" size="sm" onClick={action}>View all <ArrowRight className="h-3.5 w-3.5" /></Button>}</div>{children}</section>; }
function Status({ text, danger }: { text: string; danger?: boolean }) { return <span className={cn("rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground", danger && "bg-destructive/10 text-destructive")}>{text}</span>; }
function TaskRow({ task, onClick }: { task: DashboardTask; onClick: () => void }) { const due = dateOf(task); return <button onClick={onClick} className="flex w-full items-center justify-between gap-3 py-3 text-left"><div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{task.title}</span>{task.blocked && <Status text="Blocked" danger />}</div><p className="text-xs text-muted-foreground">{task.projectName} · {statusLabel[task.status]}</p></div><span className={cn("shrink-0 text-xs text-muted-foreground", due && due < new Date().toISOString().slice(0, 10) && "font-medium text-destructive")}>{due ? format(parseISO(due), "MMM d") : "No due date"}</span></button>; }
function Empty({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) { return <div className="flex min-h-28 flex-col items-center justify-center text-center"><Icon className="h-5 w-5 text-muted-foreground" /><p className="mt-2 max-w-xs text-sm text-muted-foreground">{text}</p></div>; }
function DashboardSkeleton() { return <div className="space-y-5" aria-label="Loading dashboard"><div className="flex justify-between"><div className="space-y-2"><Skeleton className="h-7 w-64" /><Skeleton className="h-4 w-80" /></div><Skeleton className="h-9 w-80" /></div><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-28 rounded-lg" />)}</div><div className="grid gap-4 xl:grid-cols-[2fr_1fr]"><Skeleton className="h-80 rounded-lg" /><Skeleton className="h-80 rounded-lg" /></div></div>; }