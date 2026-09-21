import { useEffect, useMemo, useState } from "react";
import { CalendarIcon, Paperclip, Plus, Repeat2, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { allPeople, projects } from "@/lib/mock-data";
import { useWorkspace, type Priority, type Status } from "@/lib/workspace-data";
import { useTaskSettings } from "@/lib/task-settings-data";
import { cn } from "@/lib/utils";
import { recurrenceSummary, type RecurrenceCreationMode, type RecurrenceEndMode, type RecurrenceFrequency, type RecurrenceRule } from "@/lib/recurrence";

const weekdays = [
  { value: 1, label: "M" }, { value: 2, label: "T" }, { value: 3, label: "W" },
  { value: 4, label: "T" }, { value: 5, label: "F" }, { value: 6, label: "S" }, { value: 0, label: "S" },
];

export function NewTaskDialog({
  open,
  onClose,
  projectName,
}: {
  open: boolean;
  onClose: () => void;
  projectName?: string;
}) {
  const { addTask, tasks } = useWorkspace();
  const { activeTaskStatuses, priorities: priorityOptions, activeTags, defaultTaskStatus } = useTaskSettings();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState(projectName ?? projects[0]?.name ?? "");
  const [assignee, setAssignee] = useState(allPeople[0]?.name ?? "");
  const [status, setStatus] = useState<Status>((defaultTaskStatus?.key as Status) ?? "todo");
  const [priority, setPriority] = useState<Priority>("medium");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("4");
  const [tags, setTags] = useState("");
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("weekly");
  const [repeatInterval, setRepeatInterval] = useState("1");
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([new Date().getDay()]);
  const [monthlyPattern, setMonthlyPattern] = useState<RecurrenceRule["monthlyPattern"]>("day_of_month");
  const [creationMode, setCreationMode] = useState<RecurrenceCreationMode>("after_completion");
  const [endMode, setEndMode] = useState<RecurrenceEndMode>("never");
  const [endDate, setEndDate] = useState("");
  const [occurrenceCount, setOccurrenceCount] = useState("10");

  useEffect(() => {
    if (open && projectName) setProject(projectName);
  }, [open, projectName]);
  const projectTasks = useMemo(
    () => tasks.filter((task) => task.project === project),
    [project, tasks],
  );
  const recurrence: RecurrenceRule = {
    frequency,
    interval: Math.max(1, Number(repeatInterval) || 1),
    weekdays: selectedWeekdays,
    monthlyPattern,
    creationMode,
    endMode,
    endDate: endMode === "on_date" ? endDate : undefined,
    maxOccurrences: endMode === "after_count" ? Math.max(2, Number(occurrenceCount) || 2) : undefined,
  };
  const recurrenceInvalid = recurring && (
    (frequency === "weekly" && selectedWeekdays.length === 0) ||
    (endMode === "on_date" && (!endDate || (dueDate && endDate <= dueDate))) ||
    (endMode === "after_count" && Number(occurrenceCount) < 2)
  );
  const submit = () => {
    const person = allPeople.find((item) => item.name === assignee);
    if (!title.trim() || !person || !dueDate || recurrenceInvalid) return;
    addTask({
      title: title.trim(),
      description: description.trim(),
      project,
      assignee: person,
      status,
      priority,
      startDate: startDate ? new Date(startDate).toISOString() : new Date().toISOString(),
      dueDate: new Date(dueDate).toISOString(),
      estimatedHours: Number(estimatedHours) || 0,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      subtasks: subtasks.map((item, index) => ({
        id: `new-${index}`,
        title: item,
        completed: false,
      })),
      dependencies,
      attachments: files.map((file) => file.name),
      recurrence: recurring ? recurrence : undefined,
      recurrenceSummary: recurring ? recurrenceSummary(recurrence, dueDate) : undefined,
    });
    toast.success("Task created successfully");
    setTitle("");
    setDescription("");
    setSubtasks([]);
    setDependencies([]);
    setFiles([]);
    setRecurring(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Create new task</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Add details, assign responsibility, and set a deadline.
          </p>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <Field label="Task Title*">
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Prepare Q3 board deck"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="Add context, links, and acceptance criteria..."
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project">
              <Select value={project} onValueChange={setProject} disabled={Boolean(projectName)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((item) => (
                    <SelectItem key={item.id} value={item.name}>
                      {item.name}
                    </SelectItem>
                  ))}
                  {projectName && !projects.some((item) => item.name === projectName) && (
                    <SelectItem value={projectName}>{projectName}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Assignee">
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allPeople.map((person) => (
                    <SelectItem key={person.name} value={person.name}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={status} onValueChange={(value) => setStatus(value as Status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeTaskStatuses
                    .filter((option) => option.key)
                    .map((option) => (
                      <SelectItem key={option.id} value={option.key as string}>
                        {option.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={priority} onValueChange={(value) => setPriority(value as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {priorityOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start Date">
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label="Due Date*">
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </Field>
            <Field label="Estimated Hours">
              <Input
                type="number"
                min="0"
                value={estimatedHours}
                onChange={(event) => setEstimatedHours(event.target.value)}
              />
            </Field>
            <Field label="Tags">
              <Input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="design, urgent"
                list="workspace-tag-options"
              />
              <datalist id="workspace-tag-options">
                {activeTags.map((tag) => (
                  <option key={tag.id} value={tag.name} />
                ))}
              </datalist>
            </Field>
          </div>
          <div className="rounded-lg border border-border bg-muted/20">
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Repeat2 className="h-4 w-4" />
                </span>
                <div>
                  <Label htmlFor="recurring-task">Recurring task</Label>
                  <p className="text-xs text-muted-foreground">Repeat this task automatically.</p>
                </div>
              </div>
              <Switch id="recurring-task" checked={recurring} onCheckedChange={setRecurring} />
            </div>
            {recurring && (
              <div className="space-y-5 border-t border-border p-4">
                <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                  <Field label="Frequency">
                    <Select value={frequency} onValueChange={(value) => setFrequency(value as RecurrenceFrequency)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={`Every (${frequency === "daily" ? "days" : frequency === "weekly" ? "weeks" : frequency === "monthly" ? "months" : "years"})`}>
                    <Input type="number" min="1" max="365" value={repeatInterval} onChange={(event) => setRepeatInterval(event.target.value)} />
                  </Field>
                </div>

                {frequency === "weekly" && (
                  <Field label="Repeat on">
                    <div className="flex flex-wrap gap-2">
                      {weekdays.map((day, index) => {
                        const selected = selectedWeekdays.includes(day.value);
                        return (
                          <Button key={`${day.value}-${index}`} type="button" variant={selected ? "default" : "outline"} size="icon" aria-pressed={selected} aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day.value]} onClick={() => setSelectedWeekdays((current) => selected ? current.filter((value) => value !== day.value) : [...current, day.value])}>
                            {day.label}
                          </Button>
                        );
                      })}
                    </div>
                    {selectedWeekdays.length === 0 && <p className="text-xs text-destructive">Choose at least one day.</p>}
                  </Field>
                )}

                {frequency === "monthly" && (
                  <Field label="Monthly pattern">
                    <RadioGroup value={monthlyPattern} onValueChange={(value) => setMonthlyPattern(value as RecurrenceRule["monthlyPattern"])} className="grid gap-2 sm:grid-cols-2">
                      <RadioOption value="day_of_month" label="Same date" description="Repeat on the same calendar date." />
                      <RadioOption value="weekday_pattern" label="Same weekday" description="Repeat on the same weekday pattern." />
                    </RadioGroup>
                  </Field>
                )}

                <Field label="Create the next task">
                  <RadioGroup value={creationMode} onValueChange={(value) => setCreationMode(value as RecurrenceCreationMode)} className="grid gap-2 sm:grid-cols-2">
                    <RadioOption value="after_completion" label="After completion" description="Wait until the current task is completed." />
                    <RadioOption value="on_schedule" label="On schedule" description="Create it even if the previous task is incomplete." />
                  </RadioGroup>
                </Field>

                <Field label="Ends">
                  <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                    <Select value={endMode} onValueChange={(value) => setEndMode(value as RecurrenceEndMode)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="never">Never</SelectItem>
                        <SelectItem value="on_date">On a date</SelectItem>
                        <SelectItem value="after_count">After occurrences</SelectItem>
                      </SelectContent>
                    </Select>
                    {endMode === "on_date" && <DatePicker value={endDate} onChange={setEndDate} label="Choose end date" />}
                    {endMode === "after_count" && <Input type="number" min="2" max="1000" value={occurrenceCount} onChange={(event) => setOccurrenceCount(event.target.value)} aria-label="Number of occurrences" />}
                  </div>
                  {endMode === "on_date" && endDate && dueDate && endDate <= dueDate && <p className="text-xs text-destructive">End date must be after the first due date.</p>}
                </Field>

                <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-foreground">
                  {recurrenceSummary(recurrence, dueDate)}
                </div>
              </div>
            )}
          </div>
          <Field label="Subtasks">
            <div className="flex gap-2">
              <Input
                value={subtaskDraft}
                onChange={(event) => setSubtaskDraft(event.target.value)}
                placeholder="Add a subtask"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  if (subtaskDraft.trim()) {
                    setSubtasks((current) => [...current, subtaskDraft.trim()]);
                    setSubtaskDraft("");
                  }
                }}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {subtasks.map((item, index) => (
              <div
                key={`${item}-${index}`}
                className="mt-2 flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>{item}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setSubtasks((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </Field>
          <Field label="Dependencies">
            <div className="flex flex-wrap gap-2">
              {projectTasks.map((task) => (
                <label
                  key={task.id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={dependencies.includes(task.id)}
                    onChange={(event) =>
                      setDependencies((current) =>
                        event.target.checked
                          ? [...current, task.id]
                          : current.filter((id) => id !== task.id),
                      )
                    }
                  />
                  {task.title}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Attachments">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
              <Paperclip className="h-4 w-4" />
              Attach files
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            {files.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {files.map((file) => file.name).join(", ")}
              </p>
            )}
          </Field>
        </div>
        <DialogFooter className="border-t border-border bg-card px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || !dueDate || recurrenceInvalid} onClick={submit}>
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RadioOption({ value, label, description }: { value: string; label: string; description: string }) {
  return (
    <Label htmlFor={`recurrence-${value}`} className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
      <RadioGroupItem id={`recurrence-${value}`} value={value} className="mt-0.5" />
      <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{description}</span></span>
    </Label>
  );
}

function DatePicker({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const date = value ? new Date(`${value}T12:00:00`) : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
          <CalendarIcon className="h-4 w-4" />
          {date ? format(date, "MMM d, yyyy") : label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={(selected) => onChange(selected ? format(selected, "yyyy-MM-dd") : "")} initialFocus className="pointer-events-auto p-3" />
      </PopoverContent>
    </Popover>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
