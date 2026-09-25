/**
 * Task field validation, shared by the New Task form and the task edit form.
 *
 * QA FD-016 created tasks with a due date before their start date, estimates of
 * −5 and 99999 hours, duplicate tags and a 280-character title, all accepted
 * without a word, and FD-017 found the Create button disabled with no reason
 * given. These rules match the database trigger in
 * 20260925000000_task_collaboration.sql, so the form refuses exactly what the
 * database would, and says why, inline.
 */

export const TASK_LIMITS = {
  titleMax: 200,
  descriptionMax: 5000,
  estimateMin: 0,
  estimateMax: 1000,
  tagsMax: 20,
  tagMax: 40,
  subtaskMax: 200,
} as const;

export interface TaskFieldInput {
  title: string;
  description?: string;
  /** yyyy-mm-dd or empty */
  startDate?: string;
  /** yyyy-mm-dd or empty */
  dueDate?: string;
  /** Raw form value; empty means "no estimate". */
  estimatedHours?: string | number;
  tags?: string[];
  /** Whether a due date is mandatory in this form. */
  requireDueDate?: boolean;
}

export type TaskFieldErrors = Partial<Record<"title" | "description" | "startDate" | "dueDate" | "estimatedHours" | "tags", string>>;

/** Trim, lowercase, drop empties and duplicates — what the database stores. */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Split a comma-separated tag string into normalized tags. */
export function parseTags(value: string): string[] {
  return normalizeTags(value.split(","));
}

export function validateTaskFields(input: TaskFieldInput): TaskFieldErrors {
  const errors: TaskFieldErrors = {};
  const title = input.title.trim();
  if (!title) errors.title = "Title is required.";
  else if (title.length > TASK_LIMITS.titleMax) errors.title = `Title must be ${TASK_LIMITS.titleMax} characters or fewer (it is ${title.length}).`;

  if ((input.description ?? "").length > TASK_LIMITS.descriptionMax) {
    errors.description = `Description must be ${TASK_LIMITS.descriptionMax} characters or fewer.`;
  }

  if (input.requireDueDate && !input.dueDate) errors.dueDate = "Due date is required.";
  if (input.startDate && input.dueDate && input.dueDate < input.startDate) {
    errors.dueDate = "Due date cannot be before the start date.";
  }

  const rawEstimate = input.estimatedHours;
  if (rawEstimate !== undefined && rawEstimate !== "") {
    const estimate = Number(rawEstimate);
    if (!Number.isFinite(estimate)) errors.estimatedHours = "Estimate must be a number.";
    else if (estimate < TASK_LIMITS.estimateMin || estimate > TASK_LIMITS.estimateMax) {
      errors.estimatedHours = `Estimate must be between ${TASK_LIMITS.estimateMin} and ${TASK_LIMITS.estimateMax} hours.`;
    }
  }

  const tags = normalizeTags(input.tags ?? []);
  if (tags.length > TASK_LIMITS.tagsMax) errors.tags = `Use at most ${TASK_LIMITS.tagsMax} tags.`;
  else if (tags.some((t) => t.length > TASK_LIMITS.tagMax)) errors.tags = `Each tag must be ${TASK_LIMITS.tagMax} characters or fewer.`;

  return errors;
}

export const hasErrors = (errors: TaskFieldErrors): boolean => Object.keys(errors).length > 0;
