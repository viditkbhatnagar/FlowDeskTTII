import { Activity } from "lucide-react";
import { describeActivity, listTaskActivity, type ActivityEntry } from "@/lib/task-api";
import { useTaskSettings } from "@/lib/task-settings-data";
import type { WorkspaceTask } from "@/lib/workspace-data";
import { DrawerSection, SectionState } from "./shared";
import { fullTime, timeAgo, useTaskResource } from "./utils";

/**
 * The task's recorded history, newest first. The old modal showed the same
 * "Priya Shah moved this task to In Progress" on every task and said "Created 3
 * days ago" for a task made minutes earlier (FD-005, FD-033).
 */
export function TaskActivity({ task, refreshKey }: { task: WorkspaceTask; refreshKey: string }) {
  const { statusLabel } = useTaskSettings();
  // Reloaded after any change made here (status, edit, comment, file), so a
  // status change from this panel shows up in its own history (FD-033).
  const activity = useTaskResource(() => listTaskActivity(task.id), `${task.id}:${refreshKey}`);

  // describeActivity names statuses with fixed words; use the configured names
  // so "Review" reads the same here as everywhere else (FD-018).
  const describe = (entry: ActivityEntry) => {
    const to = (entry.details as { to?: unknown }).to;
    if (entry.type === "task_status_changed" && typeof to === "string")
      return `moved this task to ${statusLabel(to)}`;
    if (entry.type === "task_completed") return `marked this task ${statusLabel("done")}`;
    return describeActivity(entry, "task");
  };

  return (
    <DrawerSection title="Activity" icon={Activity}>
      {activity.status === "ready" && activity.data?.length ? (
        <ol className="relative ml-1.5 space-y-3 border-l border-border pl-4">
          {activity.data.map((entry) => (
            <li key={entry.id} className="relative">
              <span className="absolute -left-[1.4rem] top-1 h-2 w-2 rounded-full bg-primary/70 ring-2 ring-card" />
              <p className="break-words text-xs">
                <span className="font-medium">{entry.actor.name}</span>{" "}
                <span className="text-muted-foreground">{describe(entry)}</span>
              </p>
              <time
                dateTime={entry.occurredAt}
                title={fullTime(entry.occurredAt)}
                className="text-[10px] text-muted-foreground"
              >
                {timeAgo(entry.occurredAt)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <SectionState
          status={activity.status}
          empty="No activity recorded yet."
          loadingText="Loading activity…"
          errorText="Activity could not be loaded."
          onRetry={activity.reload}
        />
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Created{" "}
        <time dateTime={task.createdAt} title={fullTime(task.createdAt)}>
          {timeAgo(task.createdAt)}
        </time>{" "}
        · Last updated{" "}
        <time dateTime={task.updatedAt} title={fullTime(task.updatedAt)}>
          {timeAgo(task.updatedAt)}
        </time>
      </p>
    </DrawerSection>
  );
}
