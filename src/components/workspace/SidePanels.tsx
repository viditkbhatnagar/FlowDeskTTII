import { projects, notifications, productivityTrend, teamWorkload, tasks } from "@/lib/mock-data";
import { format } from "date-fns";
import { Bell, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProjectsPanel() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Projects</h3>
        <button className="text-[11px] text-primary hover:underline">View all</button>
      </div>
      <div className="space-y-3">
        {projects.map((p) => (
          <div key={p.id} className="group">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                <span className="font-medium">{p.name}</span>
                <span className={cn(
                  "rounded px-1.5 py-px text-[10px] font-medium",
                  p.status === "on-track" && "bg-status-done/15 text-status-done",
                  p.status === "at-risk" && "bg-priority-medium/15 text-priority-medium",
                  p.status === "delayed" && "bg-destructive/15 text-destructive",
                )}>
                  {p.status}
                </span>
              </div>
              <span className="text-muted-foreground">{p.progress}%</span>
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${p.progress}%`, background: p.color }} />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{p.members} members · due {format(new Date(p.deadline), "MMM d")}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProductivityPanel() {
  const max = Math.max(...productivityTrend.map((d) => d.planned));
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold">Weekly Productivity</h3>
          <p className="text-[11px] text-muted-foreground">Completed vs planned</p>
        </div>
        <span className="rounded-md bg-status-done/15 px-2 py-0.5 text-[11px] font-medium text-status-done">+12%</span>
      </div>
      <div className="flex items-end gap-2 h-32">
        {productivityTrend.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end gap-0.5 h-full">
              <div className="flex-1 rounded-t bg-muted" style={{ height: `${(d.planned/max)*100}%` }} />
              <div className="flex-1 rounded-t bg-primary" style={{ height: `${(d.completed/max)*100}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground">{d.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkloadPanel() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <h3 className="text-sm font-semibold mb-3">Team Workload</h3>
      <div className="space-y-3">
        {teamWorkload.map((m) => {
          const pct = (m.tasks / m.capacity) * 100;
          return (
            <div key={m.name}>
              <div className="flex items-center gap-2 mb-1">
                <div className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: m.color }}>
                  {m.initials}
                </div>
                <span className="text-xs font-medium flex-1">{m.name}</span>
                <span className="text-[11px] text-muted-foreground">{m.tasks}/{m.capacity}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full", pct > 80 ? "bg-priority-high" : pct > 60 ? "bg-priority-medium" : "bg-status-done")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NotificationsPanel() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" /> Notifications</h3>
        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">3 new</span>
      </div>
      <div className="space-y-2">
        {notifications.map((n) => (
          <div key={n.id} className="flex gap-2 rounded-lg p-2 hover:bg-accent/60 transition">
            {n.unread && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
            <div className={cn("flex-1", !n.unread && "pl-3.5")}>
              <p className="text-xs leading-snug">{n.text}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{n.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UpcomingDeadlines() {
  const upcoming = [...tasks]
    .filter((t) => t.status !== "done")
    .sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))
    .slice(0, 4);
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)]">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Upcoming Deadlines</h3>
      <div className="space-y-2">
        {upcoming.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <div className="truncate font-medium">{t.title}</div>
              <div className="text-[10px] text-muted-foreground">{t.project}</div>
            </div>
            <div className="text-[11px] text-muted-foreground shrink-0">{format(new Date(t.dueDate), "MMM d")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
