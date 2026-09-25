import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTaskSettings } from "@/lib/task-settings-data";
import { useWorkspace, type WorkspaceTask } from "@/lib/workspace-data";
import { ConfirmDialog } from "./task-detail/ConfirmDialog";
import { TaskEditForm } from "./task-detail/TaskEditForm";
import { TaskOverview } from "./task-detail/TaskOverview";
import { formatDate } from "./task-detail/utils";

export interface TaskDetailDrawerProps {
  task?: WorkspaceTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "sheet" slides in beside lists; "modal" centers over Kanban boards so columns don't reflow. */
  variant?: "sheet" | "modal";
}

type Layout = NonNullable<TaskDetailDrawerProps["variant"]>;

/**
 * The one task detail used everywhere (My Tasks, Team Tasks, Projects). It reads
 * and writes real data; My Tasks used to have its own copy that rendered a
 * generated description, invented subtasks, comments, files and history
 * (FD-003, FD-004, FD-005, FD-007, FD-008).
 */
export function TaskDetailDrawer({
  task,
  open,
  onOpenChange,
  variant = "sheet",
}: TaskDetailDrawerProps) {
  if (!task) return null;
  const close = () => onOpenChange(false);
  // Keyed by task id: switching tasks resets edit mode and drafts, and reloads
  // comments, files and activity for the new task.
  const content = <TaskDetail key={task.id} task={task} layout={variant} onClose={close} />;

  if (variant === "modal") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-modal="true"
          className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0"
        >
          {content}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-modal="true" className="w-full overflow-y-auto sm:max-w-lg">
        {content}
      </SheetContent>
    </Sheet>
  );
}

const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function TaskDetail({
  task,
  layout,
  onClose,
}: {
  task: WorkspaceTask;
  layout: Layout;
  onClose: () => void;
}) {
  const { deleteTask } = useWorkspace();
  const { statusLabel } = useTaskSettings();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Bumped after comments and files change, so the activity list reloads.
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((value) => value + 1);

  const isModal = layout === "modal";
  const Header = isModal ? DialogHeader : SheetHeader;
  const Title = isModal ? DialogTitle : SheetTitle;
  const Description = isModal ? DialogDescription : SheetDescription;

  const remove = async () => {
    const ok = await deleteTask(task.id);
    if (!ok) return false;
    toast.success("Task deleted");
    onClose();
    return true;
  };

  const body = editing ? (
    <TaskEditForm
      task={task}
      onDone={() => {
        setEditing(false);
        bump();
      }}
    />
  ) : (
    <TaskOverview task={task} refreshKey={`${task.updatedAt}:${version}`} onChanged={bump} />
  );

  return (
    <>
      <Header
        className={cn(
          "text-left",
          isModal ? "shrink-0 px-5 pb-0 pt-5 pr-16 sm:px-6 sm:pt-6 sm:pr-16" : "pr-10",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate" title={task.id}>
              {task.id}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate" title={task.project}>
              {task.project}
            </span>
          </div>
          {!editing && (
            <div className="flex shrink-0 items-center gap-1">
              {/* Edit and delete lived nowhere before: only the status could change (FD-006). */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                aria-label="Edit task"
                title="Edit task"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                aria-label="Delete task"
                title="Delete task"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        {/* Clamped to two lines, full title on hover; long titles used to push the layout apart (FD-047). */}
        <Title className="line-clamp-2 break-words text-base" title={task.title}>
          {task.title}
        </Title>
        <Description className={editing ? "text-xs" : "sr-only"}>
          {editing
            ? "Change the details below, then save."
            : `${task.project}. ${statusLabel(task.status)}, due ${formatDate(task.dueDate, "MMM d, yyyy")}.`}
        </Description>
      </Header>
      {isModal ? (
        <div className="min-h-0 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">{body}</div>
      ) : (
        body
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this task?"
        description={`“${shorten(task.title, 80)}” will be removed from every list and board. Its history is kept.`}
        confirmLabel="Delete task"
        onConfirm={remove}
      />
    </>
  );
}
