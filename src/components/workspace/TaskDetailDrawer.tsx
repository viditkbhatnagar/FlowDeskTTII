import { Ban, Calendar, CheckCircle2, Clock, GitBranch, Paperclip, Repeat2 } from "lucide-react";
import { format } from "date-fns";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useWorkspace, type Status, type WorkspaceTask } from "@/lib/workspace-data";

const priorityStyles = {
  low: "bg-priority-low/15 text-priority-low",
  medium: "bg-priority-medium/15 text-priority-medium",
  high: "bg-priority-high/15 text-priority-high",
  critical: "bg-priority-critical/15 text-priority-critical",
};

export function TaskDetailDrawer({
  task,
  open,
  onOpenChange,
  variant = "sheet",
}: {
  task?: WorkspaceTask;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "sheet" slides in beside lists; "modal" centers over Kanban boards so columns don't reflow. */
  variant?: "sheet" | "modal";
}) {
  const { updateTask, tasks } = useWorkspace();
  if (!task) return null;
  const dependencyTasks = tasks.filter((item) => task.dependencies.includes(item.id));
  const completedSubtasks = task.subtasks.filter((item) => item.completed).length;

  const body = (
    <div className="mt-6 space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <Detail label="Assignee" value={task.assignee.name} />
        <Detail label="Due date" value={format(new Date(task.dueDate), "MMM d, yyyy")} />
        <Detail label="Estimate" value={`${task.estimatedHours ?? 0} hours`} />
        <Detail label="Priority" value={task.priority} capitalize />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium">Status</span>
          <span
            className={cn("rounded-md px-2 py-0.5 capitalize", priorityStyles[task.priority])}
          >
            {task.priority}
          </span>
        </div>
        <Select
          value={task.status}
          onValueChange={(value) =>
            updateTask(task.id, {
              status: value as Status,
              progress: value === "done" ? 100 : task.progress,
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todo">To Do</SelectItem>
            <SelectItem value="progress">In Progress</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="done">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-3">
        <div className="flex items-center gap-2">
          <Ban className="h-4 w-4 text-muted-foreground" />
          <div><p className="text-sm font-medium">Blocked</p><p className="text-xs text-muted-foreground">Mark when progress depends on unresolved work.</p></div>
        </div>
        <Switch aria-label="Blocked task" checked={task.blocked} disabled={task.status === "done"} onCheckedChange={(blocked) => updateTask(task.id, { blocked, blockedReason: blocked ? task.blockedReason || "Dependency unresolved" : "" })} />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium">Progress</span>
          <span>{task.progress}%</span>
        </div>
        <Progress value={task.progress} />
      </div>
      <DrawerSection title="Subtasks" icon={CheckCircle2}>
        <div className="space-y-2">
          {task.subtasks.map((subtask) => (
            <label key={subtask.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={subtask.completed}
                onChange={() => {
                  const subtasks = task.subtasks.map((item) =>
                    item.id === subtask.id ? { ...item, completed: !item.completed } : item,
                  );
                  const progress = Math.round(
                    (subtasks.filter((item) => item.completed).length /
                      Math.max(subtasks.length, 1)) *
                      100,
                  );
                  updateTask(task.id, {
                    subtasks,
                    progress,
                    status: progress === 100 ? "done" : task.status,
                  });
                }}
                className="h-4 w-4 rounded border-border"
              />
              <span className={cn(subtask.completed && "text-muted-foreground line-through")}>
                {subtask.title}
              </span>
            </label>
          ))}
          <div className="text-xs text-muted-foreground">
            {completedSubtasks} of {task.subtasks.length} complete
          </div>
        </div>
      </DrawerSection>
      {dependencyTasks.length > 0 && (
        <DrawerSection title="Dependencies" icon={GitBranch}>
          {dependencyTasks.map((item) => (
            <div key={item.id} className="rounded-md border border-border px-3 py-2 text-sm">
              {item.title}
            </div>
          ))}
        </DrawerSection>
      )}
      <DrawerSection title="Attachments" icon={Paperclip}>
        {task.attachments.length ? (
          task.attachments.map((file) => (
            <div key={file} className="rounded-md border border-border px-3 py-2 text-sm">
              {file}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No attachments.</p>
        )}
      </DrawerSection>
      <DrawerSection title="Schedule" icon={Calendar}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          {format(new Date(task.startDate), "MMM d")} –{" "}
          {format(new Date(task.dueDate), "MMM d, yyyy")}
        </div>
      </DrawerSection>
      {task.recurrenceSummary && (
        <DrawerSection title="Recurring task" icon={Repeat2}>
          <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            {task.recurrenceSummary}
          </p>
        </DrawerSection>
      )}
    </div>
  );

  if (variant === "modal") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-5 pb-0 pt-5 pr-16 text-left sm:px-6 sm:pt-6 sm:pr-16">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{task.id}</span>
              <span>·</span>
              <span>{task.project}</span>
            </div>
            <DialogTitle className="text-base">{task.title}</DialogTitle>
            <DialogDescription>{task.description}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">
            {body}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-8 text-left">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{task.id}</span>
            <span>·</span>
            <span>{task.project}</span>
          </div>
          <SheetTitle className="text-base">{task.title}</SheetTitle>
          <SheetDescription>{task.description}</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}

function Detail({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate text-sm font-medium", capitalize && "capitalize")}>
        {value}
      </div>
    </div>
  );
}
function DrawerSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </div>
      {children}
    </section>
  );
}
