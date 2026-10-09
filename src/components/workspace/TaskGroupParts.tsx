import { Lock, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskSettings } from "@/lib/task-settings-data";
import { GROUP_STATUS_HINT, groupSummary, type TaskGroup } from "@/lib/task-groups";

/**
 * Pieces every board and list uses to show a group task (spec of 9 Oct 2026,
 * section E): who is in it and where each person is, the "Part of" line on a
 * person's own part, and a status that cannot be changed from here.
 */

const statusDot: Record<string, string> = {
  todo: "bg-status-todo",
  progress: "bg-status-progress",
  review: "bg-status-review",
  done: "bg-status-done",
};

/** How many people a card lists before "+N more". */
const CARD_MEMBER_LIMIT = 4;

/** "3 people · 1 done" and each visible person with their own status. */
export function GroupMembersStrip({
  group,
  orgId,
  limit = CARD_MEMBER_LIMIT,
  className,
}: {
  group: TaskGroup;
  /** The task's organization: statuses read in its words. */
  orgId?: string | null;
  limit?: number;
  className?: string;
}) {
  const { statusLabelFor } = useTaskSettings();
  const shown = group.members.slice(0, limit);
  const hidden = group.members.length - shown.length;
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <Users className="h-3 w-3" aria-hidden="true" />
        {groupSummary(group)}
      </div>
      <ul className="space-y-0.5" aria-label="People in this task">
        {shown.map((member) => (
          <li key={member.taskId} className="flex min-w-0 items-center gap-1.5 text-[10px]">
            <span
              aria-hidden="true"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-semibold text-white"
              style={{ background: member.color }}
            >
              {member.initials}
            </span>
            <span className="min-w-0 flex-1 truncate" title={member.name}>
              {member.name}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  statusDot[member.status] ?? "bg-muted-foreground",
                )}
              />
              {statusLabelFor(member.status, orgId)}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="text-[10px] text-muted-foreground">+{hidden} more</p>}
    </div>
  );
}

/** Overlapping avatars for tight rows (tables), with the summary beside them. */
export function GroupAvatars({ group, className }: { group: TaskGroup; className?: string }) {
  const shown = group.members.slice(0, CARD_MEMBER_LIMIT);
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <div className="flex shrink-0 -space-x-1.5" aria-hidden="true">
        {shown.map((member) => (
          <span
            key={member.taskId}
            title={member.name}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-card"
            style={{ background: member.color }}
          >
            {member.initials}
          </span>
        ))}
      </div>
      <span
        className="truncate text-xs text-muted-foreground"
        title={group.members.map((m) => m.name).join(", ")}
      >
        {groupSummary(group)}
      </span>
    </div>
  );
}

/** On one person's part: the group it belongs to, opening it when it is visible. */
export function PartOfGroup({
  title,
  onOpen,
  className,
}: {
  /** The group's title, or undefined when the viewer cannot see the group. */
  title?: string;
  onOpen?: () => void;
  className?: string;
}) {
  const base = "flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground";
  if (!title) {
    return (
      <p className={cn(base, className)}>
        <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
        Part of a group task
      </p>
    );
  }
  const label = (
    <>
      <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="shrink-0">Part of:</span>
      <span className="min-w-0 truncate font-medium text-foreground/80">{title}</span>
    </>
  );
  if (!onOpen) {
    return (
      <p className={cn(base, className)} title={`Part of: ${title}`}>
        {label}
      </p>
    );
  }
  return (
    <button
      type="button"
      title={`Open the group task: ${title}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className={cn(
        base,
        "max-w-full rounded-sm text-left hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {label}
    </button>
  );
}

/** A status that cannot be changed here, in place of a picker, with the reason on hover. */
export function ReadOnlyStatus({
  label,
  hint = GROUP_STATUS_HINT,
  className,
}: {
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <span
      title={hint}
      aria-label={`Status: ${label}. ${hint}.`}
      className={cn(
        "inline-flex h-6 max-w-[8rem] shrink-0 items-center gap-1 rounded border border-dashed border-border bg-muted/40 px-1.5 text-[10px] text-muted-foreground",
        className,
      )}
    >
      <Lock className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}
