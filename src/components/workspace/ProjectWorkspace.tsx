import { useMemo, useRef, useState } from "react";
import { ProjectFormDialog } from "./ProjectsPage";
import { addDays, differenceInCalendarDays, format, isBefore, startOfDay } from "date-fns";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Copy,
  Download,
  Edit3,
  FileText,
  Filter,
  Flag,
  FolderOpen,
  GitBranch,
  LayoutGrid,
  List,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { allPeople, type Priority, type Status } from "@/lib/mock-data";
import { useWorkspace, type WorkspaceTask } from "@/lib/workspace-data";
import { NewTaskDialog } from "./NewTaskDialog";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

export type WorkspaceProject = {
  id: string;
  name: string;
  color: string;
  deadline: string;
  startDate: string;
  category: string;
  client: string;
  description?: string;
  projectId?: string;
  projectType?: "internal" | "client";
  department?: string;
  priority?: Priority;
  creationStatus?: "planning" | "active" | "on-hold" | "completed" | "cancelled" | "archived";
  manager: { name: string; initials: string; color: string };
  team: { name: string; initials: string; color: string }[];
  isNew?: boolean;
};

type Tab = "overview" | "tasks" | "team" | "timeline" | "documents" | "activity";
type Milestone = {
  id: string;
  name: string;
  description: string;
  owner: string;
  targetDate: string;
  status: "upcoming" | "progress" | "completed" | "delayed";
  progress: number;
  relatedTasks: string[];
};
type DocumentItem = {
  id: string;
  name: string;
  uploadedBy: string;
  added: string;
  size: string;
  type: string;
};
type ActivityItem = {
  id: string;
  category: "tasks" | "team" | "documents" | "project";
  actor: string;
  action: string;
  target?: string;
  detail?: string;
  time: string;
};

const permissions = {
  createTasks: true,
  assignTasks: true,
  manageProjects: true,
  manageTeam: true,
  manageMilestones: true,
  manageDocuments: true,
  deleteProjects: true,
};
const statusLabels: Record<string, string> = {
  planning: "Planning",
  active: "Active",
  "on-hold": "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
};
const taskStatusLabels: Record<Status, string> = {
  todo: "To Do",
  progress: "In Progress",
  review: "Review",
  done: "Completed",
};
const priorityStyles: Record<Priority, string> = {
  low: "bg-priority-low/15 text-priority-low",
  medium: "bg-priority-medium/15 text-priority-medium",
  high: "bg-priority-high/15 text-priority-high",
  critical: "bg-priority-critical/15 text-priority-critical",
};
const taskStatusStyles: Record<Status, string> = {
  todo: "bg-status-todo/15 text-status-todo",
  progress: "bg-status-progress/15 text-status-progress",
  review: "bg-status-review/15 text-status-review",
  done: "bg-status-done/15 text-status-done",
};

export function ProjectWorkspace({
  project: initialProject,
  onBack,
  onDuplicate,
  onDelete,
}: {
  project: WorkspaceProject;
  onBack: () => void;
  onDuplicate?: (project: WorkspaceProject) => void;
  onDelete?: (projectId: string) => void;
}) {
  const { tasks, updateTask } = useWorkspace();
  const [project, setProject] = useState(initialProject);
  const [tab, setTab] = useState<Tab>("overview");
  const [taskOpen, setTaskOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [detailVariant, setDetailVariant] = useState<"sheet" | "modal">("sheet");
  const [showSetup, setShowSetup] = useState(initialProject.isNew ?? true);
  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentItem[]>(
    initialProject.isNew
      ? []
      : [
          {
            id: "d1",
            name: "Project Brief.pdf",
            uploadedBy: "Alex Morgan",
            added: "Sep 13",
            size: "2.4 MB",
            type: "PDF",
          },
          {
            id: "d2",
            name: "Experience Map.fig",
            uploadedBy: "Priya Shah",
            added: "Sep 15",
            size: "8.7 MB",
            type: "Design",
          },
          {
            id: "d3",
            name: "Q3 Roadmap.xlsx",
            uploadedBy: "Jordan Lee",
            added: "Sep 16",
            size: "820 KB",
            type: "Spreadsheet",
          },
        ],
  );
  const [activities, setActivities] = useState<ActivityItem[]>([
    {
      id: "a1",
      category: "tasks",
      actor: "Priya Shah",
      action: "completed",
      target: "Homepage Wireframe",
      time: "2 hours ago",
    },
    {
      id: "a2",
      category: "tasks",
      actor: "Alex Morgan",
      action: "moved API Integration",
      detail: "In Progress → Review",
      time: "5 hours ago",
    },
    {
      id: "a3",
      category: "documents",
      actor: "Jordan Lee",
      action: "uploaded",
      target: "Project Brief.pdf",
      time: "Yesterday",
    },
    {
      id: "a4",
      category: "team",
      actor: "Sam Chen",
      action: "joined the project",
      time: "2 days ago",
    },
    {
      id: "a5",
      category: "project",
      actor: "Alex Morgan",
      action: "created the project",
      time: "4 days ago",
    },
  ]);
  const projectTasks = tasks.filter(
    (task) => task.project === project.name || task.projectId === project.id,
  );
  const milestonesSeed = useMemo<Milestone[]>(
    () => [
      {
        id: "m1",
        name: "Kickoff",
        description: "Project kickoff and alignment",
        owner: project.manager.name,
        targetDate: project.startDate,
        status: "completed",
        progress: 100,
        relatedTasks: [],
      },
      {
        id: "m2",
        name: "Design Review",
        description: "Review final design direction",
        owner: project.team[1]?.name ?? project.manager.name,
        targetDate: addDays(new Date(project.startDate), 5).toISOString(),
        status: "completed",
        progress: 100,
        relatedTasks: projectTasks.slice(0, 1).map((task) => task.id),
      },
      {
        id: "m3",
        name: "Beta Release",
        description: "Release beta to stakeholders",
        owner: project.team[2]?.name ?? project.manager.name,
        targetDate: addDays(new Date(), 8).toISOString(),
        status: "progress",
        progress: 60,
        relatedTasks: projectTasks.slice(1, 3).map((task) => task.id),
      },
      {
        id: "m4",
        name: "Final Launch",
        description: "Production launch",
        owner: project.manager.name,
        targetDate: project.deadline,
        status: "upcoming",
        progress: 0,
        relatedTasks: projectTasks.slice(3).map((task) => task.id),
      },
    ],
    [project.deadline, project.manager.name, project.startDate, project.team, projectTasks.length],
  );
  const [milestones, setMilestones] = useState(milestonesSeed);
  const completed = projectTasks.filter((task) => task.status === "done").length;
  const inProgress = projectTasks.filter((task) => task.status === "progress").length;
  const overdue = projectTasks.filter(
    (task) => task.status !== "done" && isBefore(new Date(task.dueDate), startOfDay(new Date())),
  ).length;
  const progress = projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0;
  const delayedMilestones = milestones.filter(
    (item) =>
      item.status !== "completed" && isBefore(new Date(item.targetDate), startOfDay(new Date())),
  );
  const criticalOverdue = projectTasks.filter(
    (task) =>
      task.priority === "critical" &&
      task.status !== "done" &&
      isBefore(new Date(task.dueDate), new Date()),
  ).length;
  const health =
    delayedMilestones.length || isBefore(new Date(project.deadline), new Date())
      ? "Delayed"
      : criticalOverdue || overdue >= 2
        ? "At Risk"
        : "On Track";
  const healthReason =
    health === "Delayed"
      ? `${delayedMilestones.length || 1} major milestone or project deadline is overdue.`
      : health === "At Risk"
        ? `${criticalOverdue || overdue} critical or overdue tasks require attention.`
        : "No significant overdue work or delayed critical milestones.";
  const setupItems = [
    true,
    milestones.length > 0,
    projectTasks.length > 0,
    project.team.length > 1,
    documents.length > 0,
  ];
  const setupComplete = setupItems.filter(Boolean).length;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const log = (item: Omit<ActivityItem, "id" | "time">) =>
    setActivities((current) => [
      { ...item, id: crypto.randomUUID(), time: "Just now" },
      ...current,
    ]);
  const changeStatus = (value: WorkspaceProject["creationStatus"]) => {
    setProject((current) => ({ ...current, creationStatus: value }));
    log({
      category: "project",
      actor: "Alex Morgan",
      action: "changed project status",
      detail: `→ ${statusLabels[value ?? "active"]}`,
    });
    toast.success("Project status updated");
  };

  return (
    <TooltipProvider>
      <div className="space-y-5 animate-in fade-in duration-200">
        <header className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="outline" size="sm" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
                Back to Projects
              </Button>
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-primary-foreground"
                style={{ background: project.color }}
              >
                {project.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold">{project.name}</h2>
                <p className="truncate text-xs text-muted-foreground">
                  {project.projectId ?? `PRJ-${project.id.replace(/\D/g, "").padStart(5, "0")}`} ·{" "}
                  {project.projectType === "client" ? "Client" : "Internal"} ·{" "}
                  {project.department ?? project.category}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={project.creationStatus ?? "active"}
                onValueChange={(value) => changeStatus(value as WorkspaceProject["creationStatus"])}
              >
                <SelectTrigger className="h-9 w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "inline-flex h-8 items-center rounded-md border px-2 text-[11px] font-medium",
                      health === "On Track"
                        ? "border-status-done/30 bg-status-done/10 text-status-done"
                        : health === "At Risk"
                          ? "border-priority-medium/30 bg-priority-medium/10 text-priority-medium"
                          : "border-destructive/30 bg-destructive/10 text-destructive",
                    )}
                  >
                    {health}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{healthReason}</TooltipContent>
              </Tooltip>
              {permissions.createTasks && (
                <Button size="sm" onClick={() => setTaskOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Add Task
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Edit3 className="h-4 w-4" />
                Edit Project
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Project actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => changeStatus("on-hold")}>
                    <ChevronDown />
                    Change Status
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      onDuplicate?.(project);
                      toast.success("Project duplicated");
                    }}
                  >
                    <Copy />
                    Duplicate Project
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConfirmAction("archive")}>
                    <Archive />
                    Archive Project
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setConfirmAction("delete")}
                  >
                    <Trash2 />
                    Delete Project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <nav className="flex overflow-x-auto border-t border-border px-5">
            {(["overview", "tasks", "team", "timeline", "documents", "activity"] as Tab[]).map(
              (item) => (
                <Button
                  key={item}
                  variant="ghost"
                  onClick={() => setTab(item)}
                  className={cn(
                    "h-10 rounded-none border-b-2 px-3 capitalize",
                    tab === item
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground",
                  )}
                >
                  {item}
                </Button>
              ),
            )}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl pb-8">
          {tab === "overview" && (
            <OverviewTab
              project={project}
              tasks={projectTasks}
              milestones={milestones}
              documents={documents}
              activities={activities}
              progress={progress}
              completed={completed}
              inProgress={inProgress}
              overdue={overdue}
              health={health}
              showSetup={showSetup && setupComplete < 5}
              setupItems={setupItems}
              onDismiss={() => setShowSetup(false)}
              onNavigate={setTab}
              onAddTask={() => setTaskOpen(true)}
              onEdit={() => setEditOpen(true)}
            />
          )}
          {tab === "tasks" && (
            <TasksTab
              tasks={projectTasks}
              onAdd={() => setTaskOpen(true)}
              onSelect={(task, v) => {
                setSelectedTaskId(task.id);
                setDetailVariant(v === "board" ? "modal" : "sheet");
              }}
              onUpdate={(id, updates) => {
                updateTask(id, updates);
                log({
                  category: "tasks",
                  actor: "Alex Morgan",
                  action: "updated",
                  target: tasks.find((task) => task.id === id)?.title,
                });
              }}
            />
          )}
          {tab === "team" && (
            <TeamTab
              project={project}
              tasks={projectTasks}
              onChangeTeam={(team) => setProject((current) => ({ ...current, team }))}
              onLog={log}
              memberPickerOpen={memberPickerOpen}
              setMemberPickerOpen={setMemberPickerOpen}
            />
          )}
          {tab === "timeline" && (
            <TimelineTab
              project={project}
              tasks={projectTasks}
              milestones={milestones}
              onChange={setMilestones}
              onOpenCreate={() => setMilestoneOpen(true)}
            />
          )}
          {tab === "documents" && (
            <DocumentsTab documents={documents} onChange={setDocuments} onLog={log} />
          )}
          {tab === "activity" && <ActivityTab activities={activities} />}
        </main>

        <NewTaskDialog
          open={taskOpen}
          onClose={() => setTaskOpen(false)}
          projectName={project.name}
        />
        <TaskDetailDrawer
          variant={detailVariant}
          task={selectedTask}
          open={Boolean(selectedTask)}
          onOpenChange={(open) => !open && setSelectedTaskId(undefined)}
        />
        <EditProjectDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          project={project}
          onSave={(updates) => {
            setProject((current) => ({ ...current, ...updates }));
            log({ category: "project", actor: "Alex Morgan", action: "edited the project" });
            toast.success("Project updated");
          }}
        />
        <MilestoneDialog
          open={milestoneOpen}
          onOpenChange={setMilestoneOpen}
          project={project}
          tasks={projectTasks}
          onCreate={(milestone) => {
            setMilestones((current) => [...current, milestone]);
            log({
              category: "project",
              actor: "Alex Morgan",
              action: "created milestone",
              target: milestone.name,
            });
          }}
        />
        <AlertDialog
          open={Boolean(confirmAction)}
          onOpenChange={(open) => !open && setConfirmAction(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmAction === "delete" ? "Delete this project?" : "Archive this project?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirmAction === "delete"
                  ? "This removes the project from this workspace. This action cannot be undone."
                  : "The project becomes read-only and moves out of active work."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={
                  confirmAction === "delete"
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : ""
                }
                onClick={() => {
                  if (confirmAction === "delete") {
                    onDelete?.(project.id);
                    onBack();
                  } else changeStatus("archived");
                  setConfirmAction(null);
                }}
              >
                {confirmAction === "delete" ? "Delete Project" : "Archive Project"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function OverviewTab({
  project,
  tasks,
  milestones,
  documents,
  activities,
  progress,
  completed,
  inProgress,
  overdue,
  health,
  showSetup,
  setupItems,
  onDismiss,
  onNavigate,
  onAddTask,
  onEdit,
}: {
  project: WorkspaceProject;
  tasks: WorkspaceTask[];
  milestones: Milestone[];
  documents: DocumentItem[];
  activities: ActivityItem[];
  progress: number;
  completed: number;
  inProgress: number;
  overdue: number;
  health: string;
  showSetup: boolean;
  setupItems: boolean[];
  onDismiss: () => void;
  onNavigate: (tab: Tab) => void;
  onAddTask: () => void;
  onEdit: () => void;
}) {
  const labels: [string, Tab][] = [
    ["Basic Project Information", "overview"],
    ["Add Milestones", "timeline"],
    ["Create Tasks", "tasks"],
    ["Confirm Project Team", "team"],
    ["Add Project Documents", "documents"],
  ];
  const dueSoon = tasks.filter(
    (task) =>
      task.status !== "done" &&
      differenceInCalendarDays(new Date(task.dueDate), new Date()) >= 0 &&
      differenceInCalendarDays(new Date(task.dueDate), new Date()) <= 7,
  ).length;
  const review = tasks.filter((task) => task.status === "review").length;
  const issues = [
    {
      show: overdue > 0,
      label: `${overdue} overdue task${overdue === 1 ? "" : "s"}`,
      tab: "tasks" as Tab,
      tone: "text-destructive",
    },
    {
      show: dueSoon > 0,
      label: `${dueSoon} task${dueSoon === 1 ? "" : "s"} due this week`,
      tab: "tasks" as Tab,
      tone: "text-priority-medium",
    },
    {
      show: review > 0,
      label: `${review} task${review === 1 ? "" : "s"} awaiting review`,
      tab: "tasks" as Tab,
      tone: "text-priority-high",
    },
  ].filter((item) => item.show);
  return (
    <div className="space-y-5">
      {showSetup && (
        <Section
          title="Complete Project Setup"
          action={
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss Checklist
            </Button>
          }
        >
          <p className="-mt-3 mb-3 text-xs text-muted-foreground">
            Finish the key planning steps before work begins.
          </p>
          <div className="mb-3 flex items-center gap-3">
            <Progress value={(setupItems.filter(Boolean).length / 5) * 100} className="max-w-xs" />
            <span className="text-xs text-muted-foreground">
              {setupItems.filter(Boolean).length} of 5 completed
            </span>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {labels.map(([label, destination], index) => (
              <Button
                key={label}
                variant="ghost"
                onClick={() => !setupItems[index] && onNavigate(destination)}
                className="h-8 justify-start px-2 text-xs font-normal"
                disabled={setupItems[index]}
              >
                {setupItems[index] ? (
                  <CheckCircle2 className="h-4 w-4 text-status-done" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
                {label}
              </Button>
            ))}
          </div>
        </Section>
      )}
      <section className="border-b border-border px-1 pb-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">About this Project</h3>
          {permissions.manageProjects && (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Edit3 className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
        <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
          {project.description || "No project description has been added yet."}
        </p>
      </section>
      <Section title="Project Summary">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Summary label="Manager" value={project.manager.name} />
          <Summary
            label="Timeline"
            value={`${format(new Date(project.startDate), "MMM d")} – ${format(new Date(project.deadline), "MMM d, yyyy")}`}
          />
          <Summary label="Priority" value={project.priority ?? "Medium"} capitalize />
          <Summary label="Team" value={`${project.team.length} Members`} />
          <Summary label="Status" value={statusLabels[project.creationStatus ?? "active"]} />
        </div>
      </Section>
      <Section title="Project Progress">
        {tasks.length ? (
          <>
            <div className="mb-2 flex items-end justify-between">
              <span className="text-xl font-semibold">{progress}% Complete</span>
              <span className="text-xs text-muted-foreground">Calculated from tasks</span>
            </div>
            <Progress value={progress} className="h-2.5" />
            <div className="mt-3 flex flex-wrap gap-5 text-xs text-muted-foreground">
              <span>
                <b className="text-foreground">
                  {completed} / {tasks.length}
                </b>{" "}
                Completed
              </span>
              <span>
                <b className="text-foreground">{inProgress}</b> In Progress
              </span>
              <span>
                <b className={overdue ? "text-destructive" : "text-foreground"}>{overdue}</b>{" "}
                Overdue
              </span>
            </div>
          </>
        ) : (
          <div className="py-4 text-center">
            <p className="text-sm font-medium">No tasks have been created yet.</p>
            <Button size="sm" className="mt-3" onClick={onAddTask}>
              <Plus className="h-4 w-4" />
              Create First Task
            </Button>
          </div>
        )}
      </Section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section
          title="Milestones"
          action={
            <Button variant="ghost" size="sm" onClick={() => onNavigate("timeline")}>
              View Timeline
            </Button>
          }
        >
          <div className="space-y-3">
            {milestones.slice(0, 4).map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border",
                    item.status === "completed" &&
                      "border-status-done bg-status-done text-primary-foreground",
                  )}
                >
                  {item.status === "completed" && <Check className="h-3 w-3" />}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.status === "completed" ? "Completed" : "Target"}{" "}
                    {format(new Date(item.targetDate), "MMM d")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Attention Required">
          {issues.length ? (
            <div className="space-y-1">
              {issues.map((item) => (
                <Button
                  key={item.label}
                  variant="ghost"
                  onClick={() => onNavigate(item.tab)}
                  className="w-full justify-start px-2 text-sm"
                >
                  <AlertTriangle className={cn("h-4 w-4", item.tone)} />
                  {item.label}
                </Button>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-3 py-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-status-done" />
              <div>
                <div className="text-sm font-medium">Everything is on track</div>
                <p className="text-xs text-muted-foreground">
                  No immediate action is required. Project health is {health.toLowerCase()}.
                </p>
              </div>
            </div>
          )}
        </Section>
      </div>
      <Section
        title="Recent Activity"
        action={
          <Button variant="ghost" size="sm" onClick={() => onNavigate("activity")}>
            View All Activity
          </Button>
        }
      >
        <ActivityList activities={activities.slice(0, 5)} />
      </Section>
    </div>
  );
}

function Summary({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate text-sm font-medium", capitalize && "capitalize")}>
        {value}
      </div>
    </div>
  );
}

function TasksTab({
  tasks,
  onAdd,
  onSelect,
  onUpdate,
}: {
  tasks: WorkspaceTask[];
  onAdd: () => void;
  onSelect: (task: WorkspaceTask, view: "list" | "board") => void;
  onUpdate: (id: string, updates: Partial<WorkspaceTask>) => void;
}) {
  const [view, setViewState] = useState<"list" | "board">(() =>
    typeof window === "undefined"
      ? "list"
      : (window.localStorage.getItem("project-task-view") as "list" | "board") || "list",
  );
  const [bucket, setBucket] = useState<Status | "all" | "overdue">("all");
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [sort, setSort] = useState("due");
  const [dragId, setDragId] = useState<string>();
  const setView = (value: "list" | "board") => {
    setViewState(value);
    window.localStorage.setItem("project-task-view", value);
  };
  const now = new Date();
  const counts = {
    all: tasks.length,
    todo: tasks.filter((task) => task.status === "todo").length,
    progress: tasks.filter((task) => task.status === "progress").length,
    review: tasks.filter((task) => task.status === "review").length,
    done: tasks.filter((task) => task.status === "done").length,
    overdue: tasks.filter((task) => task.status !== "done" && new Date(task.dueDate) < now).length,
  };
  const filtered = tasks
    .filter(
      (task) =>
        (bucket === "all" ||
          (bucket === "overdue"
            ? task.status !== "done" && new Date(task.dueDate) < now
            : task.status === bucket)) &&
        (assignee === "all" || task.assignee.name === assignee) &&
        (priority === "all" || task.priority === priority) &&
        `${task.title} ${task.id}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "priority"
        ? ["critical", "high", "medium", "low"].indexOf(a.priority) -
          ["critical", "high", "medium", "low"].indexOf(b.priority)
        : +new Date(a.dueDate) - +new Date(b.dueDate),
    );
  if (!tasks.length)
    return (
      <EmptyState
        icon={CheckCircle2}
        title="No tasks yet"
        description="Break this project into actionable tasks and assign responsibilities to your team."
        action="Create First Task"
        onAction={onAdd}
      />
    );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            Tasks <span className="text-muted-foreground">({tasks.length})</span>
          </h3>
        </div>
        {permissions.createTasks && (
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            Add Task
          </Button>
        )}
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {(
          [
            { id: "all", label: "All" },
            { id: "todo", label: "To Do" },
            { id: "progress", label: "In Progress" },
            { id: "review", label: "Review" },
            { id: "done", label: "Completed" },
            { id: "overdue", label: "Overdue" },
          ] as const
        ).map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            onClick={() => setBucket(item.id)}
            className={cn(
              "shrink-0 rounded-none border-b-2",
              bucket === item.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground",
            )}
          >
            {item.label} {counts[item.id]}
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks"
              className="h-8 w-48 pl-8 text-xs"
            />
          </div>
          <CompactSelect
            value={assignee}
            onValue={setAssignee}
            options={["all", ...Array.from(new Set(tasks.map((task) => task.assignee.name)))]}
            label="Assignee"
          />
          <CompactSelect
            value={priority}
            onValue={(value) => setPriority(value as Priority | "all")}
            options={["all", "low", "medium", "high", "critical"]}
            label="Priority"
          />
          <CompactSelect
            value={sort}
            onValue={setSort}
            options={["due", "priority"]}
            label="Sort"
          />
        </div>
        <div className="inline-flex w-fit rounded-lg border border-border bg-card p-1">
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("list")}
          >
            <List className="h-4 w-4" />
            List
          </Button>
          <Button
            variant={view === "board" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("board")}
          >
            <LayoutGrid className="h-4 w-4" />
            Board
          </Button>
        </div>
      </div>
      {view === "list" ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
              <tr>
                {["Task", "Assignee", "Status", "Priority", "Due Date", "Progress", "Actions"].map(
                  (item) => (
                    <th key={item} className="px-4 py-3 text-left font-medium">
                      {item}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => onSelect(task, "list")}
                  className="cursor-pointer border-t border-border hover:bg-accent/40"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{task.title}</div>
                    <div className="text-[10px] text-muted-foreground">{task.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Person person={task.assignee} />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-md px-2 py-1 text-[10px]",
                        taskStatusStyles[task.status],
                      )}
                    >
                      {taskStatusLabels[task.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-md px-2 py-1 text-[10px] capitalize",
                        priorityStyles[task.priority],
                      )}
                    >
                      {task.priority}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-xs",
                      task.status !== "done" && new Date(task.dueDate) < now
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {format(new Date(task.dueDate), "MMM d")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Progress value={task.progress} className="w-20" />
                      <span className="text-xs">{task.progress}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(["todo", "progress", "review", "done"] as Status[]).map((status) => (
            <div
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragId)
                  onUpdate(dragId, {
                    status,
                    progress:
                      status === "done" ? 100 : tasks.find((task) => task.id === dragId)?.progress,
                  });
                setDragId(undefined);
              }}
              className="min-h-[320px] rounded-xl border border-border bg-muted/20 p-3"
            >
              <div className="mb-3 flex items-center justify-between text-xs font-semibold">
                <span>{taskStatusLabels[status]}</span>
                <span className="text-muted-foreground">
                  {filtered.filter((task) => task.status === status).length}
                </span>
              </div>
              <div className="space-y-2">
                {filtered
                  .filter((task) => task.status === status)
                  .map((task) => (
                    <button
                      key={task.id}
                      draggable
                      onDragStart={() => setDragId(task.id)}
                      onClick={() => onSelect(task, "board")}
                      className="w-full rounded-lg border border-border bg-card p-3 text-left shadow-[var(--shadow-soft)] hover:border-ring/40"
                    >
                      <div className="text-sm font-medium">{task.title}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <Person person={task.assignee} compact />
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] capitalize",
                            priorityStyles[task.priority],
                          )}
                        >
                          {task.priority}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{format(new Date(task.dueDate), "MMM d")}</span>
                        <span>
                          {task.subtasks.filter((item) => item.completed).length}/
                          {task.subtasks.length} subtasks
                        </span>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamTab({
  project,
  tasks,
  onChangeTeam,
  onLog,
  memberPickerOpen,
  setMemberPickerOpen,
}: {
  project: WorkspaceProject;
  tasks: WorkspaceTask[];
  onChangeTeam: (team: WorkspaceProject["team"]) => void;
  onLog: (activity: Omit<ActivityItem, "id" | "time">) => void;
  memberPickerOpen: boolean;
  setMemberPickerOpen: (open: boolean) => void;
}) {
  const [selectedName, setSelectedName] = useState<string>();
  const [removeName, setRemoveName] = useState<string>();
  const selected = project.team.find((person) => person.name === selectedName);
  const memberTasks = tasks.filter((task) => task.assignee.name === selectedName);
  const activeForRemoval = tasks.filter(
    (task) => task.assignee.name === removeName && task.status !== "done",
  );
  const workload = (count: number, hours: number) =>
    hours > 50 || count > 8
      ? "Overloaded"
      : hours > 35 || count > 5
        ? "High"
        : count > 2
          ? "Normal"
          : "Low";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          Project Team{" "}
          <span className="text-muted-foreground">({project.team.length} Members)</span>
        </h3>
        {permissions.manageTeam && (
          <Button size="sm" onClick={() => setMemberPickerOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add Member
          </Button>
        )}
      </div>
      <Section title="Project Manager">
        <div className="flex items-center gap-3">
          <Person person={project.manager} />
          <span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
            Project Manager
          </span>
          <span className="text-xs text-muted-foreground">
            {project.department ?? project.category}
          </span>
        </div>
      </Section>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[780px] text-sm">
          <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
            <tr>
              {[
                "Member",
                "Project Role",
                "Assigned Tasks",
                "Completed",
                "Overdue",
                "Workload",
                "Actions",
              ].map((item) => (
                <th key={item} className="px-4 py-3 text-left font-medium">
                  {item}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {project.team.map((person) => {
              const assigned = tasks.filter((task) => task.assignee.name === person.name);
              const completed = assigned.filter((task) => task.status === "done").length;
              const overdue = assigned.filter(
                (task) => task.status !== "done" && new Date(task.dueDate) < new Date(),
              ).length;
              const state = workload(
                assigned.filter((task) => task.status !== "done").length,
                assigned.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0),
              );
              return (
                <tr
                  key={person.name}
                  onClick={() => setSelectedName(person.name)}
                  className="cursor-pointer border-t border-border hover:bg-accent/40"
                >
                  <td className="px-4 py-3">
                    <Person person={person} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {person.name === project.manager.name ? "Project Manager" : "Member"}
                  </td>
                  <td className="px-4 py-3 text-xs">{assigned.length} Tasks</td>
                  <td className="px-4 py-3 text-xs">{completed} Completed</td>
                  <td className={cn("px-4 py-3 text-xs", overdue && "text-destructive")}>
                    {overdue} Overdue
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-muted px-2 py-1 text-xs">{state}</span>
                  </td>
                  <td className="px-4 py-3">
                    {permissions.manageTeam && person.name !== project.manager.name && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRemoveName(person.name);
                        }}
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <MemberPicker
        open={memberPickerOpen}
        onOpenChange={setMemberPickerOpen}
        selected={project.team}
        onAdd={(people) => {
          onChangeTeam([...project.team, ...people]);
          people.forEach((person) =>
            onLog({ category: "team", actor: "Alex Morgan", action: "added", target: person.name }),
          );
        }}
      />
      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedName(undefined)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader className="text-left">
            <SheetTitle>{selected?.name}</SheetTitle>
            <SheetDescription>Project-specific responsibilities and workload.</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-5">
              <Person person={selected} large />
              <div className="grid grid-cols-2 gap-3">
                <Summary label="Job Title" value="Project Contributor" />
                <Summary label="Department" value={project.department ?? project.category} />
                <Summary
                  label="Project Role"
                  value={selected.name === project.manager.name ? "Project Manager" : "Member"}
                />
                <Summary
                  label="Current Workload"
                  value={workload(
                    memberTasks.filter((task) => task.status !== "done").length,
                    memberTasks.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0),
                  )}
                />
              </div>
              <Section title="Assigned Project Tasks">
                {memberTasks.length ? (
                  memberTasks.map((task) => (
                    <div key={task.id} className="mb-2 rounded-md border border-border p-3">
                      <div className="text-sm font-medium">{task.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {taskStatusLabels[task.status]} · due{" "}
                        {format(new Date(task.dueDate), "MMM d")}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No tasks assigned in this project.
                  </p>
                )}
              </Section>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={Boolean(removeName)}
        onOpenChange={(open) => !open && setRemoveName(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeName}?</AlertDialogTitle>
            <AlertDialogDescription>
              {activeForRemoval.length
                ? `This member currently has ${activeForRemoval.length} active tasks in this project. Reassign tasks before removal.`
                : "This member has no active project tasks."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {activeForRemoval.length ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedName(removeName);
                  setRemoveName(undefined);
                }}
              >
                Reassign Tasks
              </Button>
            ) : (
              <AlertDialogAction
                onClick={() => {
                  onChangeTeam(project.team.filter((person) => person.name !== removeName));
                  onLog({
                    category: "team",
                    actor: "Alex Morgan",
                    action: "removed",
                    target: removeName,
                  });
                  setRemoveName(undefined);
                }}
              >
                Remove Member
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TimelineTab({
  project,
  tasks,
  milestones,
  onChange,
  onOpenCreate,
}: {
  project: WorkspaceProject;
  tasks: WorkspaceTask[];
  milestones: Milestone[];
  onChange: (items: Milestone[]) => void;
  onOpenCreate: () => void;
}) {
  const [mode, setMode] = useState<"timeline" | "milestones">("timeline");
  const [scale, setScale] = useState<"week" | "month" | "fit">("week");
  const start = new Date(project.startDate);
  const days =
    scale === "month"
      ? 30
      : scale === "fit"
        ? Math.max(14, differenceInCalendarDays(new Date(project.deadline), start) + 1)
        : 14;
  const width = scale === "month" ? 36 : scale === "fit" ? 28 : 56;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          <Button
            variant={mode === "timeline" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("timeline")}
          >
            Timeline
          </Button>
          <Button
            variant={mode === "milestones" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("milestones")}
          >
            Milestones
          </Button>
        </div>
        {mode === "milestones" && permissions.manageMilestones && (
          <Button size="sm" onClick={onOpenCreate}>
            <Plus className="h-4 w-4" />
            Add Milestone
          </Button>
        )}
      </div>
      {mode === "timeline" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Project Timeline</h3>
            <div className="flex gap-1">
              <Button variant="outline" size="sm">
                Today
              </Button>
              <Button
                variant={scale === "week" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setScale("week")}
              >
                Week
              </Button>
              <Button
                variant={scale === "month" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setScale("month")}
              >
                Month
              </Button>
              <Button
                variant={scale === "fit" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setScale("fit")}
              >
                Fit Project
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <div style={{ minWidth: 260 + days * width }}>
              <div className="flex border-b border-border bg-muted/20">
                <div className="w-[260px] shrink-0 px-4 py-3 text-[10px] uppercase text-muted-foreground">
                  Work item
                </div>
                <div
                  className="grid"
                  style={{ gridTemplateColumns: `repeat(${days}, ${width}px)` }}
                >
                  {Array.from({ length: days }, (_, index) => addDays(start, index)).map((date) => (
                    <div
                      key={date.toISOString()}
                      className="border-l border-border px-1 py-2 text-center text-[10px] text-muted-foreground"
                    >
                      {format(date, "MMM d")}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                {tasks.map((task) => {
                  const offset = Math.max(
                    0,
                    differenceInCalendarDays(new Date(task.startDate), start),
                  );
                  const duration = Math.max(
                    1,
                    differenceInCalendarDays(new Date(task.dueDate), new Date(task.startDate)) + 1,
                  );
                  const overdue = task.status !== "done" && new Date(task.dueDate) < new Date();
                  return (
                    <div
                      key={task.id}
                      className="flex items-center border-b border-border last:border-0"
                    >
                      <div className="w-[260px] shrink-0 px-4 py-3">
                        <div className="truncate text-xs font-medium">{task.title}</div>
                        {task.dependencies.length > 0 && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <GitBranch className="h-3 w-3" />
                            after {task.dependencies.join(", ")}
                          </div>
                        )}
                      </div>
                      <div className="relative h-12" style={{ width: days * width }}>
                        <div
                          className={cn(
                            "absolute top-3 h-6 rounded-md px-2 text-[10px] leading-6 text-primary-foreground",
                            overdue ? "bg-destructive" : "bg-primary",
                          )}
                          style={{
                            left: Math.min(offset, days - 1) * width,
                            width: Math.max(
                              width - 4,
                              Math.min(duration, days - offset) * width - 4,
                            ),
                          }}
                        >
                          {task.progress}%
                        </div>
                      </div>
                    </div>
                  );
                })}
                {milestones.map((item) => {
                  const offset = Math.max(
                    0,
                    differenceInCalendarDays(new Date(item.targetDate), start),
                  );
                  return (
                    <div
                      key={item.id}
                      className="flex items-center border-b border-border last:border-0"
                    >
                      <div className="w-[260px] shrink-0 px-4 py-3 text-xs font-medium">
                        Milestone · {item.name}
                      </div>
                      <div className="relative h-11" style={{ width: days * width }}>
                        <Flag
                          className={cn(
                            "absolute top-3 h-5 w-5",
                            item.status === "delayed" ? "text-destructive" : "text-primary",
                          )}
                          style={{ left: Math.min(offset, days - 1) * width }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
              <tr>
                {["Milestone", "Owner", "Target Date", "Status", "Progress", "Actions"].map(
                  (item) => (
                    <th key={item} className="px-4 py-3 text-left font-medium">
                      {item}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {milestones.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div className="font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">{item.owner}</td>
                  <td className="px-4 py-3 text-xs">
                    {format(new Date(item.targetDate), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      value={item.status}
                      onValueChange={(status) =>
                        onChange(
                          milestones.map((current) =>
                            current.id === item.id
                              ? { ...current, status: status as Milestone["status"] }
                              : current,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="upcoming">Upcoming</SelectItem>
                        <SelectItem value="progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="delayed">Delayed</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Progress value={item.progress} className="w-20" />
                      <span className="text-xs">{item.progress}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Section title="Upcoming Deadlines">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="pb-2 text-left">Task / Milestone</th>
                <th className="pb-2 text-left">Owner</th>
                <th className="pb-2 text-left">Due Date</th>
                <th className="pb-2 text-left">Days Remaining</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...tasks.map((task) => ({
                  id: task.id,
                  name: task.title,
                  owner: task.assignee.name,
                  date: task.dueDate,
                })),
                ...milestones.map((item) => ({
                  id: item.id,
                  name: item.name,
                  owner: item.owner,
                  date: item.targetDate,
                })),
              ]
                .sort((a, b) => +new Date(a.date) - +new Date(b.date))
                .slice(0, 5)
                .map((item) => (
                  <tr key={item.id} className="border-t border-border">
                    <td className="py-2 font-medium">{item.name}</td>
                    <td className="py-2 text-xs text-muted-foreground">{item.owner}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {format(new Date(item.date), "MMM d")}
                    </td>
                    <td className="py-2 text-xs">
                      {differenceInCalendarDays(new Date(item.date), new Date())} days
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function DocumentsTab({
  documents,
  onChange,
  onLog,
}: {
  documents: DocumentItem[];
  onChange: (items: DocumentItem[]) => void;
  onLog: (activity: Omit<ActivityItem, "id" | "time">) => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [deleteId, setDeleteId] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const filtered = documents.filter(
    (document) =>
      document.name.toLowerCase().includes(query.toLowerCase()) &&
      (type === "all" || document.type === type),
  );
  const upload = (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setTimeout(() => {
      const added = files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        uploadedBy: "Alex Morgan",
        added: format(new Date(), "MMM d"),
        size:
          file.size > 1_000_000
            ? `${(file.size / 1_000_000).toFixed(1)} MB`
            : `${Math.max(1, Math.round(file.size / 1000))} KB`,
        type: file.name.split(".").pop()?.toUpperCase() ?? "File",
      }));
      onChange([...added, ...documents]);
      added.forEach((file) =>
        onLog({
          category: "documents",
          actor: "Alex Morgan",
          action: "uploaded",
          target: file.name,
        }),
      );
      setUploading(false);
      toast.success(`${added.length} document${added.length === 1 ? "" : "s"} uploaded`);
    }, 600);
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          Documents <span className="text-muted-foreground">({documents.length})</span>
        </h3>
        {permissions.manageDocuments && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => upload(Array.from(event.target.files ?? []))}
            />
            <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </>
        )}
      </div>
      {documents.length ? (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search documents"
                className="h-8 w-56 pl-8 text-xs"
              />
            </div>
            <CompactSelect
              value={type}
              onValue={setType}
              options={["all", ...Array.from(new Set(documents.map((document) => document.type)))]}
              label="File Type"
            />
            <CompactSelect
              value="recent"
              onValue={() => undefined}
              options={["recent", "name"]}
              label="Sort"
            />
          </div>
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              upload(Array.from(event.dataTransfer.files));
            }}
            className="overflow-x-auto rounded-xl border border-border bg-card"
          >
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
                <tr>
                  {["Document", "Uploaded By", "Added", "Size", "Actions"].map((item) => (
                    <th key={item} className="px-4 py-3 text-left font-medium">
                      {item}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((document) => (
                  <tr key={document.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{document.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{document.uploadedBy}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{document.added}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{document.size}</td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <FolderOpen />
                            Preview
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Download />
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              const name = window.prompt("Rename document", document.name);
                              if (name?.trim())
                                onChange(
                                  documents.map((item) =>
                                    item.id === document.id ? { ...item, name: name.trim() } : item,
                                  ),
                                );
                            }}
                          >
                            <Edit3 />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => inputRef.current?.click()}>
                            <Upload />
                            Replace File
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteId(document.id)}
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyState
          icon={FileText}
          title="No project documents yet"
          description="Keep project briefs, references and important files together."
          action="Upload Document"
          onAction={() => inputRef.current?.click()}
        />
      )}
      <AlertDialog
        open={Boolean(deleteId)}
        onOpenChange={(open) => !open && setDeleteId(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              The file will be removed from this project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const document = documents.find((item) => item.id === deleteId);
                onChange(documents.filter((item) => item.id !== deleteId));
                if (document)
                  onLog({
                    category: "documents",
                    actor: "Alex Morgan",
                    action: "deleted",
                    target: document.name,
                  });
                setDeleteId(undefined);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ActivityTab({ activities }: { activities: ActivityItem[] }) {
  const [filter, setFilter] = useState<"all" | ActivityItem["category"]>("all");
  const labels = {
    all: "All Activity",
    tasks: "Tasks",
    team: "Team",
    documents: "Documents",
    project: "Project Changes",
  };
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Project Activity</h3>
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {Object.entries(labels).map(([id, label]) => (
          <Button
            key={id}
            variant="ghost"
            size="sm"
            onClick={() => setFilter(id as typeof filter)}
            className={cn(
              "shrink-0 rounded-none border-b-2",
              filter === id ? "border-primary" : "border-transparent text-muted-foreground",
            )}
          >
            {label}
          </Button>
        ))}
      </div>
      <Section title="Activity Timeline">
        <ActivityList
          activities={activities.filter((item) => filter === "all" || item.category === filter)}
          detailed
        />
      </Section>
    </div>
  );
}

function ActivityList({
  activities,
  detailed,
}: {
  activities: ActivityItem[];
  detailed?: boolean;
}) {
  return (
    <div className="space-y-4">
      {activities.map((item) => (
        <div key={item.id} className="flex gap-3">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0 flex-1 text-sm">
            <p>
              <b>{item.actor}</b> {item.action} {item.target && <b>“{item.target}”</b>}
            </p>
            {detailed && item.detail && (
              <p className="mt-1 rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                {item.detail}
              </p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">{item.time}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
function CompactSelect({
  value,
  onValue,
  options,
  label,
}: {
  value: string;
  onValue: (value: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onValue}>
      <SelectTrigger className="h-8 w-auto min-w-28 text-xs">
        <Filter className="h-3.5 w-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option === "all"
              ? `All ${label}`
              : option.replace(/\b\w/g, (letter) => letter.toUpperCase())}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Person({
  person,
  compact,
  large,
}: {
  person: { name: string; initials: string; color: string };
  compact?: boolean;
  large?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground",
          large ? "h-12 w-12 text-sm" : compact ? "h-5 w-5" : "h-7 w-7",
        )}
        style={{ background: person.color }}
      >
        {person.initials}
      </span>
      {!compact && <span className="truncate text-xs font-medium">{person.name}</span>}
    </div>
  );
}
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  onAction,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
      <Icon className="mx-auto h-8 w-8 text-muted-foreground" />
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      <Button size="sm" className="mt-4" onClick={onAction}>
        <Plus className="h-4 w-4" />
        {action}
      </Button>
    </div>
  );
}

function MemberPicker({
  open,
  onOpenChange,
  selected,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: WorkspaceProject["team"];
  onAdd: (people: WorkspaceProject["team"]) => void;
}) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [draft, setDraft] = useState<string[]>([]);
  const directory = allPeople.map((person, index) => ({
    ...person,
    title:
      [
        "Operations Lead",
        "Product Manager",
        "Software Engineer",
        "Creative Director",
        "Finance Analyst",
      ][index] ?? "Team Member",
    department:
      ["Operations", "Technology", "Technology", "Marketing", "Finance"][index] ?? "Operations",
    team: ["Operations", "Product", "Development", "Creative", "Finance"][index] ?? "Operations",
  }));
  const available = directory.filter(
    (person) =>
      !selected.some((item) => item.name === person.name) &&
      (department === "all" || person.department === department || person.team === department) &&
      `${person.name} ${person.title}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Project Members</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              className="pl-9"
            />
          </div>
          <CompactSelect
            value={department}
            onValue={setDepartment}
            options={[
              "all",
              "Operations",
              "Technology",
              "Marketing",
              "Finance",
              "Development",
              "Creative",
            ]}
            label="Department"
          />
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {available.map((person) => (
              <label
                key={person.name}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={draft.includes(person.name)}
                  onChange={(event) =>
                    setDraft((current) =>
                      event.target.checked
                        ? [...current, person.name]
                        : current.filter((name) => name !== person.name),
                    )
                  }
                />
                <Person person={person} />
                <span className="ml-auto text-right text-[10px] text-muted-foreground">
                  {person.title}
                  <br />
                  {person.department}
                </span>
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!draft.length}
            onClick={() => {
              onAdd(directory.filter((person) => draft.includes(person.name)));
              setDraft([]);
              onOpenChange(false);
            }}
          >
            Add Selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditProjectDialog({
  open,
  onOpenChange,
  project,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: WorkspaceProject;
  onSave: (updates: Partial<WorkspaceProject>) => void;
}) {
  return (
    <ProjectFormDialog
      mode="edit"
      open={open}
      onClose={() => onOpenChange(false)}
      nextNumber={0}
      initial={{
        name: project.name,
        description: project.description,
        projectType: project.projectType,
        category: project.category,
        client: project.client,
        manager: project.manager.name,
        department: project.department,
        priority: project.priority,
        creationStatus:
          project.creationStatus === "planning" ||
          project.creationStatus === "on-hold"
            ? project.creationStatus
            : "active",
        startDate: project.startDate,
        deadline: project.deadline,
        teamNames: project.team.map((member) => member.name),
      }}
      onSubmit={(values) => {
        onSave({
          name: values.name,
          description: values.description,
          projectType: values.projectType,
          client: values.client,
          category: values.category,
          manager: values.manager,
          department: values.department,
          priority: values.priority,
          creationStatus: values.creationStatus,
          startDate: values.startDate,
          deadline: values.deadline,
          team: values.team,
          color: values.manager.color,
        });
        onOpenChange(false);
      }}
    />
  );
}

function MilestoneDialog({
  open,
  onOpenChange,
  project,
  tasks,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: WorkspaceProject;
  tasks: WorkspaceTask[];
  onCreate: (milestone: Milestone) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState(project.manager.name);
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<Milestone["status"]>("upcoming");
  const [relatedTasks, setRelatedTasks] = useState<string[]>([]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Milestone</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Milestone Name*</label>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Owner</label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {project.team.map((person) => (
                    <SelectItem key={person.name} value={person.name}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Target Date*</label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Status</label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as Milestone["status"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="delayed">Delayed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Related Tasks</label>
            <div className="max-h-36 space-y-1 overflow-y-auto">
              {tasks.map((task) => (
                <label
                  key={task.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={relatedTasks.includes(task.id)}
                    onChange={(event) =>
                      setRelatedTasks((current) =>
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
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || !date}
            onClick={() => {
              onCreate({
                id: crypto.randomUUID(),
                name: name.trim(),
                description,
                owner,
                targetDate: new Date(date).toISOString(),
                status,
                progress: status === "completed" ? 100 : 0,
                relatedTasks,
              });
              setName("");
              setDescription("");
              setDate("");
              setRelatedTasks([]);
              onOpenChange(false);
              toast.success("Milestone created");
            }}
          >
            Add Milestone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
