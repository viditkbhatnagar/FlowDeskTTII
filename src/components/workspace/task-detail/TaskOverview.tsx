import { useId } from "react";
import { AlignLeft, Ban, Calendar, Clock, GitBranch, Repeat2, Tag, Users } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  useTaskSettings,
  type TaskStatusConfig,
  type TaskStatusType,
} from "@/lib/task-settings-data";
import { useWorkspace, type Status, type WorkspaceTask } from "@/lib/workspace-data";
import { GROUP_STATUS_HINT, groupSummary, type TaskGroup } from "@/lib/task-groups";
import { READ_ONLY_HINT, type TaskPermissions } from "@/lib/task-permissions";
import { PartOfGroup } from "../TaskGroupParts";
import { LinkifiedText } from "./LinkifiedText";
import { TaskActivity } from "./TaskActivity";
import { TaskAttachments } from "./TaskAttachments";
import { TaskComments } from "./TaskComments";
import { TaskSubtasks } from "./TaskSubtasks";
import { Detail, DrawerSection } from "./shared";
import { formatDate } from "./utils";

const priorityStyles = {
  low: "bg-priority-low/15 text-priority-low",
  medium: "bg-priority-medium/15 text-priority-medium",
  high: "bg-priority-high/15 text-priority-high",
  critical: "bg-priority-critical/15 text-priority-critical",
};

const STATUS_FOR_TYPE: Partial<Record<TaskStatusType, Status>> = {
  open: "todo",
  "in-progress": "progress",
  review: "review",
  completed: "done",
};
const ALL_STATUSES: Status[] = ["todo", "progress", "review", "done"];

/**
 * The statuses an admin has left active, in their configured order. The task's
 * own status is always offered so it never disappears from its own buttons.
 */
function statusOptions(active: TaskStatusConfig[], current: Status): Status[] {
  const configured = active
    .map((item) => STATUS_FOR_TYPE[item.type])
    .filter((value): value is Status => Boolean(value));
  const list = configured.length ? [...new Set(configured)] : ALL_STATUSES;
  return list.includes(current) ? list : [...list, current];
}

const hoursLabel = (hours: number) => `${hours} ${hours === 1 ? "hour" : "hours"}`;

function scheduleLabel(task: WorkspaceTask): string {
  const due = formatDate(task.dueDate, "MMM d, yyyy");
  if (!task.hasStartDate || !task.startDate) return `Due ${due} · no start date`;
  const sameYear = task.startDate.slice(0, 4) === task.dueDate.slice(0, 4);
  return `${formatDate(task.startDate, sameYear ? "MMM d" : "MMM d, yyyy")} – ${due}`;
}

/** Everything about one task, read from and written to the database. */
export function TaskOverview({
  task,
  permissions,
  refreshKey,
  onChanged,
  onOpenTask,
}: {
  task: WorkspaceTask;
  /** What the signed-in user may change here (spec B); the rest is read-only. */
  permissions: TaskPermissions;
  /** Changes whenever something here was saved, so the activity list reloads. */
  refreshKey: string;
  onChanged: () => void;
  /** Opens a person's part, or the group a part belongs to. */
  onOpenTask?: (id: string) => void;
}) {
  const { updateTask, tasks, groups } = useWorkspace();
  const group = groups.groups.get(task.id);
  const parent = groups.parentOf.get(task.id);
  const { statusesFor, statusLabelFor, priorities } = useTaskSettings();
  // The task's own organization's statuses and names, not the one the settings
  // page shows: a task in another organization offered that one's statuses.
  const statusLabel = (value: string) => statusLabelFor(value, task.organizationId);
  const dependencyTasks = tasks.filter((item) => task.dependencies.includes(item.id));
  const priorityName = priorities.find((item) => item.id === task.priority)?.name ?? task.priority;
  const statuses = statusOptions(
    statusesFor(task.organizationId).filter((item) => item.status === "active"),
    task.status,
  );
  const description = task.description?.trim();
  const statusHeadingId = useId();

  const statusHint = group ? GROUP_STATUS_HINT : permissions.canMove ? undefined : READ_ONLY_HINT;

  const setStatus = (status: Status) => {
    if (status === task.status || !permissions.canMove) return;
    // Progress is derived from subtasks by the database, so it is only sent for
    // a task without any. Reopening a finished task starts it again at 0 rather
    // than keeping 100% (FD-025).
    const updates: Partial<WorkspaceTask> = { status };
    if (!task.subtasks.length)
      updates.progress = status === "done" ? 100 : task.status === "done" ? 0 : task.progress;
    void updateTask(task.id, updates);
  };

  return (
    <div className="mt-6 space-y-6">
      {task.parentTaskId && (
        // One person's part of a group task links back to the group (spec E).
        <PartOfGroup
          title={parent?.title}
          onOpen={parent && onOpenTask ? () => onOpenTask(parent.id) : undefined}
          className="-mt-3 text-xs"
        />
      )}
      <DrawerSection title="Description" icon={AlignLeft}>
        {/* The saved description. The old modal generated one from the title (FD-003). */}
        {description ? (
          <LinkifiedText
            text={description}
            className="text-sm leading-relaxed text-foreground/90"
          />
        ) : (
          <p className="text-sm text-muted-foreground">No description.</p>
        )}
      </DrawerSection>
      <div className="grid grid-cols-2 gap-3">
        <Detail
          label={group ? "People" : "Assignee"}
          value={group ? groupSummary(group) : task.assignee.name}
        />
        <Detail label="Due date" value={formatDate(task.dueDate, "MMM d, yyyy")} />
        <Detail label="Estimate" value={hoursLabel(task.estimatedHours ?? 0)} />
        <Detail label="Priority" value={priorityName} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Tags:</span>
        {task.tags?.length ? (
          task.tags.map((tag) => (
            <span
              key={tag}
              className="max-w-full truncate rounded-md bg-muted px-2 py-0.5 text-xs"
              title={tag}
            >
              {tag}
            </span>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No tags</span>
        )}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium" id={statusHeadingId}>
            Status
            {group && (
              <span className="font-normal text-muted-foreground"> · the least advanced part</span>
            )}
          </span>
          <span className={cn("rounded-md px-2 py-0.5", priorityStyles[task.priority])}>
            {priorityName}
          </span>
        </div>
        {/* Names come from Settings › Task Status, never hardcoded (FD-018). */}
        <div
          role="group"
          aria-labelledby={statusHeadingId}
          aria-describedby={statusHint ? `${statusHeadingId}-hint` : undefined}
          className="flex flex-wrap gap-1.5"
        >
          {statuses.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={task.status === value}
              disabled={Boolean(statusHint)}
              title={statusHint}
              onClick={() => setStatus(value)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed",
                task.status === value
                  ? "border-primary bg-primary text-primary-foreground disabled:opacity-80"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
              )}
            >
              {statusLabel(value)}
            </button>
          ))}
        </div>
        {statusHint && (
          <p id={`${statusHeadingId}-hint`} className="mt-1.5 text-[11px] text-muted-foreground">
            {statusHint}.
          </p>
        )}
      </div>
      {group && <GroupPeople group={group} statusLabel={statusLabel} onOpenTask={onOpenTask} />}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Ban className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Blocked</p>
            <p className="break-words text-xs text-muted-foreground">
              {task.blocked && task.blockedReason
                ? task.blockedReason
                : "Mark when progress depends on unresolved work."}
            </p>
          </div>
        </div>
        <Switch
          aria-label="Blocked task"
          checked={task.blocked}
          disabled={task.status === "done" || !permissions.canEdit}
          onCheckedChange={(blocked) =>
            void updateTask(task.id, {
              blocked,
              blockedReason: blocked ? task.blockedReason || "Dependency unresolved" : "",
            })
          }
        />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium">Progress</span>
          <span>{task.progress}%</span>
        </div>
        <Progress value={task.progress} aria-label={`Progress ${task.progress}%`} />
      </div>
      {/* Someone else in the group sees this part, not what is inside it. */}
      {!permissions.canCollaborate && (
        <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          This is {task.assignee.name}&apos;s part of a group task. Its subtasks, files and comments
          are for them and their managers. Talk about the work on the group task itself.
        </p>
      )}
      {/* A group's progress comes from its people, so it takes no subtasks of its own. */}
      {permissions.canCollaborate && (!group || task.subtasks.length > 0) && (
        <TaskSubtasks
          task={task}
          readOnly={!permissions.canEditSubtasks}
          onCompleteTask={() => setStatus("done")}
          completedLabel={statusLabel("done")}
          canComplete={permissions.canMove}
        />
      )}
      {dependencyTasks.length > 0 && (
        <DrawerSection title="Dependencies" icon={GitBranch}>
          <div className="space-y-2">
            {dependencyTasks.map((item) => (
              <div
                key={item.id}
                className="truncate rounded-md border border-border px-3 py-2 text-sm"
                title={item.title}
              >
                {item.title}
              </div>
            ))}
          </div>
        </DrawerSection>
      )}
      {permissions.canCollaborate && (
        <TaskAttachments
          task={task}
          onChanged={onChanged}
          canManageFiles={permissions.canManageFiles}
        />
      )}
      <DrawerSection title="Schedule" icon={Calendar}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" />
          {scheduleLabel(task)}
        </div>
      </DrawerSection>
      {task.recurrenceSummary && (
        <DrawerSection title="Recurring task" icon={Repeat2}>
          <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            {task.recurrenceSummary}
          </p>
        </DrawerSection>
      )}
      {permissions.canCollaborate && (
        <>
          <TaskComments task={task} onChanged={onChanged} />
          <TaskActivity task={task} refreshKey={refreshKey} />
        </>
      )}
    </div>
  );
}

/**
 * A group task's people (spec E): each one the viewer can see, with their own
 * status, and a way into their part.
 */
function GroupPeople({
  group,
  statusLabel,
  onOpenTask,
}: {
  group: TaskGroup;
  statusLabel: (value: string) => string;
  onOpenTask?: (id: string) => void;
}) {
  return (
    <DrawerSection title={`People · ${groupSummary(group)}`} icon={Users}>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {group.members.map((member) => (
          <li key={member.taskId} className="flex items-center gap-3 px-3 py-2">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: member.color }}
            >
              {member.initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" title={member.name}>
                {member.name}
              </span>
              <span className="block text-xs text-muted-foreground">
                {statusLabel(member.status)}
              </span>
            </span>
            {onOpenTask && (
              <button
                type="button"
                onClick={() => onOpenTask(member.taskId)}
                aria-label={`Open ${member.name}'s part`}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open their part
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Everyone moves their own part. Only the people you can see are listed.
      </p>
    </DrawerSection>
  );
}
