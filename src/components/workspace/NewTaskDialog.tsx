import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { CalendarIcon, Paperclip, Plus, Repeat2, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, type Priority, type Status, type WorkspaceTask } from "@/lib/workspace-data";
import { useOrganizations } from "@/lib/organizations-data";
import { useTaskSettings, type TagConfig, type TaskStatusType } from "@/lib/task-settings-data";
import { FILE_RULES, formatBytes, personRef, validateFile, type PersonRef } from "@/lib/task-api";
import { TASK_LIMITS, normalizeTags, parseTags, validateTaskFields } from "@/lib/task-validation";
import { cn } from "@/lib/utils";
import { recurrenceSummary, type RecurrenceCreationMode, type RecurrenceEndMode, type RecurrenceFrequency, type RecurrenceRule } from "@/lib/recurrence";


/** Dependencies have no table yet; see the note where the section is rendered. */
const SHOW_DEPENDENCIES = false;
const weekdays = [
  { value: 1, label: "M" }, { value: 2, label: "T" }, { value: 3, label: "W" },
  { value: 4, label: "T" }, { value: 5, label: "F" }, { value: 6, label: "S" }, { value: 0, label: "S" },
];
const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const frequencyOptions: { value: RecurrenceFrequency; label: string }[] = [
  { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" },
];
const endModeOptions: { value: RecurrenceEndMode; label: string }[] = [
  { value: "never", label: "Never" }, { value: "on_date", label: "On a date" }, { value: "after_count", label: "After occurrences" },
];

const NO_PROJECT = "__none__";

// Statuses loaded from the database carry no `key`, so the old
// `.filter((option) => option.key)` could leave the Status menu empty. Map by type.
const statusForType: Partial<Record<TaskStatusType, Status>> = { open: "todo", "in-progress": "progress", review: "review", completed: "done" };
const builtInStatuses: Status[] = ["todo", "progress", "review", "done"];

/** Mirrors the task_recurrences CHECK constraints (interval 1–365, occurrences 2–1000). */
const RECURRENCE_LIMITS = { intervalMin: 1, intervalMax: 365, occurrencesMin: 2, occurrencesMax: 1000 } as const;

interface RecurrenceDraft {
  frequency: RecurrenceFrequency;
  interval: string;
  weekdays: number[];
  monthlyPattern: RecurrenceRule["monthlyPattern"];
  creationMode: RecurrenceCreationMode;
  endMode: RecurrenceEndMode;
  endDate: string;
  occurrences: string;
}

type RecurrenceErrors = Partial<Record<"interval" | "weekdays" | "endDate" | "occurrences", string>>;

interface ProjectOption {
  key: string;
  id?: string;
  name: string;
  /** The project's organization: the task is filed there, so its tags come from there. */
  orgId?: string;
}

const newRecurrenceDraft = (): RecurrenceDraft => ({
  frequency: "weekly", interval: "1", weekdays: [new Date().getDay()], monthlyPattern: "day_of_month",
  creationMode: "after_completion", endMode: "never", endDate: "", occurrences: "10",
});

const isWholeNumberBetween = (value: string, min: number, max: number) =>
  /^\d+$/.test(value.trim()) && Number(value) >= min && Number(value) <= max;

function validateRecurrence(draft: RecurrenceDraft, dueDate: string): RecurrenceErrors {
  const errors: RecurrenceErrors = {};
  // Was clamped silently with Math.max(1, …), so "every −3 weeks" read as
  // "every week" while the database refused the rule (FD-064).
  if (!isWholeNumberBetween(draft.interval, RECURRENCE_LIMITS.intervalMin, RECURRENCE_LIMITS.intervalMax)) {
    errors.interval = `Repeat every must be a whole number from ${RECURRENCE_LIMITS.intervalMin} to ${RECURRENCE_LIMITS.intervalMax}.`;
  }
  if (draft.frequency === "weekly" && draft.weekdays.length === 0) errors.weekdays = "Choose at least one day.";
  if (draft.endMode === "on_date") {
    if (!draft.endDate) errors.endDate = "Choose the date the repeat ends.";
    else if (dueDate && draft.endDate <= dueDate) errors.endDate = "End date must be after the first due date.";
  }
  if (
    draft.endMode === "after_count" &&
    !isWholeNumberBetween(draft.occurrences, RECURRENCE_LIMITS.occurrencesMin, RECURRENCE_LIMITS.occurrencesMax)
  ) {
    errors.occurrences = `Occurrences must be a whole number from ${RECURRENCE_LIMITS.occurrencesMin} to ${RECURRENCE_LIMITS.occurrencesMax}.`;
  }
  return errors;
}

const toRecurrenceRule = (draft: RecurrenceDraft): RecurrenceRule => ({
  frequency: draft.frequency,
  interval: Number(draft.interval),
  weekdays: draft.weekdays,
  monthlyPattern: draft.monthlyPattern,
  creationMode: draft.creationMode,
  endMode: draft.endMode,
  endDate: draft.endMode === "on_date" ? draft.endDate : undefined,
  maxOccurrences: draft.endMode === "after_count" ? Number(draft.occurrences) : undefined,
});

const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

/** aria-invalid / aria-describedby for a control whose error renders as `${id}-error`. */
const describedBy = (id: string, error?: string) => ({
  "aria-invalid": Boolean(error),
  "aria-describedby": error ? `${id}-error` : undefined,
});

/** The signed-in user, so the assignee defaults to them rather than a demo person (FD-001). */
function useSignedInUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setUserId(data.session?.user.id ?? null);
    });
    return () => { active = false; };
  }, []);
  return userId;
}

/**
 * Real projects: every live work_projects row plus any project a loaded task
 * belongs to. The picker listed five hardcoded demo projects before (FD-001).
 */
function useProjectOptions(tasks: WorkspaceTask[], projectName?: string): ProjectOption[] {
  const [loaded, setLoaded] = useState<{ id: string; name: string; organization_id: string }[]>([]);
  useEffect(() => {
    let active = true;
    void supabase.from("work_projects").select("id, name, organization_id").is("archived_at", null)
      .not("status", "in", "(cancelled,archived)").order("name")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.error("[flowdesk] failed to load projects for the task form", error);
        else setLoaded(data ?? []);
      });
    return () => { active = false; };
  }, []);

  return useMemo(() => {
    const byKey = new Map<string, ProjectOption>();
    for (const project of loaded) {
      byKey.set(project.id, {
        key: project.id,
        id: project.id,
        name: project.name,
        orgId: project.organization_id,
      });
    }
    for (const task of tasks) {
      if (task.projectId && !byKey.has(task.projectId)) {
        byKey.set(task.projectId, {
          key: task.projectId,
          id: task.projectId,
          name: task.project,
          orgId: task.organizationId,
        });
      }
    }
    const list = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (projectName && !list.some((option) => option.name === projectName)) {
      list.push({ key: `name:${projectName}`, name: projectName });
    }
    return list;
  }, [loaded, tasks, projectName]);
}

interface NewTaskDialogProps {
  open: boolean;
  onClose: () => void;
  projectName?: string;
  /** Preferred over projectName when known: project names are not unique across organizations. */
  projectId?: string;
}

export function NewTaskDialog({ open, onClose, projectName, projectId }: NewTaskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent aria-modal="true" className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        {/* The form mounts with the dialog content, so every open starts clean. Its
            state lived here and survived between opens, so Quick Add and Add Team
            Task reopened with the last task's dates, estimate and tags (FD-026). */}
        <NewTaskForm onClose={onClose} projectName={projectName} projectId={projectId} />
      </DialogContent>
    </Dialog>
  );
}

function NewTaskForm({ onClose, projectName, projectId }: Omit<NewTaskDialogProps, "open">) {
  const uid = useId();
  const fieldId = (name: string) => `${uid}-${name}`;
  const { addTask, tasks, people } = useWorkspace();
  const { priorities: priorityOptions, tagsFor, statusesFor, statusLabelFor } = useTaskSettings();
  const { currentUser, accessibleOrganizations } = useOrganizations();
  const signedInUserId = useSignedInUserId();
  const projectOptions = useProjectOptions(tasks, projectName);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectKey, setProjectKey] = useState(NO_PROJECT);
  const [assigneeId, setAssigneeId] = useState("");
  const [statusChoice, setStatusChoice] = useState<Status | null>(null);
  const [priority, setPriority] = useState<Priority>("medium");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  // Empty means "no estimate". A default of 4 put an invented estimate on every task.
  const [estimatedHours, setEstimatedHours] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [recurring, setRecurring] = useState(false);
  const [recurrenceDraft, setRecurrenceDraft] = useState<RecurrenceDraft>(newRecurrenceDraft);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const touch = (field: string) =>
    setTouched((current) => (current.has(field) ? current : new Set([...current, field])));

  // Opened from a project page: that project is fixed.
  const fixedProject =
    (projectId ? projectOptions.find((option) => option.id === projectId) : undefined) ??
    (projectName ? projectOptions.find((option) => option.name === projectName) : undefined);
  const selectedProjectKey = fixedProject?.key ?? projectKey;
  const selectedProject = projectOptions.find((option) => option.key === selectedProjectKey);

  // The organization the task will be filed in, as addTask decides it: its
  // project's, else the creator's primary. Only that organization's tags are
  // offered; with every organization's, someone in two saw each tag twice.
  const primaryOrgId =
    currentUser?.primaryOrgId && accessibleOrganizations.some((o) => o.id === currentUser.primaryOrgId)
      ? currentUser.primaryOrgId
      : accessibleOrganizations[0]?.id;
  const taskOrgId = (selectedProject?.id ? selectedProject.orgId : undefined) ?? primaryOrgId;
  const tagOptions = tagsFor(taskOrgId);

  // Real users. This listed five demo people and defaulted to one of them, and the
  // pick was then ignored: every task was saved against its creator (FD-001).
  const assigneeOptions = useMemo<PersonRef[]>(() => {
    if (!signedInUserId || people.some((person) => person.id === signedInUserId)) return people;
    return [personRef(signedInUserId, "Me"), ...people];
  }, [people, signedInUserId]);
  const effectiveAssigneeId = assigneeId || signedInUserId || "";

  // Names come from Settings, never hardcoded (FD-018): the statuses, names and
  // default of the organization the task is filed in, not the settings page's.
  const orgStatuses = useMemo(() => statusesFor(taskOrgId), [statusesFor, taskOrgId]);
  const statusOptions = useMemo(() => {
    const values: Status[] = [];
    for (const option of orgStatuses) {
      if (option.status !== "active") continue;
      const value = option.key ?? statusForType[option.type];
      if (value && !values.includes(value)) values.push(value);
    }
    return (values.length ? values : builtInStatuses).map((value) => ({
      value,
      label: statusLabelFor(value, taskOrgId),
    }));
  }, [orgStatuses, statusLabelFor, taskOrgId]);
  const defaultTaskStatus = orgStatuses.find((option) => option.isDefault);
  const defaultStatus = defaultTaskStatus ? (defaultTaskStatus.key ?? statusForType[defaultTaskStatus.type]) : undefined;
  const preferredStatus = statusChoice ?? defaultStatus ?? "todo";
  const status = statusOptions.some((option) => option.value === preferredStatus)
    ? preferredStatus
    : (statusOptions[0]?.value ?? "todo");

  const projectTasks = useMemo(() => {
    if (!selectedProject) return [];
    return tasks.filter((task) =>
      selectedProject.id ? task.projectId === selectedProject.id : task.project === selectedProject.name,
    );
  }, [selectedProject, tasks]);

  // A tag or subtask typed but not yet added is still saved, rather than lost.
  const allTags = normalizeTags([...tags, ...parseTags(tagDraft)]);
  const allSubtasks = [...subtasks, subtaskDraft.trim()].filter(Boolean);

  const fieldErrors = validateTaskFields({ title, description, startDate, dueDate, estimatedHours, tags: allTags, requireDueDate: true });
  const recurrenceErrors = recurring ? validateRecurrence(recurrenceDraft, dueDate) : {};
  // Why Create is disabled. It was disabled with no word of explanation (FD-017).
  const blockingReason = [...Object.values(fieldErrors), ...Object.values(recurrenceErrors)][0];
  // Required-field errors wait until the field is touched; range errors show at once.
  const titleError = touched.has("title") ? fieldErrors.title : undefined;
  const dueDateError = touched.has("dueDate") ? fieldErrors.dueDate : undefined;

  const addSubtaskDraft = () => {
    const value = subtaskDraft.trim();
    if (!value) return;
    setSubtasks((current) => [...current, value]);
    setSubtaskDraft("");
  };

  const addFiles = (picked: File[]) => {
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const file of picked) {
      const reason = validateFile(file);
      if (reason) rejected.push(`${file.name} ${reason}`);
      else accepted.push(file);
    }
    setFiles((current) => {
      const known = new Set(current.map(fileKey));
      return [...current, ...accepted.filter((file) => !known.has(fileKey(file)))];
    });
    // Checked before the task exists, so a 60 MB, empty or .html file is refused
    // here instead of "accepted" and then lost (FD-066).
    if (rejected.length === 1) toast.error(`${rejected[0]}.`, { description: FILE_RULES.label });
    else if (rejected.length > 1) {
      toast.error(`${rejected.length} files were not added`, { description: `${rejected.join("; ")}. ${FILE_RULES.label}.` });
    }
  };

  const submit = async () => {
    if (blockingReason || saving) return;
    const person = assigneeOptions.find((item) => item.id === effectiveAssigneeId);
    const shown = person ?? personRef(null, "Me");
    const rule = recurring ? toRecurrenceRule(recurrenceDraft) : undefined;
    const projectTaskIds = new Set(projectTasks.map((task) => task.id));
    setSaving(true);
    try {
      const result = await addTask({
        title: title.trim(),
        description: description.trim() || undefined,
        project: selectedProject?.name ?? "",
        projectId: selectedProject?.id,
        assignee: { name: shown.name, initials: shown.initials, color: shown.color },
        // Undefined only while the session is resolving; the data layer then
        // assigns the creator, which is also this form's default.
        assigneeId: person?.id,
        status,
        priority,
        // Empty when no start date was chosen, not today (FD-032).
        startDate: startDate ? `${startDate}T00:00:00.000Z` : "",
        dueDate: `${dueDate}T00:00:00.000Z`,
        estimatedHours: estimatedHours.trim() === "" ? undefined : Number(estimatedHours),
        tags: allTags,
        subtasks: allSubtasks.map((item, index) => ({ id: `new-${index}`, title: item, completed: false })),
        dependencies: dependencies.filter((id) => projectTaskIds.has(id)),
        // Uploaded by the data layer once the task exists; dropped on create before (FD-058).
        files,
        recurrence: rule,
        recurrenceSummary: rule ? recurrenceSummary(rule, dueDate) : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Task created successfully");
      if (result.rejectedFiles.length) {
        const count = result.rejectedFiles.length;
        toast.error(count === 1 ? "1 file was not attached" : `${count} files were not attached`, {
          description: result.rejectedFiles.map((file) => `${file.name}: ${file.reason}`).join("; "),
        });
      }
      onClose();
    } catch (error) {
      console.error("[flowdesk] task create failed", error);
      toast.error("The task could not be created. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader className="border-b border-border px-6 py-4">
        <DialogTitle>Create new task</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Add details, assign responsibility, and set a deadline.
        </DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <Field label="Task Title*" htmlFor={fieldId("title")} error={titleError}>
          <Input
            id={fieldId("title")} autoFocus value={title} maxLength={TASK_LIMITS.titleMax} placeholder="e.g. Prepare Q3 board deck"
            onChange={(event) => { setTitle(event.target.value); touch("title"); }}
            onBlur={() => touch("title")} {...describedBy(fieldId("title"), titleError)}
          />
        </Field>
        <Field label="Description" htmlFor={fieldId("description")} error={fieldErrors.description}>
          <Textarea
            id={fieldId("description")} value={description} maxLength={TASK_LIMITS.descriptionMax} rows={3}
            onChange={(event) => setDescription(event.target.value)} {...describedBy(fieldId("description"), fieldErrors.description)}
            placeholder="Add context, links, and acceptance criteria..."
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Project" id={fieldId("project")} value={selectedProjectKey} onChange={setProjectKey} disabled={Boolean(fixedProject)}
            options={[{ value: NO_PROJECT, label: "No project" }, ...projectOptions.map((item) => ({ value: item.key, label: item.name }))]}
          />
          <SelectField
            label="Assignee" id={fieldId("assignee")} value={effectiveAssigneeId} onChange={setAssigneeId} placeholder="Choose a person"
            options={assigneeOptions.map((person) => ({
              value: person.id,
              label: person.id === signedInUserId && person.name !== "Me" ? `${person.name} (you)` : person.name,
            }))}
          />
          <SelectField label="Status" id={fieldId("status")} value={status} onChange={(value) => setStatusChoice(value as Status)} options={statusOptions} />
          <SelectField
            label="Priority" id={fieldId("priority")} value={priority} onChange={(value) => setPriority(value as Priority)}
            options={priorityOptions.map((option) => ({ value: option.id, label: option.name }))}
          />
          <Field label="Start Date" htmlFor={fieldId("start")}>
            <Input id={fieldId("start")} type="date" value={startDate} max={dueDate || TASK_LIMITS.dateMax} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label="Due Date*" htmlFor={fieldId("due")} error={dueDateError}>
            <Input
              id={fieldId("due")} type="date" value={dueDate} min={startDate || undefined} max={TASK_LIMITS.dateMax}
              onChange={(event) => { setDueDate(event.target.value); touch("dueDate"); }}
              onBlur={() => touch("dueDate")} {...describedBy(fieldId("due"), dueDateError)}
            />
          </Field>
          <Field label="Estimated Hours" htmlFor={fieldId("estimate")} error={fieldErrors.estimatedHours}>
            <Input
              id={fieldId("estimate")} type="number" min={TASK_LIMITS.estimateMin} max={TASK_LIMITS.estimateMax} step="0.5" inputMode="decimal"
              value={estimatedHours} placeholder="e.g. 4" onChange={(event) => setEstimatedHours(event.target.value)}
              {...describedBy(fieldId("estimate"), fieldErrors.estimatedHours)}
            />
          </Field>
          <Field label="Tags" labelId={fieldId("tags-label")} error={fieldErrors.tags} errorId={fieldId("tags-error")} className="sm:col-span-2">
            <TagPicker
              id={fieldId("tags")} options={tagOptions} selected={tags} onChange={setTags}
              draft={tagDraft} onDraftChange={setTagDraft} error={fieldErrors.tags}
            />
          </Field>
        </div>
        <div className="rounded-lg border border-border bg-muted/20">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Repeat2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <Label htmlFor={fieldId("recurring")}>Recurring task</Label>
                <p className="text-xs text-muted-foreground">Repeat this task automatically.</p>
              </div>
            </div>
            <Switch id={fieldId("recurring")} checked={recurring} onCheckedChange={setRecurring} />
          </div>
          {recurring && (
            <RecurrenceFields
              idPrefix={uid} draft={recurrenceDraft} errors={recurrenceErrors} dueDate={dueDate}
              onChange={(patch) => setRecurrenceDraft((current) => ({ ...current, ...patch }))}
            />
          )}
        </div>
        <Field label="Subtasks" htmlFor={fieldId("subtask")}>
          <div className="flex gap-2">
            <Input
              id={fieldId("subtask")}
              value={subtaskDraft}
              maxLength={TASK_LIMITS.subtaskMax}
              onChange={(event) => setSubtaskDraft(event.target.value)}
              // Enter did nothing; only the + button added a subtask (FD-027).
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                addSubtaskDraft();
              }}
              placeholder="Add a subtask and press Enter"
            />
            <Button type="button" variant="outline" size="icon" aria-label="Add subtask" onClick={addSubtaskDraft}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {subtasks.map((item, index) => (
            <div key={`${item}-${index}`} className="mt-2 flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span className="min-w-0 break-words">{item}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove subtask ${item}`}
                onClick={() => setSubtasks((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </Field>
        {/* Hidden, not deleted: there is no table for task dependencies yet, so the
            checkboxes collected choices that were discarded on save — the same
            "looks saved, isn't" pattern the QA pass was about. Re-enable once
            dependencies are persisted. */}
        {SHOW_DEPENDENCIES && <Field label="Dependencies" labelId={fieldId("dependencies-label")}>
          <div role="group" aria-labelledby={fieldId("dependencies-label")} className="flex flex-wrap gap-2">
            {projectTasks.map((task) => (
              <label key={task.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={dependencies.includes(task.id)}
                  onChange={(event) =>
                    setDependencies((current) =>
                      event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id),
                    )
                  }
                />
                {task.title}
              </label>
            ))}
            {projectTasks.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedProject ? "No other tasks in this project yet." : "Choose a project to pick tasks this one depends on."}
              </p>
            )}
          </div>
        </Field>}
        <Field label="Attachments" labelId={fieldId("attachments-label")}>
          <AttachmentsField
            id={fieldId("attachments")}
            files={files}
            onAdd={addFiles}
            onRemove={(key) => setFiles((current) => current.filter((file) => fileKey(file) !== key))}
          />
        </Field>
      </div>
      <DialogFooter className="gap-2 border-t border-border bg-card px-6 py-4 sm:space-x-0">
        <p id={fieldId("hint")} aria-live="polite" className="order-last text-xs text-muted-foreground empty:hidden sm:order-first sm:mr-auto sm:self-center">
          {blockingReason}
        </p>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={Boolean(blockingReason) || saving} aria-describedby={fieldId("hint")} onClick={() => void submit()}>
          {saving ? "Creating…" : "Create task"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Tags configured in Settings › Tags as chips, plus free tags. This was a free
 * text box: configured tags went unused and "qa, qa" saved twice (FD-040, FD-016).
 */
function TagPicker({ id, options, selected, onChange, draft, onDraftChange, error }: {
  id: string; options: TagConfig[]; selected: string[]; onChange: (tags: string[]) => void;
  draft: string; onDraftChange: (value: string) => void; error?: string;
}) {
  const configured = options
    .map((tag) => ({ id: tag.id, name: tag.name, value: normalizeTags([tag.name])[0] ?? "" }))
    .filter((tag) => tag.value);
  const configuredValues = new Set(configured.map((tag) => tag.value));
  const custom = selected.filter((tag) => !configuredValues.has(tag));
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((tag) => tag !== value) : normalizeTags([...selected, value]));
  const commitDraft = () => {
    if (!draft.trim()) return;
    onChange(normalizeTags([...selected, ...parseTags(draft)]));
    onDraftChange("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key !== "Enter" && event.key !== ",") || event.nativeEvent.isComposing) return;
    event.preventDefault();
    commitDraft();
  };

  return (
    <div className="space-y-2">
      {(configured.length > 0 || custom.length > 0) && (
        <div role="group" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
          {configured.map((tag) => {
            const isSelected = selected.includes(tag.value);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggle(tag.value)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  isSelected ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {tag.name}
              </button>
            );
          })}
          {custom.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-md border border-primary bg-primary/10 py-1 pl-2 pr-1 text-xs text-primary">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => onChange(selected.filter((item) => item !== tag))}
                className="rounded-sm p-0.5 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          maxLength={TASK_LIMITS.tagMax}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          aria-labelledby={`${id}-label`}
          {...describedBy(id, error)}
          placeholder={configured.length ? "Add another tag and press Enter" : "Add a tag and press Enter"}
        />
        <Button type="button" variant="outline" size="icon" aria-label="Add tag" onClick={commitDraft}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function RecurrenceFields({ idPrefix, draft, onChange, errors, dueDate }: {
  idPrefix: string; draft: RecurrenceDraft; onChange: (patch: Partial<RecurrenceDraft>) => void; errors: RecurrenceErrors; dueDate: string;
}) {
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const unit = draft.frequency === "daily" ? "days" : draft.frequency === "weekly" ? "weeks" : draft.frequency === "monthly" ? "months" : "years";
  const endError = errors.endDate ?? errors.occurrences;

  return (
    <div className="space-y-5 border-t border-border p-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <SelectField
          label="Frequency"
          id={fieldId("frequency")}
          value={draft.frequency}
          onChange={(value) => onChange({ frequency: value as RecurrenceFrequency })}
          options={frequencyOptions}
        />
        <Field label={`Every (${unit})`} htmlFor={fieldId("interval")}>
          <Input
            id={fieldId("interval")}
            type="number"
            min={RECURRENCE_LIMITS.intervalMin}
            max={RECURRENCE_LIMITS.intervalMax}
            step="1"
            inputMode="numeric"
            value={draft.interval}
            onChange={(event) => onChange({ interval: event.target.value })}
            {...describedBy(fieldId("interval"), errors.interval)}
          />
        </Field>
      </div>
      {/* Full width: the 120px column is too narrow for the message. */}
      {errors.interval && <p id={fieldId("interval-error")} className="-mt-3 text-xs text-destructive">{errors.interval}</p>}

      {draft.frequency === "weekly" && (
        <Field label="Repeat on" labelId={fieldId("weekdays-label")} error={errors.weekdays} errorId={fieldId("weekdays-error")}>
          <div role="group" aria-labelledby={fieldId("weekdays-label")} className="flex flex-wrap gap-2">
            {weekdays.map((day, index) => {
              const selected = draft.weekdays.includes(day.value);
              return (
                <Button key={`${day.value}-${index}`} type="button" variant={selected ? "default" : "outline"} size="icon" aria-pressed={selected} aria-label={weekdayNames[day.value]} onClick={() => onChange({ weekdays: selected ? draft.weekdays.filter((value) => value !== day.value) : [...draft.weekdays, day.value] })}>
                  {day.label}
                </Button>
              );
            })}
          </div>
        </Field>
      )}

      {draft.frequency === "monthly" && (
        <Field label="Monthly pattern" labelId={fieldId("pattern-label")}>
          <RadioGroup aria-labelledby={fieldId("pattern-label")} value={draft.monthlyPattern} onValueChange={(value) => onChange({ monthlyPattern: value as RecurrenceRule["monthlyPattern"] })} className="grid gap-2 sm:grid-cols-2">
            <RadioOption idPrefix={idPrefix} value="day_of_month" label="Same date" description="Repeat on the same calendar date." />
            <RadioOption idPrefix={idPrefix} value="weekday_pattern" label="Same weekday" description="Repeat on the same weekday pattern." />
          </RadioGroup>
        </Field>
      )}

      <Field label="Create the next task" labelId={fieldId("creation-label")}>
        <RadioGroup aria-labelledby={fieldId("creation-label")} value={draft.creationMode} onValueChange={(value) => onChange({ creationMode: value as RecurrenceCreationMode })} className="grid gap-2 sm:grid-cols-2">
          <RadioOption idPrefix={idPrefix} value="after_completion" label="After completion" description="Wait until the current task is completed." />
          <RadioOption idPrefix={idPrefix} value="on_schedule" label="On schedule" description="Create it even if the previous task is incomplete." />
        </RadioGroup>
      </Field>

      <Field label="Ends" htmlFor={fieldId("ends")} error={endError} errorId={fieldId("ends-error")}>
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <Select value={draft.endMode} onValueChange={(value) => onChange({ endMode: value as RecurrenceEndMode })}>
            <SelectTrigger id={fieldId("ends")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {endModeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {draft.endMode === "on_date" && <DatePicker value={draft.endDate} onChange={(endDate) => onChange({ endDate })} label="Choose end date" />}
          {draft.endMode === "after_count" && (
            <Input
              type="number"
              min={RECURRENCE_LIMITS.occurrencesMin}
              max={RECURRENCE_LIMITS.occurrencesMax}
              step="1"
              inputMode="numeric"
              value={draft.occurrences}
              onChange={(event) => onChange({ occurrences: event.target.value })}
              aria-label="Number of occurrences"
              {...describedBy(fieldId("ends"), errors.occurrences)}
            />
          )}
        </div>
      </Field>

      <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-foreground">
        {/* The summary said "every week" for an interval of −3 (FD-064). */}
        {errors.interval || errors.occurrences ? "Fix the repeat settings above to see the schedule." : recurrenceSummary(toRecurrenceRule(draft), dueDate)}
      </div>
    </div>
  );
}

/** Name, size and a remove button per file; only the names were listed (FD-070). */
function AttachmentsField({ id, files, onAdd, onRemove }: { id: string; files: File[]; onAdd: (files: File[]) => void; onRemove: (key: string) => void }) {
  return (
    <div>
      {/* sr-only rather than hidden: a display:none file input cannot be reached by keyboard. */}
      <label className="relative inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground focus-within:ring-1 focus-within:ring-ring">
        <Paperclip className="h-4 w-4" aria-hidden="true" />
        Attach files
        <input
          type="file"
          multiple
          accept={FILE_RULES.accept}
          className="sr-only"
          aria-describedby={`${id}-rules`}
          onChange={(event) => {
            onAdd(Array.from(event.target.files ?? []));
            // Cleared so the same file can be picked again after removing it.
            event.target.value = "";
          }}
        />
      </label>
      <p id={`${id}-rules`} className="mt-1.5 text-[11px] text-muted-foreground">{FILE_RULES.label}.</p>
      {files.length > 0 && (
        <ul aria-labelledby={`${id}-label`} className="mt-2 space-y-1.5">
          {files.map((file) => (
            <li key={fileKey(file)} className="flex items-center justify-between gap-3 rounded-md border border-border py-1 pl-3 pr-1 text-xs">
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="text-muted-foreground">{formatBytes(file.size)}</span>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${file.name}`} onClick={() => onRemove(fileKey(file))}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SelectField({ label, id, value, onChange, options, placeholder, disabled }: {
  label: string; id: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string }[]; placeholder?: string; disabled?: boolean;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function RadioOption({ idPrefix, value, label, description }: { idPrefix: string; value: string; label: string; description: string }) {
  const id = `${idPrefix}-recurrence-${value}`;
  return (
    <Label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{description}</span></span>
    </Label>
  );
}

function DatePicker({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const date = value ? new Date(`${value}T12:00:00`) : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label={date ? `End date, ${format(date, "MMMM d, yyyy")}` : label} className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
          <CalendarIcon className="h-4 w-4" aria-hidden="true" />
          {date ? format(date, "MMM d, yyyy") : label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={(selected) => onChange(selected ? format(selected, "yyyy-MM-dd") : "")} initialFocus className="pointer-events-auto p-3" />
      </PopoverContent>
    </Popover>
  );
}

/**
 * A labelled field with its inline error. Labels were not tied to their
 * controls, so inputs had no accessible name (FD-054).
 */
function Field({ label, htmlFor, labelId, error, errorId, className, children }: {
  label: string;
  /** Id of the single control this label names. */
  htmlFor?: string;
  /** Id of the label itself, for groups that reference it with aria-labelledby. */
  labelId?: string;
  error?: string;
  /** Defaults to `${htmlFor}-error`, matching describedBy(). */
  errorId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} id={labelId}>{label}</Label>
      {children}
      {error && <p id={errorId ?? (htmlFor ? `${htmlFor}-error` : undefined)} className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
