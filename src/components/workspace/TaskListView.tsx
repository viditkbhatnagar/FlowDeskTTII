import { tasks } from "@/lib/mock-data";
import { format } from "date-fns";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const priorityStyles: Record<string, string> = {
  low: "bg-priority-low/15 text-priority-low",
  medium: "bg-priority-medium/15 text-priority-medium",
  high: "bg-priority-high/15 text-priority-high",
  critical: "bg-priority-critical/15 text-priority-critical",
};
const statusStyles: Record<string, string> = {
  todo: "bg-status-todo/15 text-status-todo",
  progress: "bg-status-progress/15 text-status-progress",
  review: "bg-status-review/15 text-status-review",
  done: "bg-status-done/15 text-status-done",
};
const statusLabel: Record<string, string> = {
  todo: "To Do",
  progress: "In Progress",
  review: "Review",
  done: "Completed",
};

export function TaskListView() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-[var(--shadow-soft)]">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left font-medium px-4 py-3">Task</th>
              <th className="text-left font-medium px-4 py-3">Project</th>
              <th className="text-left font-medium px-4 py-3">Priority</th>
              <th className="text-left font-medium px-4 py-3">Assignee</th>
              <th className="text-left font-medium px-4 py-3">Status</th>
              <th className="text-left font-medium px-4 py-3">Due</th>
              <th className="text-left font-medium px-4 py-3 w-40">Progress</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-accent/40 transition">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{t.title}</div>
                  <div className="text-[11px] text-muted-foreground">{t.id}</div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{t.project}</td>
                <td className="px-4 py-3">
                  <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium capitalize", priorityStyles[t.priority])}>
                    {t.priority}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: t.assignee.color }}
                    >
                      {t.assignee.initials}
                    </div>
                    <span className="text-foreground">{t.assignee.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", statusStyles[t.status])}>
                    {statusLabel[t.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{format(new Date(t.dueDate), "MMM d, yyyy")}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${t.progress}%` }} />
                    </div>
                    <span className="text-[11px] text-muted-foreground w-9 text-right">{t.progress}%</span>
                  </div>
                </td>
                <td className="px-2">
                  <button className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
