import { Calendar, Paperclip, MessageSquare } from "lucide-react";
import type { Task } from "@/lib/mock-data";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const priorityStyles: Record<string, string> = {
  low: "bg-priority-low/15 text-priority-low",
  medium: "bg-priority-medium/15 text-priority-medium",
  high: "bg-priority-high/15 text-priority-high",
  critical: "bg-priority-critical/15 text-priority-critical",
};

export function TaskCard({ task, draggable = true, onDragStart }: {
  task: Task;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const overdue = new Date(task.dueDate) < new Date() && task.status !== "done";
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className="group cursor-grab active:cursor-grabbing rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)] hover:border-ring/30 transition animate-fade-in"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-muted-foreground">{task.id} · {task.project}</span>
        <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize", priorityStyles[task.priority])}>
          {task.priority}
        </span>
      </div>
      <h4 className="mt-2 text-sm font-medium leading-snug text-card-foreground">{task.title}</h4>

      <div className="mt-3 space-y-1.5">
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

      <div className="mt-3 flex items-center justify-between">
        <div className={cn("flex items-center gap-1 text-[11px]", overdue ? "text-destructive" : "text-muted-foreground")}>
          <Calendar className="h-3 w-3" />
          {format(new Date(task.dueDate), "MMM d")}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="flex items-center gap-0.5 text-[10px]"><Paperclip className="h-3 w-3" />2</span>
          <span className="flex items-center gap-0.5 text-[10px]"><MessageSquare className="h-3 w-3" />4</span>
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-card"
            style={{ background: task.assignee.color }}
            title={task.assignee.name}
          >
            {task.assignee.initials}
          </div>
        </div>
      </div>
    </div>
  );
}
