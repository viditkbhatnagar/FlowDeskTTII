/**
 * Group tasks: one task for several people (Sharon's request of 9 Oct 2026,
 * spec section C).
 *
 * A group is a parent task with no assignee and one child per person. Each
 * person moves their own child; the database moves the parent to the least
 * advanced status among its children. This module works out, from the tasks a
 * person can see, which tasks are groups, who is in each, and which cards a
 * board shows.
 *
 * No Supabase imports, so it can be unit-tested with plain data.
 */

export interface GroupAvatar {
  name: string;
  initials: string;
  color: string;
}

export interface GroupableTask {
  id: string;
  title: string;
  parentTaskId?: string | null;
  assigneeId?: string | null;
  assignee: GroupAvatar;
  status: string;
}

/** One person's part of a group, as far as the viewer can see it. */
export interface GroupMember extends GroupAvatar {
  /** Their own (child) task. */
  taskId: string;
  assigneeId: string | null;
  status: string;
}

export interface TaskGroup {
  parentId: string;
  /** The children the viewer can see, by name. */
  members: GroupMember[];
  /** Members whose part is done. */
  done: number;
  total: number;
}

export interface TaskGroupIndex<T extends GroupableTask> {
  /** Group parents among the loaded tasks, by parent id. */
  groups: ReadonlyMap<string, TaskGroup>;
  /** A child's parent, when the viewer can see it, by child id. */
  parentOf: ReadonlyMap<string, T>;
}

/**
 * The groups among `tasks`. A parent is a task with no assignee that loaded
 * tasks point at; a task with no assignee and no visible children is an
 * ordinary unassigned task.
 */
export function indexTaskGroups<T extends GroupableTask>(tasks: readonly T[]): TaskGroupIndex<T> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const parent = byId.get(task.parentTaskId);
    if (!parent || parent.assigneeId) continue;
    children.set(parent.id, [...(children.get(parent.id) ?? []), task]);
  }

  const groups = new Map<string, TaskGroup>();
  const parentOf = new Map<string, T>();
  for (const [parentId, kids] of children) {
    const parent = byId.get(parentId) as T;
    const members = kids
      .map(
        (child): GroupMember => ({
          taskId: child.id,
          assigneeId: child.assigneeId ?? null,
          name: child.assignee.name,
          initials: child.assignee.initials,
          color: child.assignee.color,
          status: child.status,
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.taskId.localeCompare(b.taskId));
    groups.set(parentId, {
      parentId,
      members,
      done: members.filter((member) => member.status === "done").length,
      total: members.length,
    });
    for (const child of kids) parentOf.set(child.id, parent);
  }
  return { groups, parentOf };
}

/**
 * The cards a board or list shows for `list`: a child whose parent is in the
 * same list is folded into the parent's card. A child whose parent is not
 * there (hidden from the viewer, or left out by a filter such as "Dan's
 * tasks") keeps its own card, so nobody's part disappears.
 */
export function foldGroups<T extends GroupableTask>(list: readonly T[]): T[] {
  const ids = new Set(list.map((task) => task.id));
  return list.filter((task) => !task.parentTaskId || !ids.has(task.parentTaskId));
}

/** "3 people · 1 done". */
export function groupSummary(group: Pick<TaskGroup, "done" | "total">): string {
  return `${group.total} ${group.total === 1 ? "person" : "people"} · ${group.done} done`;
}

/** Shown wherever a group's own status would be changed: only the derivation moves it. */
export const GROUP_STATUS_HINT = "Moves when everyone has moved their part";
