import { useId, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TASK_LIMITS } from "@/lib/task-validation";
import { useWorkspace, type WorkspaceTask } from "@/lib/workspace-data";
import { DrawerSection } from "./shared";

/**
 * The task's real subtasks, persisted. The old modal showed the same five
 * invented subtasks on every task (FD-004) and its ticks lived only in local
 * state, so they reverted on reopen and never moved the card's progress (FD-008).
 */
export function TaskSubtasks({
  task,
  onCompleteTask,
  completedLabel,
}: {
  task: WorkspaceTask;
  /** Offered once every subtask is ticked; completing is never automatic. */
  onCompleteTask: () => void;
  completedLabel: string;
}) {
  const { addSubtask, toggleSubtask, removeSubtask } = useWorkspace();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const inputId = useId();
  const done = task.subtasks.filter((item) => item.completed).length;
  const total = task.subtasks.length;
  const tooLong = draft.trim().length > TASK_LIMITS.subtaskMax;

  const add = async () => {
    const title = draft.trim();
    if (!title || tooLong || adding) return;
    setAdding(true);
    const ok = await addSubtask(task.id, title);
    setAdding(false);
    if (ok) setDraft("");
  };

  const run = async (subtaskId: string, action: () => Promise<boolean>) => {
    setPending(subtaskId);
    await action();
    setPending(null);
  };

  return (
    <DrawerSection title="Subtasks" icon={CheckCircle2}>
      <div className="space-y-2">
        {total === 0 && <p className="text-sm text-muted-foreground">No subtasks yet.</p>}
        {task.subtasks.map((subtask) => (
          <div key={subtask.id} className="group flex items-center gap-2 text-sm">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={subtask.completed}
                disabled={pending === subtask.id}
                onChange={() =>
                  void run(subtask.id, () => toggleSubtask(task.id, subtask.id, !subtask.completed))
                }
                className="h-4 w-4 shrink-0 rounded border-border"
              />
              <span
                className={cn(
                  "min-w-0 break-words",
                  subtask.completed && "text-muted-foreground line-through",
                )}
              >
                {subtask.title}
              </span>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`Remove subtask ${subtask.title}`}
              title="Remove subtask"
              disabled={pending === subtask.id}
              onClick={() => void run(subtask.id, () => removeSubtask(task.id, subtask.id))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {done} of {total} complete
            </span>
            {done === total && task.status !== "done" && (
              <button
                type="button"
                onClick={onCompleteTask}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                All done — mark task {completedLabel}
              </button>
            )}
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <label htmlFor={inputId} className="sr-only">
            New subtask
          </label>
          <Input
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds, like the + button. Only the button worked before (FD-027).
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void add();
              }
            }}
            placeholder="Add a subtask"
            aria-invalid={tooLong || undefined}
            // Not disabled while saving: that would drop focus between quick Enter-adds.
            className="h-8 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Add subtask"
            disabled={!draft.trim() || tooLong || adding}
            onClick={() => void add()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {tooLong && (
          <p className="text-xs text-destructive">
            A subtask must be {TASK_LIMITS.subtaskMax} characters or fewer.
          </p>
        )}
      </div>
    </DrawerSection>
  );
}
