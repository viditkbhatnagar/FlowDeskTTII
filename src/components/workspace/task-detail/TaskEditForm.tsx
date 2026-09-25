import { useId, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTaskSettings } from "@/lib/task-settings-data";
import {
  hasErrors,
  parseTags,
  TASK_LIMITS,
  validateTaskFields,
  type TaskFieldErrors,
} from "@/lib/task-validation";
import { useWorkspace, type Priority, type WorkspaceTask } from "@/lib/workspace-data";

// Radix Select cannot use "" as an item value.
const UNASSIGNED = "__unassigned__";

interface Draft {
  title: string;
  description: string;
  assigneeId: string;
  priority: Priority;
  startDate: string;
  dueDate: string;
  estimatedHours: string;
  tags: string;
}

function draftFrom(task: WorkspaceTask): Draft {
  return {
    title: task.title,
    description: task.description ?? "",
    assigneeId: task.assigneeId ?? UNASSIGNED,
    priority: task.priority,
    startDate: task.hasStartDate ? task.startDate.slice(0, 10) : "",
    dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
    estimatedHours: String(task.estimatedHours ?? 0),
    tags: (task.tags ?? []).join(", "),
  };
}

function validate(draft: Draft): TaskFieldErrors {
  return validateTaskFields({
    title: draft.title,
    description: draft.description,
    startDate: draft.startDate,
    dueDate: draft.dueDate,
    estimatedHours: draft.estimatedHours,
    tags: parseTags(draft.tags),
    requireDueDate: true,
  });
}

/** Only the fields that actually changed, so an unchanged save logs no activity. */
function changesFrom(task: WorkspaceTask, draft: Draft): Partial<WorkspaceTask> {
  const initial = draftFrom(task);
  const updates: Partial<WorkspaceTask> = {};
  const title = draft.title.trim();
  if (title !== task.title) updates.title = title;
  const description = draft.description.trim();
  if (description !== (task.description ?? "").trim()) updates.description = description;
  if (draft.assigneeId !== initial.assigneeId) {
    updates.assigneeId = draft.assigneeId === UNASSIGNED ? null : draft.assigneeId;
  }
  if (draft.priority !== task.priority) updates.priority = draft.priority;
  if (draft.startDate !== initial.startDate) {
    updates.startDate = draft.startDate ? `${draft.startDate}T00:00:00` : "";
    updates.hasStartDate = Boolean(draft.startDate);
  }
  if (draft.dueDate !== initial.dueDate) updates.dueDate = `${draft.dueDate}T23:59:59`;
  const estimate = draft.estimatedHours.trim() === "" ? 0 : Number(draft.estimatedHours);
  if (estimate !== (task.estimatedHours ?? 0)) updates.estimatedHours = estimate;
  const tags = parseTags(draft.tags);
  if (tags.join(",") !== (task.tags ?? []).join(",")) updates.tags = tags;
  return updates;
}

/**
 * Edit a task's details in place. Before this there was no way to change a
 * task's title, description, dates, assignee, priority or estimate after
 * creating it — only its status (FD-006). Rules are the shared ones the New
 * Task form and the database use (FD-016), with the reason shown inline.
 */
export function TaskEditForm({ task, onDone }: { task: WorkspaceTask; onDone: () => void }) {
  const { updateTask, people } = useWorkspace();
  const { priorities, activeTags } = useTaskSettings();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(task));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const ids = {
    title: useId(),
    description: useId(),
    assignee: useId(),
    priority: useId(),
    startDate: useId(),
    dueDate: useId(),
    estimate: useId(),
    tags: useId(),
    tagOptions: useId(),
  };
  // Errors appear after the first save attempt, then update as the user fixes them.
  const errors = useMemo(() => (submitted ? validate(draft) : {}), [draft, submitted]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  // The current assignee stays selectable even if their profile is not visible.
  const assigneeOptions = useMemo(() => {
    const list = people.map((person) => ({ id: person.id, name: person.name }));
    if (task.assigneeId && !list.some((person) => person.id === task.assigneeId)) {
      list.unshift({ id: task.assigneeId, name: task.assignee.name });
    }
    return list;
  }, [people, task.assigneeId, task.assignee.name]);

  const save = async () => {
    setSubmitted(true);
    if (hasErrors(validate(draft))) return;
    const updates = changesFrom(task, draft);
    if (!Object.keys(updates).length) {
      onDone();
      return;
    }
    setSaving(true);
    const ok = await updateTask(task.id, updates);
    setSaving(false);
    // On failure updateTask has already reverted and said why; keep the form open.
    if (!ok) return;
    toast.success("Task updated");
    onDone();
  };

  return (
    <form
      className="mt-6 space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Field id={ids.title} label="Title*" error={errors.title}>
        <Input
          id={ids.title}
          autoFocus
          value={draft.title}
          onChange={(event) => set("title", event.target.value)}
          aria-invalid={Boolean(errors.title) || undefined}
          aria-describedby={errors.title ? `${ids.title}-error` : undefined}
        />
        <p
          className={cn(
            "text-right text-[11px]",
            draft.title.trim().length > TASK_LIMITS.titleMax
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {draft.title.trim().length}/{TASK_LIMITS.titleMax}
        </p>
      </Field>
      <Field id={ids.description} label="Description" error={errors.description}>
        <Textarea
          id={ids.description}
          rows={5}
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
          placeholder="Add context, links, and acceptance criteria..."
          aria-invalid={Boolean(errors.description) || undefined}
          aria-describedby={errors.description ? `${ids.description}-error` : undefined}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={ids.assignee} label="Assignee">
          <Select value={draft.assigneeId} onValueChange={(value) => set("assigneeId", value)}>
            <SelectTrigger id={ids.assignee}>
              <SelectValue placeholder="Choose a person" />
            </SelectTrigger>
            <SelectContent>
              {/* Offered only when the task has no assignee already, so an edit cannot orphan a task. */}
              {!task.assigneeId && <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>}
              {assigneeOptions.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id={ids.priority} label="Priority">
          <Select
            value={draft.priority}
            onValueChange={(value) => set("priority", value as Priority)}
          >
            <SelectTrigger id={ids.priority}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorities.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id={ids.startDate} label="Start date" error={errors.startDate}>
          <Input
            id={ids.startDate}
            type="date"
            value={draft.startDate}
            max={draft.dueDate || undefined}
            onChange={(event) => set("startDate", event.target.value)}
            aria-invalid={Boolean(errors.startDate) || undefined}
            aria-describedby={errors.startDate ? `${ids.startDate}-error` : undefined}
          />
        </Field>
        <Field id={ids.dueDate} label="Due date*" error={errors.dueDate}>
          <Input
            id={ids.dueDate}
            type="date"
            value={draft.dueDate}
            min={draft.startDate || undefined}
            onChange={(event) => set("dueDate", event.target.value)}
            aria-invalid={Boolean(errors.dueDate) || undefined}
            aria-describedby={errors.dueDate ? `${ids.dueDate}-error` : undefined}
          />
        </Field>
        <Field id={ids.estimate} label="Estimated hours" error={errors.estimatedHours}>
          <Input
            id={ids.estimate}
            type="number"
            inputMode="decimal"
            min={TASK_LIMITS.estimateMin}
            max={TASK_LIMITS.estimateMax}
            step="0.5"
            value={draft.estimatedHours}
            onChange={(event) => set("estimatedHours", event.target.value)}
            aria-invalid={Boolean(errors.estimatedHours) || undefined}
            aria-describedby={errors.estimatedHours ? `${ids.estimate}-error` : undefined}
          />
        </Field>
        <Field id={ids.tags} label="Tags" error={errors.tags}>
          <Input
            id={ids.tags}
            value={draft.tags}
            onChange={(event) => set("tags", event.target.value)}
            placeholder="design, urgent"
            list={ids.tagOptions}
            aria-invalid={Boolean(errors.tags) || undefined}
            aria-describedby={errors.tags ? `${ids.tags}-error` : `${ids.tags}-hint`}
          />
          <datalist id={ids.tagOptions}>
            {activeTags.map((tag) => (
              <option key={tag.id} value={tag.name} />
            ))}
          </datalist>
          {!errors.tags && (
            <p id={`${ids.tags}-hint`} className="text-[11px] text-muted-foreground">
              Separate tags with commas.
            </p>
          )}
        </Field>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
      {submitted && hasErrors(errors) && (
        <p className="text-right text-xs text-destructive" role="alert">
          Fix the highlighted fields to save.
        </p>
      )}
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
