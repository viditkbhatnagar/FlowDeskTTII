import type { WorkspaceTask } from "@/lib/workspace-data";

/** Whether deleting this task can also stop its repeat (it repeats, and still makes copies). */
export const repeatsStill = (
  task: Pick<WorkspaceTask, "recurrenceId" | "recurrenceActive"> | undefined,
): boolean => Boolean(task?.recurrenceId && task.recurrenceActive !== false);
