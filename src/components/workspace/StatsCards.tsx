import { ListChecks, Clock, Loader2, CheckCircle2, AlertTriangle, TrendingUp } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-data";

export function StatsCards() {
  const { tasks } = useWorkspace();

  const now = new Date();
  const today = now.toDateString();

  const total = tasks.length;
  const pending = tasks.filter((t) => t.status === "todo").length;
  const inProgress = tasks.filter((t) => t.status === "progress").length;
  const inReview = tasks.filter((t) => t.status === "review").length;
  const completed = tasks.filter((t) => t.status === "done").length;
  const open = total - completed;
  const overdue = tasks.filter(
    (t) => t.status !== "done" && new Date(t.dueDate) < now
  ).length;
  const dueToday = tasks.filter(
    (t) => t.status !== "done" && new Date(t.dueDate).toDateString() === today
  ).length;
  const productivity = total > 0 ? Math.round((completed / total) * 100) : 0;

  const cards = [
    {
      label: "Total Tasks",
      value: total,
      icon: ListChecks,
      accent: "text-foreground",
      delta: `${open} open`,
    },
    {
      label: "Pending",
      value: pending,
      icon: Clock,
      accent: "text-status-todo",
      delta: dueToday > 0 ? `${dueToday} due today` : "none due today",
    },
    {
      label: "In Progress",
      value: inProgress,
      icon: Loader2,
      accent: "text-status-progress",
      delta: inReview > 0 ? `${inReview} in review` : "none in review",
    },
    {
      label: "Completed",
      value: completed,
      icon: CheckCircle2,
      accent: "text-status-done",
      delta: total > 0 ? `${Math.round((completed / total) * 100)}% of all tasks` : "no tasks yet",
    },
    {
      label: "Overdue",
      value: overdue,
      icon: AlertTriangle,
      accent: overdue > 0 ? "text-destructive" : "text-muted-foreground",
      delta: overdue > 0 ? "needs attention" : "all on time",
    },
    {
      label: "Productivity",
      value: `${productivity}%`,
      icon: TrendingUp,
      accent: "text-primary",
      delta: "completion rate",
    },
  ];

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            className="group rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] transition hover:shadow-[var(--shadow-card)]"
          >
            <div className="flex items-start justify-between">
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
              <Icon className={`h-4 w-4 ${c.accent}`} />
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight">{c.value}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{c.delta}</div>
          </div>
        );
      })}
    </div>
  );
}
