import { useState } from "react";
import type { Status } from "@/lib/mock-data";
import { useWorkspace } from "@/lib/workspace-data";
import { TaskCard } from "./TaskCard";
import { Plus } from "lucide-react";

const columns: { id: Status; label: string; dot: string }[] = [
  { id: "todo", label: "To Do", dot: "bg-status-todo" },
  { id: "progress", label: "In Progress", dot: "bg-status-progress" },
  { id: "review", label: "Review", dot: "bg-status-review" },
  { id: "done", label: "Completed", dot: "bg-status-done" },
];

export function KanbanBoard() {
  const { tasks: items, updateTask } = useWorkspace();
  const [dragId, setDragId] = useState<string | null>(null);

  const drop = (status: Status) => {
    if (!dragId) return;
    updateTask(dragId, {
      status,
      progress: status === "done" ? 100 : items.find((task) => task.id === dragId)?.progress,
    });
    setDragId(null);
  };

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
      {columns.map((col) => {
        const colTasks = items.filter((t) => t.status === col.id);
        return (
          <div
            key={col.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(col.id)}
            className="rounded-xl border border-border bg-secondary/40 p-3 flex flex-col min-h-[300px]"
          >
            <div className="flex items-center justify-between px-1 pb-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                  {col.label}
                </span>
                <span className="rounded-md bg-card border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {colTasks.length}
                </span>
              </div>
              <button className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex flex-col gap-2 flex-1">
              {colTasks.map((task) => (
                <TaskCard key={task.id} task={task} onDragStart={() => setDragId(task.id)} />
              ))}
              {colTasks.length === 0 && (
                <div className="flex-1 rounded-lg border border-dashed border-border/70 flex items-center justify-center text-[11px] text-muted-foreground py-8">
                  Drop tasks here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
