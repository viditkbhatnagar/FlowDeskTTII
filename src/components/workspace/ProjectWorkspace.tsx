import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectFormDialog } from "./ProjectsPage";
import { addDays, differenceInCalendarDays, format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
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
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Priority, Status } from "@/lib/mock-data";
import { updateProjectRow } from "@/lib/admin-api";
import { useOrganizations } from "@/lib/organizations-data";
import {
  healthLabel,
  projectHealth,
  projectProgress,
  type ProjectHealth,
} from "@/lib/project-metrics";
import {
  FILE_RULES,
  deleteStoredFile,
  describeActivity,
  fileUrl,
  formatBytes,
  listProjectActivity,
  listProjectDocuments,
  personRef,
  uploadProjectDocuments,
  validateFile,
  type ActivityEntry,
  type PersonRef,
  type StoredFile,
} from "@/lib/task-api";
import { useTaskSettings } from "@/lib/task-settings-data";
import { todayIn } from "@/lib/today";
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
  /** The department or team row behind `department`, handed to the Edit Project form. */
  departmentId?: string | null;
  teamId?: string | null;
  priority?: Priority;
  creationStatus?: "planning" | "active" | "on-hold" | "completed" | "cancelled" | "archived";
  manager: { name: string; initials: string; color: string };
  team: { name: string; initials: string; color: string }[];
  isNew?: boolean;
  /** Owning organization (ProjectsPage passes ProjectExt.orgId). Documents and milestones are stored under it. */
  orgId?: string;
};

type Lifecycle = NonNullable<WorkspaceProject["creationStatus"]>;
type Tab = "overview" | "tasks" | "team" | "timeline" | "documents" | "activity";
type LoadState = "loading" | "ready" | "error";

/**
 * A row of project_milestones. The table stores a title, owner, target date and
 * completion time — nothing else — so status is derived from those rather than
 * picked from a list that could not be saved.
 */
type Milestone = {
  id: string;
  name: string;
  ownerId: string | null;
  /** yyyy-mm-dd, or "" when the milestone has no target date. */
  targetDate: string;
  completedAt: string | null;
};
type MilestoneStatus = "upcoming" | "completed" | "delayed";
type MilestoneInput = {
  name: string;
  ownerId: string | null;
  targetDate: string;
  completed: boolean;
};

/** A person who can be put on the project, with their real department and title. */
type DirectoryPerson = PersonRef & {
  title: string;
  department: string;
  departmentId: string;
  /** Active and in the project's organization, so they can be added to it. */
  eligible: boolean;
};

type ActivityCategory = "tasks" | "documents" | "project";

const permissions = {
  createTasks: true,
  assignTasks: true,
  manageProjects: true,
  manageTeam: true,
  manageMilestones: true,
  manageDocuments: true,
  deleteProjects: true,
};
const statusLabels: Record<Lifecycle, string> = {
  planning: "Planning",
  active: "Active",
  "on-hold": "On Hold",
  completed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
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
const healthStyles: Record<ProjectHealth, string> = {
  completed: "border-status-done/30 bg-status-done/10 text-status-done",
  "on-track": "border-status-done/30 bg-status-done/10 text-status-done",
  "at-risk": "border-priority-medium/30 bg-priority-medium/10 text-priority-medium",
  delayed: "border-destructive/30 bg-destructive/10 text-destructive",
  "no-tasks": "border-border bg-muted text-muted-foreground",
};
const milestoneStatusLabels: Record<MilestoneStatus, string> = {
  upcoming: "Upcoming",
  completed: "Completed",
  delayed: "Delayed",
};
const milestoneStatusStyles: Record<MilestoneStatus, string> = {
  upcoming: "bg-muted text-muted-foreground",
  completed: "bg-status-done/15 text-status-done",
  delayed: "bg-destructive/10 text-destructive",
};

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A date-only value is read as local midnight; `new Date("2026-09-25")` is UTC and shifts a day west of Greenwich. */
function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
/** yyyy-mm-dd, comparable with todayIn(); "" when missing or invalid. */
function dayOf(value?: string | null): string {
  const date = toDate(value);
  return date ? format(date, "yyyy-MM-dd") : "";
}
/** Formats without throwing: a project with no start date used to crash the Overview. */
function formatDay(value: string | null | undefined, pattern: string, fallback = "—"): string {
  const date = toDate(value);
  return date ? format(date, pattern) : fallback;
}
const isOverdue = (task: WorkspaceTask, today: string) => {
  const due = dayOf(task.dueDate);
  return task.status !== "done" && Boolean(due) && due < today;
};
const milestoneStatus = (milestone: Milestone, today: string): MilestoneStatus =>
  milestone.completedAt
    ? "completed"
    : milestone.targetDate && milestone.targetDate < today
      ? "delayed"
      : "upcoming";
const byTargetDate = (a: Milestone, b: Milestone) =>
  (a.targetDate || "9999").localeCompare(b.targetDate || "9999");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/* ------------------------------------------------------------------ */
/* Project records: team, manager, lifecycle and milestones            */
/*                                                                     */
/* The team, milestones, documents and activity on this screen were    */
/* seeded with demo rows and kept in component state, so nothing was   */
/* saved and every project showed the same people (FD-033, FD-034,     */
/* FD-035, FD-057, FD-060). They now read and write the real tables.   */
/* ------------------------------------------------------------------ */

type MilestoneRow = Database["public"]["Tables"]["project_milestones"]["Row"];

interface ProjectRecords {
  organizationId: string | null;
  managerId: string | null;
  lifecycle: Lifecycle | null;
  memberIds: string[];
  milestones: Milestone[];
}

const fromDbStatus = (value: string): Lifecycle =>
  value === "on_hold" ? "on-hold" : (value as Lifecycle);

const toMilestone = (row: MilestoneRow): Milestone => ({
  id: row.id,
  name: row.title,
  ownerId: row.owner_id,
  targetDate: row.due_date ?? dayOf(row.due_at),
  completedAt: row.completed_at,
});

function writeFailed(operation: string, error: unknown): false {
  console.error(`[flowdesk] ${operation} failed`, error);
  return false;
}

async function loadProjectRecords(projectId: string): Promise<ProjectRecords | null> {
  const [projectRow, memberRows, milestoneRows] = await Promise.all([
    supabase
      .from("work_projects")
      .select("organization_id, manager_id, owner_id, status")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .order("created_at"),
    supabase.from("project_milestones").select("*").eq("project_id", projectId),
  ]);
  const failed = [projectRow, memberRows, milestoneRows].find((result) => result.error);
  if (failed?.error) {
    writeFailed("loadProjectRecords", failed.error);
    return null;
  }
  const row = projectRow.data;
  return {
    organizationId: row?.organization_id ?? null,
    managerId: row?.manager_id ?? row?.owner_id ?? null,
    // Re-read rather than trusted from the list, which can be minutes old: a
    // project marked Completed must be labelled Completed here (FD-056).
    lifecycle: row ? fromDbStatus(row.status) : null,
    memberIds: (memberRows.data ?? []).map((member) => member.user_id),
    milestones: (milestoneRows.data ?? []).map(toMilestone).sort(byTargetDate),
  };
}

async function insertMilestone(
  input: MilestoneInput & { projectId: string; organizationId: string },
): Promise<Milestone | null> {
  const { data, error } = await supabase
    .from("project_milestones")
    .insert({
      organization_id: input.organizationId,
      project_id: input.projectId,
      title: input.name,
      owner_id: input.ownerId,
      due_date: input.targetDate,
      completed_at: input.completed ? new Date().toISOString() : null,
    })
    .select("*")
    .single();
  if (error) {
    writeFailed("insertMilestone", error);
    return null;
  }
  return toMilestone(data);
}

async function setMilestoneCompletion(id: string, completed: boolean): Promise<boolean> {
  const { error } = await supabase
    .from("project_milestones")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", id);
  return error ? writeFailed("setMilestoneCompletion", error) : true;
}

async function deleteMilestoneRow(id: string): Promise<boolean> {
  const { error } = await supabase.from("project_milestones").delete().eq("id", id);
  return error ? writeFailed("deleteMilestone", error) : true;
}

async function addProjectMembers(projectId: string, userIds: string[]): Promise<boolean> {
  if (!userIds.length) return true;
  const { error } = await supabase.from("project_members").upsert(
    userIds.map((userId) => ({ project_id: projectId, user_id: userId })),
    { onConflict: "project_id,user_id", ignoreDuplicates: true },
  );
  return error ? writeFailed("addProjectMembers", error) : true;
}

async function removeProjectMembers(projectId: string, userIds: string[]): Promise<boolean> {
  if (!userIds.length) return true;
  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", projectId)
    .in("user_id", userIds);
  return error ? writeFailed("removeProjectMembers", error) : true;
}

/** Opens a private file through a short-lived signed link. */
async function openStoredFile(file: StoredFile, download: boolean) {
  // The tab is opened before the await: one opened after it counts as a popup
  // and is blocked, which is why Preview appeared to do nothing (FD-060).
  const preview = download ? null : window.open("", "_blank");
  const url = await fileUrl(file, download);
  if (!url) {
    preview?.close();
    toast.error(`${file.name} could not be opened.`);
    return;
  }
  if (download) {
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.rel = "noopener";
    link.click();
    return;
  }
  if (preview) {
    preview.opener = null;
    preview.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
}

const fileType = (file: StoredFile) =>
  /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toUpperCase() ?? "File";

const activityCategory = (entry: ActivityEntry): ActivityCategory =>
  entry.taskId || entry.type.startsWith("task_")
    ? "tasks"
    : entry.type === "project_document_added"
      ? "documents"
      : "project";

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

export function ProjectWorkspace({
  project: initialProject,
  onBack,
  onDuplicate,
  onDelete,
  onUpdated,
}: {
  project: WorkspaceProject;
  onBack: () => void;
  onDuplicate?: (project: WorkspaceProject) => void;
  onDelete?: (projectId: string) => void;
  /** Called after an edit is saved, so the Projects list can show it without a reload. */
  onUpdated?: (project: WorkspaceProject) => void;
}) {
  const { tasks, people, updateTask, deleteTask } = useWorkspace();
  const { organizations, users, departments } = useOrganizations();
  const [project, setProject] = useState(initialProject);
  const [sourceId, setSourceId] = useState(initialProject.id);
  const [tab, setTab] = useState<Tab>("overview");
  const [taskOpen, setTaskOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [detailVariant, setDetailVariant] = useState<"sheet" | "modal">("sheet");
  const [showSetup, setShowSetup] = useState(initialProject.isNew ?? true);
  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [milestoneOpen, setMilestoneOpen] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [records, setRecords] = useState<ProjectRecords | null>(null);
  const [recordsState, setRecordsState] = useState<LoadState>("loading");
  const [recordsVersion, setRecordsVersion] = useState(0);
  const [documents, setDocuments] = useState<StoredFile[]>([]);
  const [documentsState, setDocumentsState] = useState<LoadState>("loading");
  const [documentsVersion, setDocumentsVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityState, setActivityState] = useState<LoadState>("loading");
  const [activityVersion, setActivityVersion] = useState(0);

  // ProjectsPage swaps the project in place — Duplicate, or a new project
  // receiving its real id — without remounting this screen. Follow it, or the
  // copy would show the original's team, milestones and files (FD-035).
  if (initialProject.id !== sourceId) {
    setSourceId(initialProject.id);
    setProject(initialProject);
    setRecords(null);
    setRecordsState("loading");
    setDocuments([]);
    setDocumentsState("loading");
    setActivity([]);
    setActivityState("loading");
  }

  // A project created on this screen has a placeholder id until its row is saved.
  const isSaved = UUID_PATTERN.test(project.id);

  useEffect(() => {
    if (!isSaved) return;
    let active = true;
    void loadProjectRecords(project.id).then((result) => {
      if (!active) return;
      if (!result) {
        setRecordsState((state) => (state === "ready" ? state : "error"));
        return;
      }
      setRecords(result);
      setRecordsState("ready");
      const lifecycle = result.lifecycle;
      if (lifecycle) {
        setProject((current) =>
          current.creationStatus === lifecycle
            ? current
            : { ...current, creationStatus: lifecycle },
        );
      }
    });
    return () => {
      active = false;
    };
  }, [project.id, isSaved, recordsVersion]);

  useEffect(() => {
    if (!isSaved) return;
    let active = true;
    void listProjectDocuments(project.id).then((rows) => {
      if (!active) return;
      if (!rows) {
        setDocumentsState((state) => (state === "ready" ? state : "error"));
        return;
      }
      setDocuments(rows);
      setDocumentsState("ready");
    });
    return () => {
      active = false;
    };
  }, [project.id, isSaved, documentsVersion]);

  useEffect(() => {
    if (!isSaved) return;
    let active = true;
    void listProjectActivity(project.id, 100).then((rows) => {
      if (!active) return;
      if (!rows) {
        setActivityState((state) => (state === "ready" ? state : "error"));
        return;
      }
      setActivity(rows);
      setActivityState("ready");
    });
    return () => {
      active = false;
    };
  }, [project.id, isSaved, activityVersion]);

  // Task edits made anywhere (drawer, board, another screen) announce themselves;
  // the database logs them, so re-read the feed rather than inventing entries.
  useEffect(() => {
    const refreshActivity = () => setActivityVersion((version) => version + 1);
    window.addEventListener("flowdesk-work-changed", refreshActivity);
    return () => window.removeEventListener("flowdesk-work-changed", refreshActivity);
  }, []);

  const refreshActivity = () => setActivityVersion((version) => version + 1);

  // By project id only, exactly as loadProjects() counts them for the card and
  // the Dashboard; the old name fallback could count a namesake's tasks (FD-014).
  const projectTasks = useMemo(
    () => tasks.filter((task) => task.projectId === project.id),
    [tasks, project.id],
  );
  const organizationId =
    records?.organizationId ??
    project.orgId ??
    projectTasks.find((task) => task.organizationId)?.organizationId ??
    null;
  const timezone = organizations.find((org) => org.id === organizationId)?.timezone;
  const today = todayIn(timezone);

  const personById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const personFor = useCallback(
    (id: string | null | undefined): PersonRef =>
      (id ? personById.get(id) : undefined) ?? personRef(id, null),
    [personById],
  );
  const manager: PersonRef = records?.managerId
    ? personFor(records.managerId)
    : { id: "", ...project.manager };
  const team: PersonRef[] = useMemo(
    () => (records ? records.memberIds.map(personFor) : []),
    [records, personFor],
  );
  const teamCount = records ? team.length : project.team.length;
  const milestones = records?.milestones ?? [];

  // Every real user, with their department and title. The picker listed six
  // demo people (FD-034). Only active members of the project's organization
  // can be added; the rest stay listed so existing members keep their details.
  const directory = useMemo<DirectoryPerson[]>(() => {
    const userById = new Map(users.map((user) => [user.id, user]));
    return people.map((person) => {
      const user = userById.get(person.id);
      const membership = organizationId
        ? user?.memberships.find((item) => item.orgId === organizationId)
        : user?.memberships[0];
      const department = departments.find((item) => item.id === membership?.departmentId);
      return {
        ...person,
        title: user?.designation || membership?.role || "",
        department: department?.name ?? "",
        departmentId: department?.id ?? "",
        // Unknown to the admin snapshot means we cannot tell, so they are kept
        // (the same rule as the Edit Project pickers).
        eligible: !user || (user.status !== "inactive" && (!organizationId || Boolean(membership))),
      };
    });
  }, [people, users, departments, organizationId]);

  // The single progress and health calculation, shared with the Projects cards
  // and the Dashboard. This screen used to compute its own and disagreed with
  // both (FD-014), and called finished projects "On Track" (FD-056).
  const progress = projectProgress(projectTasks);
  const inProgress = projectTasks.filter((task) => task.status === "progress").length;
  const overdue = projectTasks.filter((task) => isOverdue(task, today)).length;
  const deadlineDay = dayOf(project.deadline);
  const health = projectHealth({
    progress,
    dueDate: deadlineDay,
    today,
    lifecycle: project.creationStatus,
    overdueTasks: overdue,
  });
  const healthReason: Record<ProjectHealth, string> = {
    completed:
      project.creationStatus === "completed"
        ? "The project is marked Completed."
        : "Every task in this project is done.",
    "no-tasks": "There are no tasks yet, so there is nothing to measure.",
    delayed: [
      overdue ? `${plural(overdue, "task")} past due.` : "",
      deadlineDay && deadlineDay < today
        ? "The project deadline has passed with work still open."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    "at-risk": "The deadline is within 14 days and less than half of the tasks are done.",
    "on-track": "No overdue work, and the deadline is not at risk.",
  };

  const setupItems = [
    true,
    milestones.length > 0,
    projectTasks.length > 0,
    team.some((person) => person.id !== manager.id),
    documents.length > 0,
  ];
  const setupComplete = setupItems.filter(Boolean).length;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const taskTitles = useMemo(() => new Map(tasks.map((task) => [task.id, task.title])), [tasks]);

  const ensureSaved = () => {
    if (isSaved) return true;
    toast.error("This project is still being saved. Try again in a moment.");
    return false;
  };
  /** Tells the Projects list, with the people as saved rather than as first opened. */
  const publish = (next: WorkspaceProject) =>
    onUpdated?.(records ? { ...next, manager, team } : next);

  const changeStatus = async (value: WorkspaceProject["creationStatus"]) => {
    if (!value || value === project.creationStatus || !ensureSaved()) return;
    const before = project;
    const next = { ...project, creationStatus: value };
    setProject(next);
    // Was component state only, logged as "Alex Morgan". Saved now, and the
    // database records the change under the signed-in user (FD-033).
    if (!(await updateProjectRow(project.id, { status: value }))) {
      setProject(before);
      toast.error("The project status could not be saved.");
      return;
    }
    toast.success(`Project moved to ${statusLabels[value]}`);
    refreshActivity();
    publish(next);
  };

  /**
   * Mirrors an edit the Edit Project form has already saved. The form writes
   * work_projects and project_members itself, by id, before calling back; this
   * screen used to write the same edit a second time and re-sync the team by
   * name, which is not unique (FD-033, FD-034).
   */
  const applyEdit = (
    updates: Partial<WorkspaceProject>,
    saved: { managerId?: string | null; memberIds?: string[] },
  ) => {
    const next = { ...project, ...updates };
    setProject(next);
    setRecords((current) =>
      current
        ? {
            ...current,
            managerId: saved.managerId ?? current.managerId,
            memberIds: saved.memberIds ?? current.memberIds,
          }
        : current,
    );
    // Re-read what was stored, and the "edited the project" entry it logged.
    setRecordsVersion((version) => version + 1);
    refreshActivity();
    toast.success("Project updated");
    onUpdated?.(next);
  };

  const addTeamMembers = async (ids: string[]) => {
    if (!ids.length || !ensureSaved()) return false;
    if (!(await addProjectMembers(project.id, ids))) {
      toast.error("Members could not be added. Only managers can change a project team.");
      return false;
    }
    setRecords((current) =>
      current
        ? {
            ...current,
            memberIds: [
              ...current.memberIds,
              ...ids.filter((id) => !current.memberIds.includes(id)),
            ],
          }
        : current,
    );
    toast.success(`${plural(ids.length, "member")} added`);
    return true;
  };

  const removeTeamMember = async (id: string) => {
    if (!ensureSaved()) return false;
    if (!(await removeProjectMembers(project.id, [id]))) {
      toast.error("The member could not be removed.");
      return false;
    }
    setRecords((current) =>
      current
        ? { ...current, memberIds: current.memberIds.filter((memberId) => memberId !== id) }
        : current,
    );
    toast.success(`${personFor(id).name} removed from the project`);
    return true;
  };

  const createMilestone = async (input: MilestoneInput) => {
    if (!ensureSaved()) return false;
    if (!organizationId) {
      toast.error("This project's organization is unknown, so the milestone cannot be saved.");
      return false;
    }
    const milestone = await insertMilestone({ ...input, projectId: project.id, organizationId });
    if (!milestone) {
      toast.error("The milestone could not be saved.");
      return false;
    }
    setRecords((current) =>
      current
        ? { ...current, milestones: [...current.milestones, milestone].sort(byTargetDate) }
        : current,
    );
    toast.success("Milestone created");
    return true;
  };

  const completeMilestone = async (milestone: Milestone, completed: boolean) => {
    if (!(await setMilestoneCompletion(milestone.id, completed))) {
      toast.error("The milestone could not be updated.");
      return;
    }
    setRecords((current) =>
      current
        ? {
            ...current,
            milestones: current.milestones.map((item) =>
              item.id === milestone.id
                ? { ...item, completedAt: completed ? new Date().toISOString() : null }
                : item,
            ),
          }
        : current,
    );
    toast.success(completed ? "Milestone completed" : "Milestone reopened");
    refreshActivity();
  };

  const removeMilestone = async (milestone: Milestone) => {
    if (!(await deleteMilestoneRow(milestone.id))) {
      toast.error("The milestone could not be deleted.");
      return false;
    }
    setRecords((current) =>
      current
        ? { ...current, milestones: current.milestones.filter((item) => item.id !== milestone.id) }
        : current,
    );
    toast.success("Milestone deleted");
    return true;
  };

  const uploadDocuments = async (files: File[]) => {
    if (!files.length || uploading || !ensureSaved()) return;
    if (!organizationId) {
      toast.error("This project's organization is unknown, so files cannot be stored.");
      return;
    }
    // Checked before anything is sent: .html, empty and oversized files used to
    // be "uploaded" instantly (FD-066).
    const invalid = files.flatMap((file) => {
      const reason = validateFile(file);
      return reason ? [{ name: file.name, reason }] : [];
    });
    const valid = files.filter((file) => !validateFile(file));
    let uploaded: StoredFile[] = [];
    let rejected = invalid;
    if (valid.length) {
      setUploading(true);
      try {
        const result = await uploadProjectDocuments({ id: project.id, organizationId }, valid);
        uploaded = result.uploaded;
        rejected = [...invalid, ...result.rejected];
      } catch (error) {
        console.error("[flowdesk] project document upload failed", error);
        rejected = [
          ...invalid,
          ...valid.map((file) => ({ name: file.name, reason: "could not be uploaded" })),
        ];
      } finally {
        setUploading(false);
      }
    }
    if (uploaded.length) {
      // Stored in project-documents and project_documents, so they survive a
      // reload. They used to exist only in this component (FD-057).
      setDocuments((current) => [...uploaded, ...current]);
      setDocumentsState("ready");
      toast.success(`${plural(uploaded.length, "document")} uploaded`);
      refreshActivity();
    }
    if (rejected.length) {
      toast.error(`${plural(rejected.length, "file")} not uploaded`, {
        description: rejected.map((item) => `${item.name} ${item.reason}.`).join(" "),
      });
    }
  };

  const removeDocument = async (file: StoredFile) => {
    if (!(await deleteStoredFile(file))) {
      toast.error(`${file.name} could not be deleted.`);
      return false;
    }
    setDocuments((current) => current.filter((item) => item.id !== file.id));
    toast.success("Document deleted");
    return true;
  };

  const openTask = (task: WorkspaceTask, variant: "sheet" | "modal") => {
    setSelectedTaskId(task.id);
    setDetailVariant(variant);
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
                {/* Same reference, type and client as the Projects card. It said
                    "Internal · Technology" beside a card naming a client (FD-014),
                    and left a dangling "·" for a project with no department. */}
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    project.projectId ?? project.id.slice(0, 8).toUpperCase(),
                    project.projectType === "client"
                      ? project.client && project.client !== "Internal"
                        ? project.client
                        : "Client"
                      : "Internal",
                    project.department || project.category,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={project.creationStatus ?? "active"}
                onValueChange={(value) => void changeStatus(value as Lifecycle)}
              >
                <SelectTrigger className="h-9 w-[120px] text-xs" aria-label="Project status">
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
                    tabIndex={0}
                    className={cn(
                      "inline-flex h-8 items-center whitespace-nowrap rounded-md border px-2 text-[11px] font-medium",
                      healthStyles[health],
                    )}
                  >
                    {healthLabel[health]}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{healthReason[health]}</TooltipContent>
              </Tooltip>
              {permissions.createTasks && (
                <Button size="sm" onClick={() => setTaskOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Add Task
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => ensureSaved() && setEditOpen(true)}
              >
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
                  {/* "Change Status" silently put the project On Hold whatever
                      its status; it now offers the statuses to pick from. */}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ChevronDown />
                      Change Status
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                          value={project.creationStatus ?? "active"}
                          onValueChange={(value) => void changeStatus(value as Lifecycle)}
                        >
                          {Object.entries(statusLabels).map(([value, label]) => (
                            <DropdownMenuRadioItem key={value} value={value}>
                              {label}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                  {/* No toast here: the copy is created asynchronously by the
                      Projects page, which opens it when it exists and reports a
                      failure. "Project duplicated" used to show even when it failed. */}
                  <DropdownMenuItem onSelect={() => onDuplicate?.(project)}>
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
          <nav
            className="flex overflow-x-auto border-t border-border px-5"
            aria-label="Project sections"
          >
            {(["overview", "tasks", "team", "timeline", "documents", "activity"] as Tab[]).map(
              (item) => (
                <Button
                  key={item}
                  variant="ghost"
                  onClick={() => setTab(item)}
                  aria-current={tab === item ? "page" : undefined}
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

        {/* Not <main>: the workspace shell (routes/_authenticated/index.tsx) already
            provides the page's main landmark, and nesting a second one is an
            accessibility violation — a screen reader offers two "main" regions
            and neither is the whole page. */}
        <div className="mx-auto w-full max-w-6xl pb-8">
          {tab === "overview" && (
            <OverviewTab
              project={project}
              manager={manager}
              teamCount={teamCount}
              tasks={projectTasks}
              today={today}
              milestones={milestones}
              activity={activity}
              activityState={activityState}
              taskTitles={taskTitles}
              percent={progress.percent}
              completed={progress.done}
              total={progress.total}
              inProgress={inProgress}
              overdue={overdue}
              health={health}
              showSetup={showSetup && setupComplete < 5}
              setupItems={setupItems}
              onDismiss={() => setShowSetup(false)}
              onNavigate={setTab}
              onAddTask={() => setTaskOpen(true)}
              onEdit={() => setEditOpen(true)}
              onRetryActivity={refreshActivity}
            />
          )}
          {tab === "tasks" && (
            <TasksTab
              tasks={projectTasks}
              today={today}
              onAdd={() => setTaskOpen(true)}
              onSelect={(task, view) => openTask(task, view === "board" ? "modal" : "sheet")}
              onUpdate={(id, updates) => void updateTask(id, updates)}
              onDelete={async (task) => {
                const ok = await deleteTask(task.id);
                if (ok) toast.success(`“${task.title}” deleted`);
                return ok;
              }}
            />
          )}
          {tab === "team" && (
            <TeamTab
              project={project}
              manager={manager}
              team={team}
              state={isSaved ? recordsState : "loading"}
              directory={directory}
              tasks={projectTasks}
              today={today}
              onAdd={addTeamMembers}
              onRemove={removeTeamMember}
              onRetry={() => setRecordsVersion((version) => version + 1)}
              memberPickerOpen={memberPickerOpen}
              setMemberPickerOpen={setMemberPickerOpen}
            />
          )}
          {tab === "timeline" && (
            <TimelineTab
              project={project}
              tasks={projectTasks}
              milestones={milestones}
              state={isSaved ? recordsState : "loading"}
              today={today}
              personFor={personFor}
              onOpenCreate={() => setMilestoneOpen(true)}
              onComplete={completeMilestone}
              onDelete={removeMilestone}
            />
          )}
          {tab === "documents" && (
            <DocumentsTab
              documents={documents}
              state={isSaved ? documentsState : "loading"}
              uploading={uploading}
              onUpload={uploadDocuments}
              onDelete={removeDocument}
              onRetry={() => setDocumentsVersion((version) => version + 1)}
            />
          )}
          {tab === "activity" && (
            <ActivityTab
              activity={activity}
              state={isSaved ? activityState : "loading"}
              taskTitles={taskTitles}
              onRetry={refreshActivity}
            />
          )}
        </div>

        <NewTaskDialog
          open={taskOpen}
          onClose={() => setTaskOpen(false)}
          projectName={project.name}
          projectId={isSaved ? project.id : undefined}
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
          manager={manager}
          team={team}
          memberIds={records?.memberIds}
          onSaved={applyEdit}
        />
        <MilestoneDialog
          open={milestoneOpen}
          onOpenChange={setMilestoneOpen}
          owners={[manager, ...team.filter((person) => person.id !== manager.id)].filter(
            (person) => person.id,
          )}
          defaultOwnerId={manager.id || null}
          onCreate={createMilestone}
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
                  } else void changeStatus("archived");
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

function StateMessage({
  state,
  loading,
  error,
  onRetry,
}: {
  state: LoadState;
  loading: string;
  error: string;
  onRetry?: () => void;
}) {
  if (state === "loading") {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground" role="status">
        {loading}
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center" role="alert">
      <p className="text-sm text-muted-foreground">{error}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" />
          Try again
        </Button>
      )}
    </div>
  );
}

function OverviewTab({
  project,
  manager,
  teamCount,
  tasks,
  today,
  milestones,
  activity,
  activityState,
  taskTitles,
  percent,
  completed,
  total,
  inProgress,
  overdue,
  health,
  showSetup,
  setupItems,
  onDismiss,
  onNavigate,
  onAddTask,
  onEdit,
  onRetryActivity,
}: {
  project: WorkspaceProject;
  manager: PersonRef;
  teamCount: number;
  tasks: WorkspaceTask[];
  today: string;
  milestones: Milestone[];
  activity: ActivityEntry[];
  activityState: LoadState;
  taskTitles: Map<string, string>;
  percent: number;
  completed: number;
  total: number;
  inProgress: number;
  overdue: number;
  health: ProjectHealth;
  showSetup: boolean;
  setupItems: boolean[];
  onDismiss: () => void;
  onNavigate: (tab: Tab) => void;
  onAddTask: () => void;
  onEdit: () => void;
  onRetryActivity: () => void;
}) {
  const { statusLabel } = useTaskSettings();
  const labels: [string, Tab][] = [
    ["Basic Project Information", "overview"],
    ["Add Milestones", "timeline"],
    ["Create Tasks", "tasks"],
    ["Confirm Project Team", "team"],
    ["Add Project Documents", "documents"],
  ];
  const weekAhead = format(addDays(toDate(today) ?? new Date(), 7), "yyyy-MM-dd");
  const dueSoon = tasks.filter((task) => {
    const due = dayOf(task.dueDate);
    return task.status !== "done" && due >= today && due <= weekAhead;
  }).length;
  const review = tasks.filter((task) => task.status === "review").length;
  const issues = [
    {
      show: overdue > 0,
      label: `${plural(overdue, "overdue task")}`,
      tab: "tasks" as Tab,
      tone: "text-destructive",
    },
    {
      show: dueSoon > 0,
      label: `${plural(dueSoon, "task")} due this week`,
      tab: "tasks" as Tab,
      tone: "text-priority-medium",
    },
    {
      show: review > 0,
      label: `${plural(review, "task")} in ${statusLabel("review")}`,
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
        <p className="max-w-4xl whitespace-pre-line text-sm leading-6 text-muted-foreground">
          {project.description || "No project description has been added yet."}
        </p>
      </section>
      <Section title="Project Summary">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Summary label="Manager" value={manager.name} />
          <Summary
            label="Timeline"
            value={`${formatDay(project.startDate, "MMM d")} – ${formatDay(project.deadline, "MMM d, yyyy")}`}
          />
          <Summary label="Priority" value={project.priority ?? "Medium"} capitalize />
          <Summary label="Team" value={plural(teamCount, "Member")} />
          <Summary label="Status" value={statusLabels[project.creationStatus ?? "active"]} />
        </div>
      </Section>
      <Section title="Project Progress">
        {total ? (
          <>
            <div className="mb-2 flex items-end justify-between">
              <span className="text-xl font-semibold">{percent}% Complete</span>
              <span className="text-xs text-muted-foreground">Calculated from tasks</span>
            </div>
            <Progress value={percent} className="h-2.5" aria-label={`${percent}% complete`} />
            <div className="mt-3 flex flex-wrap gap-5 text-xs text-muted-foreground">
              <span>
                <b className="text-foreground">
                  {completed} / {total}
                </b>{" "}
                {statusLabel("done")}
              </span>
              <span>
                <b className="text-foreground">{inProgress}</b> {statusLabel("progress")}
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
          {milestones.length ? (
            <div className="space-y-3">
              {milestones.slice(0, 4).map((item) => {
                const status = milestoneStatus(item, today);
                return (
                  <div key={item.id} className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border",
                        status === "completed" &&
                          "border-status-done bg-status-done text-primary-foreground",
                        status === "delayed" && "border-destructive",
                      )}
                    >
                      {status === "completed" && <Check className="h-3 w-3" />}
                    </span>
                    <div className="flex-1">
                      <div className="text-sm font-medium">{item.name}</div>
                      <div
                        className={cn(
                          "whitespace-nowrap text-xs text-muted-foreground",
                          status === "delayed" && "text-destructive",
                        )}
                      >
                        {status === "completed"
                          ? `Completed ${formatDay(item.completedAt, "MMM d")}`
                          : `${status === "delayed" ? "Delayed · due" : "Target"} ${formatDay(item.targetDate, "MMM d")}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No milestones have been added yet.</p>
          )}
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
                <div className="text-sm font-medium">Nothing needs attention</div>
                <p className="text-xs text-muted-foreground">
                  No overdue, due-this-week or waiting tasks. Project health: {healthLabel[health]}.
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
        <ActivityList
          entries={activity.slice(0, 5)}
          state={activityState}
          taskTitles={taskTitles}
          onRetry={onRetryActivity}
        />
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

const TASK_VIEW_KEY = "project-task-view";

function readTaskView(): "list" | "board" {
  try {
    return window.localStorage.getItem(TASK_VIEW_KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

function TasksTab({
  tasks,
  today,
  onAdd,
  onSelect,
  onUpdate,
  onDelete,
}: {
  tasks: WorkspaceTask[];
  today: string;
  onAdd: () => void;
  onSelect: (task: WorkspaceTask, view: "list" | "board") => void;
  onUpdate: (id: string, updates: Partial<WorkspaceTask>) => void;
  onDelete: (task: WorkspaceTask) => Promise<boolean>;
}) {
  const { statusLabel } = useTaskSettings();
  const [view, setViewState] = useState<"list" | "board">(() =>
    typeof window === "undefined" ? "list" : readTaskView(),
  );
  const [bucket, setBucket] = useState<Status | "all" | "overdue">("all");
  const [query, setQuery] = useState("");
  const [assignee, setAssignee] = useState("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [sort, setSort] = useState("due");
  const [dragId, setDragId] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceTask>();
  const [deleting, setDeleting] = useState(false);
  const setView = (value: "list" | "board") => {
    setViewState(value);
    try {
      window.localStorage.setItem(TASK_VIEW_KEY, value);
    } catch {
      // Storage can be unavailable (private mode); the choice just isn't remembered.
    }
  };
  const counts = {
    all: tasks.length,
    todo: tasks.filter((task) => task.status === "todo").length,
    progress: tasks.filter((task) => task.status === "progress").length,
    review: tasks.filter((task) => task.status === "review").length,
    done: tasks.filter((task) => task.status === "done").length,
    overdue: tasks.filter((task) => isOverdue(task, today)).length,
  };
  // By id: two people with the same name used to share one filter entry.
  const assigneeKey = (task: WorkspaceTask) => task.assigneeId ?? "unassigned";
  const assigneeNames = Object.fromEntries(
    tasks.map((task) => [assigneeKey(task), task.assignee.name]),
  );
  const filtered = tasks
    .filter(
      (task) =>
        (bucket === "all" ||
          (bucket === "overdue" ? isOverdue(task, today) : task.status === bucket)) &&
        (assignee === "all" || assigneeKey(task) === assignee) &&
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
            { id: "todo", label: statusLabel("todo") },
            { id: "progress", label: statusLabel("progress") },
            { id: "review", label: statusLabel("review") },
            { id: "done", label: statusLabel("done") },
            { id: "overdue", label: "Overdue" },
          ] as const
        ).map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            onClick={() => setBucket(item.id)}
            aria-pressed={bucket === item.id}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-none border-b-2",
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
              aria-label="Search tasks"
              className="h-8 w-48 pl-8 text-xs"
            />
          </div>
          <CompactSelect
            value={assignee}
            onValue={setAssignee}
            options={["all", ...Object.keys(assigneeNames)]}
            labels={assigneeNames}
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
            labels={{ due: "Due date", priority: "Priority" }}
            label="Sort"
          />
        </div>
        <div className="inline-flex w-fit rounded-lg border border-border bg-card p-1">
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
          >
            <List className="h-4 w-4" />
            List
          </Button>
          <Button
            variant={view === "board" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("board")}
            aria-pressed={view === "board"}
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
                    <th key={item} className="whitespace-nowrap px-4 py-3 text-left font-medium">
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
                    <div className="text-[10px] text-muted-foreground">{task.id.slice(0, 8)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Person person={task.assignee} />
                  </td>
                  <td className="px-4 py-3">
                    {/* nowrap: "In Progress" broke onto two lines (FD-048). */}
                    <span
                      className={cn(
                        "inline-block whitespace-nowrap rounded-md px-2 py-1 text-[10px]",
                        taskStatusStyles[task.status],
                      )}
                    >
                      {statusLabel(task.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-block whitespace-nowrap rounded-md px-2 py-1 text-[10px] capitalize",
                        priorityStyles[task.priority],
                      )}
                    >
                      {task.priority}
                    </span>
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-4 py-3 text-xs",
                      isOverdue(task, today) ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {formatDay(task.dueDate, "MMM d")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Progress
                        value={task.progress}
                        className="w-20"
                        aria-label={`${task.progress}% done`}
                      />
                      <span className="whitespace-nowrap text-xs">{task.progress}%</span>
                    </div>
                  </td>
                  {/* The "…" opened the drawer like the rest of the row; it is an
                      actions menu now, with Edit and Delete (FD-006). */}
                  <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${task.title}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onSelect(task, "list")}>
                          <FolderOpen />
                          Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onSelect(task, "list")}>
                          <Edit3 />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setDeleteTarget(task)}
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
          {!filtered.length && (
            <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No tasks match these filters.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(["todo", "progress", "review", "done"] as Status[]).map((status) => (
            <div
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                // Status only: progress is derived from the status and subtasks.
                if (dragId) onUpdate(dragId, { status });
                setDragId(undefined);
              }}
              className="min-h-[320px] rounded-xl border border-border bg-muted/20 p-3"
            >
              <div className="mb-3 flex items-center justify-between text-xs font-semibold">
                <span className="whitespace-nowrap">{statusLabel(status)}</span>
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
                            "whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] capitalize",
                            priorityStyles[task.priority],
                          )}
                        >
                          {task.priority}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span
                          className={cn(
                            "whitespace-nowrap",
                            isOverdue(task, today) && "text-destructive",
                          )}
                        >
                          {formatDay(task.dueDate, "MMM d")}
                        </span>
                        <span className="whitespace-nowrap">
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
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              Delete “{deleteTarget?.title}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The task is removed from every list and board. Its history is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (event) => {
                // Stay open until the database answers, so a refusal is not hidden.
                event.preventDefault();
                if (!deleteTarget) return;
                setDeleting(true);
                const ok = await onDelete(deleteTarget);
                setDeleting(false);
                if (ok) setDeleteTarget(undefined);
              }}
            >
              {deleting ? "Deleting…" : "Delete Task"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TeamTab({
  project,
  manager,
  team,
  state,
  directory,
  tasks,
  today,
  onAdd,
  onRemove,
  onRetry,
  memberPickerOpen,
  setMemberPickerOpen,
}: {
  project: WorkspaceProject;
  manager: PersonRef;
  team: PersonRef[];
  state: LoadState;
  directory: DirectoryPerson[];
  tasks: WorkspaceTask[];
  today: string;
  onAdd: (ids: string[]) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
  onRetry: () => void;
  memberPickerOpen: boolean;
  setMemberPickerOpen: (open: boolean) => void;
}) {
  const { statusLabel } = useTaskSettings();
  const [selectedId, setSelectedId] = useState<string>();
  const [removeId, setRemoveId] = useState<string>();
  const [removing, setRemoving] = useState(false);
  const selected = team.find((person) => person.id === selectedId);
  const selectedProfile = directory.find((person) => person.id === selectedId);
  const removeTarget = team.find((person) => person.id === removeId);
  const memberTasks = tasks.filter((task) => task.assigneeId === selectedId);
  const activeForRemoval = tasks.filter(
    (task) => task.assigneeId === removeId && task.status !== "done",
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
          <span className="text-muted-foreground">({plural(team.length, "Member")})</span>
        </h3>
        {permissions.manageTeam && (
          <Button size="sm" onClick={() => setMemberPickerOpen(true)} disabled={state !== "ready"}>
            <UserPlus className="h-4 w-4" />
            Add Member
          </Button>
        )}
      </div>
      <Section title="Project Manager">
        <div className="flex items-center gap-3">
          <Person person={manager} />
          <span className="whitespace-nowrap rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
            Project Manager
          </span>
          <span className="text-xs text-muted-foreground">
            {directory.find((person) => person.id === manager.id)?.department ||
              project.department ||
              project.category}
          </span>
        </div>
      </Section>
      {state !== "ready" ? (
        <div className="rounded-xl border border-border bg-card">
          <StateMessage
            state={state}
            loading="Loading the project team…"
            error="The project team could not be loaded."
            onRetry={onRetry}
          />
        </div>
      ) : team.length ? (
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
                  <th key={item} className="whitespace-nowrap px-4 py-3 text-left font-medium">
                    {item}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.map((person) => {
                // Matched by id: names are not unique, and the old name match
                // counted another person's tasks against a namesake.
                const assigned = tasks.filter((task) => task.assigneeId === person.id);
                const completed = assigned.filter((task) => task.status === "done").length;
                const overdue = assigned.filter((task) => isOverdue(task, today)).length;
                const state = workload(
                  assigned.filter((task) => task.status !== "done").length,
                  assigned.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0),
                );
                return (
                  <tr
                    key={person.id}
                    onClick={() => setSelectedId(person.id)}
                    className="cursor-pointer border-t border-border hover:bg-accent/40"
                  >
                    <td className="px-4 py-3">
                      <Person person={person} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      {person.id === manager.id ? "Project Manager" : "Member"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      {plural(assigned.length, "Task")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">{completed} Completed</td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-4 py-3 text-xs",
                        overdue && "text-destructive",
                      )}
                    >
                      {overdue} Overdue
                    </td>
                    <td className="px-4 py-3">
                      <span className="whitespace-nowrap rounded-md bg-muted px-2 py-1 text-xs">
                        {state}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {permissions.manageTeam && person.id !== manager.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${person.name} from the project`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setRemoveId(person.id);
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
      ) : (
        <EmptyState
          icon={UserPlus}
          title="No team members yet"
          description="Add the people who will work on this project."
          action="Add Member"
          onAction={() => setMemberPickerOpen(true)}
        />
      )}
      <MemberPicker
        open={memberPickerOpen}
        onOpenChange={setMemberPickerOpen}
        directory={directory}
        selectedIds={team.map((person) => person.id)}
        onAdd={onAdd}
      />
      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(undefined)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader className="text-left">
            <SheetTitle>{selected?.name ?? "Team member"}</SheetTitle>
            <SheetDescription>Project-specific responsibilities and workload.</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-5">
              <Person person={selected} large />
              <div className="grid grid-cols-2 gap-3">
                <Summary label="Job Title" value={selectedProfile?.title || "—"} />
                <Summary
                  label="Department"
                  value={selectedProfile?.department || project.department || project.category}
                />
                <Summary
                  label="Project Role"
                  value={selected.id === manager.id ? "Project Manager" : "Member"}
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
                        {statusLabel(task.status)} · due {formatDay(task.dueDate, "MMM d")}
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
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && !removing && setRemoveId(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {activeForRemoval.length
                ? `This member currently has ${plural(activeForRemoval.length, "active task")} in this project. Reassign them before removal.`
                : "This member has no active project tasks."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            {activeForRemoval.length ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedId(removeId);
                  setRemoveId(undefined);
                }}
              >
                Reassign Tasks
              </Button>
            ) : (
              <AlertDialogAction
                disabled={removing}
                onClick={async (event) => {
                  event.preventDefault();
                  if (!removeId) return;
                  setRemoving(true);
                  const ok = await onRemove(removeId);
                  setRemoving(false);
                  if (ok) setRemoveId(undefined);
                }}
              >
                {removing ? "Removing…" : "Remove Member"}
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
  state,
  today,
  personFor,
  onOpenCreate,
  onComplete,
  onDelete,
}: {
  project: WorkspaceProject;
  tasks: WorkspaceTask[];
  milestones: Milestone[];
  state: LoadState;
  today: string;
  personFor: (id: string | null | undefined) => PersonRef;
  onOpenCreate: () => void;
  onComplete: (milestone: Milestone, completed: boolean) => Promise<void>;
  onDelete: (milestone: Milestone) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"timeline" | "milestones">("timeline");
  const [scale, setScale] = useState<"week" | "month" | "fit">("week");
  // Week and Month views open at today. They opened at the project start date,
  // weeks in the past for any running project (FD-049).
  const [windowStart, setWindowStart] = useState(today);
  const [deleteTarget, setDeleteTarget] = useState<Milestone>();
  const todayDate = toDate(today) ?? new Date();
  const projectStart = toDate(dayOf(project.startDate)) ?? todayDate;
  const projectEnd = toDate(dayOf(project.deadline)) ?? addDays(projectStart, 13);
  const start = scale === "fit" ? projectStart : (toDate(windowStart) ?? todayDate);
  const days =
    scale === "month"
      ? 30
      : scale === "fit"
        ? Math.max(14, differenceInCalendarDays(projectEnd, projectStart) + 1)
        : 14;
  const width = scale === "month" ? 36 : scale === "fit" ? 28 : 56;
  const shiftWindow = (direction: 1 | -1) =>
    setWindowStart(format(addDays(start, direction * days), "yyyy-MM-dd"));
  const showToday = () => {
    setWindowStart(today);
    if (scale === "fit") setScale("week");
  };
  /** Pixel span of a date range inside the visible window, or where it lies outside it. */
  const span = (from: Date, to: Date) => {
    const first = differenceInCalendarDays(from, start);
    const last = Math.max(first, differenceInCalendarDays(to, start));
    if (last < 0) return "before" as const;
    if (first > days - 1) return "after" as const;
    const left = Math.max(0, first);
    const right = Math.min(days - 1, last);
    return { left: left * width, width: (right - left + 1) * width - 4 };
  };
  const upcoming = [
    ...tasks
      .filter((task) => task.status !== "done")
      .map((task) => ({
        id: task.id,
        name: task.title,
        owner: task.assignee.name,
        date: dayOf(task.dueDate),
      })),
    ...milestones
      .filter((item) => !item.completedAt)
      .map((item) => ({
        id: item.id,
        name: item.name,
        owner: personFor(item.ownerId).name,
        date: item.targetDate,
      })),
  ]
    .filter((item) => item.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  // Finished work is left out, and past-due work says so, instead of showing
  // "−30 days" remaining (FD-049).
  const remaining = (date: string) => {
    const diff = differenceInCalendarDays(toDate(date) ?? todayDate, todayDate);
    if (diff < 0) return { text: `${plural(-diff, "day")} overdue`, overdue: true };
    if (diff === 0) return { text: "Due today", overdue: false };
    return { text: plural(diff, "day"), overdue: false };
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          <Button
            variant={mode === "timeline" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("timeline")}
            aria-pressed={mode === "timeline"}
          >
            Timeline
          </Button>
          <Button
            variant={mode === "milestones" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setMode("milestones")}
            aria-pressed={mode === "milestones"}
          >
            Milestones
          </Button>
        </div>
        {mode === "milestones" && permissions.manageMilestones && (
          <Button size="sm" onClick={onOpenCreate} disabled={state !== "ready"}>
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
              {scale !== "fit" && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Earlier"
                  onClick={() => shiftWindow(-1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={showToday}>
                Today
              </Button>
              {scale !== "fit" && (
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Later"
                  onClick={() => shiftWindow(1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant={scale === "week" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setScale("week")}
                aria-pressed={scale === "week"}
              >
                Week
              </Button>
              <Button
                variant={scale === "month" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setScale("month")}
                aria-pressed={scale === "month"}
              >
                Month
              </Button>
              <Button
                variant={scale === "fit" ? "secondary" : "outline"}
                size="sm"
                onClick={() => setScale("fit")}
                aria-pressed={scale === "fit"}
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
                      className={cn(
                        "whitespace-nowrap border-l border-border px-1 py-2 text-center text-[10px] text-muted-foreground",
                        format(date, "yyyy-MM-dd") === today &&
                          "bg-primary/10 font-semibold text-primary",
                      )}
                    >
                      {format(date, "MMM d")}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                {tasks.map((task) => {
                  const from = toDate(task.startDate) ?? toDate(task.createdAt) ?? todayDate;
                  const to = toDate(task.dueDate) ?? from;
                  const bar = span(from, to);
                  const overdue = isOverdue(task, today);
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
                        {typeof bar === "string" ? (
                          <span className="absolute left-2 top-4 whitespace-nowrap text-[10px] text-muted-foreground">
                            {bar === "before" ? "← Earlier" : "Later →"}
                          </span>
                        ) : (
                          <div
                            className={cn(
                              "absolute top-3 h-6 whitespace-nowrap rounded-md px-2 text-[10px] leading-6 text-primary-foreground",
                              task.status === "done"
                                ? "bg-status-done"
                                : overdue
                                  ? "bg-destructive"
                                  : "bg-primary",
                            )}
                            style={{ left: bar.left, width: Math.max(width - 4, bar.width) }}
                          >
                            {task.progress}%
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {milestones.map((item) => {
                  const date = toDate(item.targetDate);
                  const offset = date ? differenceInCalendarDays(date, start) : -1;
                  const status = milestoneStatus(item, today);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center border-b border-border last:border-0"
                    >
                      <div className="w-[260px] shrink-0 px-4 py-3 text-xs font-medium">
                        Milestone · {item.name}
                      </div>
                      <div className="relative h-11" style={{ width: days * width }}>
                        {offset >= 0 && offset < days ? (
                          <Flag
                            aria-label={`${item.name}: ${milestoneStatusLabels[status]}`}
                            className={cn(
                              "absolute top-3 h-5 w-5",
                              status === "delayed"
                                ? "text-destructive"
                                : status === "completed"
                                  ? "text-status-done"
                                  : "text-primary",
                            )}
                            style={{ left: offset * width }}
                          />
                        ) : (
                          <span className="absolute left-2 top-3.5 whitespace-nowrap text-[10px] text-muted-foreground">
                            {offset < 0 ? "← Earlier" : "Later →"}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      ) : state !== "ready" ? (
        <div className="rounded-xl border border-border bg-card">
          <StateMessage
            state={state}
            loading="Loading milestones…"
            error="Milestones could not be loaded."
          />
        </div>
      ) : milestones.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
              <tr>
                {["Milestone", "Owner", "Target Date", "Status", "Progress", "Actions"].map(
                  (item) => (
                    <th key={item} className="whitespace-nowrap px-4 py-3 text-left font-medium">
                      {item}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {milestones.map((item) => {
                const status = milestoneStatus(item, today);
                const percent = item.completedAt ? 100 : 0;
                return (
                  <tr key={item.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.name}</div>
                      {item.completedAt && (
                        <div className="text-xs text-muted-foreground">
                          Completed {formatDay(item.completedAt, "MMM d, yyyy")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {item.ownerId ? personFor(item.ownerId).name : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      {formatDay(item.targetDate, "MMM d, yyyy")}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-block whitespace-nowrap rounded-md px-2 py-1 text-[10px]",
                          milestoneStatusStyles[status],
                        )}
                      >
                        {milestoneStatusLabels[status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Progress
                          value={percent}
                          className="w-20"
                          aria-label={`${percent}% complete`}
                        />
                        <span className="text-xs">{percent}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${item.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {item.completedAt ? (
                            <DropdownMenuItem onSelect={() => void onComplete(item, false)}>
                              <RotateCcw />
                              Reopen
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => void onComplete(item, true)}>
                              <CheckCircle2 />
                              Mark as Completed
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleteTarget(item)}
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Flag}
          title="No milestones yet"
          description="Mark the key dates this project is working towards."
          action="Add Milestone"
          onAction={onOpenCreate}
        />
      )}
      <Section title="Upcoming Deadlines">
        {upcoming.length ? (
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
                {upcoming.map((item) => {
                  const left = remaining(item.date);
                  return (
                    <tr key={item.id} className="border-t border-border">
                      <td className="py-2 font-medium">{item.name}</td>
                      <td className="py-2 text-xs text-muted-foreground">{item.owner}</td>
                      <td className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                        {formatDay(item.date, "MMM d")}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap py-2 text-xs",
                          left.overdue && "text-destructive",
                        )}
                      >
                        {left.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No open tasks or milestones with a due date.
          </p>
        )}
      </Section>
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              Delete “{deleteTarget?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The milestone is removed from this project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (event) => {
                event.preventDefault();
                if (deleteTarget && (await onDelete(deleteTarget))) setDeleteTarget(undefined);
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

function DocumentsTab({
  documents,
  state,
  uploading,
  onUpload,
  onDelete,
  onRetry,
}: {
  documents: StoredFile[];
  state: LoadState;
  uploading: boolean;
  onUpload: (files: File[]) => Promise<void>;
  onDelete: (file: StoredFile) => Promise<boolean>;
  onRetry: () => void;
}) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("recent");
  const [deleteTarget, setDeleteTarget] = useState<StoredFile>();
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = documents
    .filter(
      (file) =>
        file.name.toLowerCase().includes(query.toLowerCase()) &&
        (type === "all" || fileType(file) === type),
    )
    .sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt),
    );
  const pick = () => inputRef.current?.click();
  const dropProps = {
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      void onUpload(Array.from(event.dataTransfer.files));
    },
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            Documents <span className="text-muted-foreground">({documents.length})</span>
          </h3>
          <p className="text-xs text-muted-foreground">{FILE_RULES.label}</p>
        </div>
        {permissions.manageDocuments && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={FILE_RULES.accept}
              className="hidden"
              aria-label="Upload project documents"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                // Cleared so choosing the same file again still fires onChange.
                event.target.value = "";
                void onUpload(files);
              }}
            />
            <Button size="sm" onClick={pick} disabled={uploading || state !== "ready"}>
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </>
        )}
      </div>
      {state !== "ready" ? (
        <div className="rounded-xl border border-border bg-card">
          <StateMessage
            state={state}
            loading="Loading documents…"
            error="Documents could not be loaded."
            onRetry={onRetry}
          />
        </div>
      ) : documents.length ? (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search documents"
                aria-label="Search documents"
                className="h-8 w-56 pl-8 text-xs"
              />
            </div>
            <CompactSelect
              value={type}
              onValue={setType}
              options={["all", ...Array.from(new Set(documents.map(fileType)))]}
              label="File Type"
            />
            <CompactSelect
              value={sort}
              onValue={setSort}
              options={["recent", "name"]}
              labels={{ recent: "Most recent", name: "Name" }}
              label="Sort"
            />
          </div>
          <div {...dropProps} className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground">
                <tr>
                  {["Document", "Uploaded By", "Added", "Size", "Actions"].map((item) => (
                    <th key={item} className="whitespace-nowrap px-4 py-3 text-left font-medium">
                      {item}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((file) => (
                  <tr key={file.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="break-all font-medium">{file.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{file.uploadedBy.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatDay(file.createdAt, "MMM d")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${file.name}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => void openStoredFile(file, false)}>
                            <FolderOpen />
                            Preview
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void openStoredFile(file, true)}>
                            <Download />
                            Download
                          </DropdownMenuItem>
                          {file.isMine && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setDeleteTarget(file)}
                              >
                                <Trash2 />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <p className="border-t border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No documents match these filters.
              </p>
            )}
          </div>
        </>
      ) : (
        <div {...dropProps}>
          <EmptyState
            icon={FileText}
            title="No project documents yet"
            description="Keep project briefs, references and important files together."
            action="Upload Document"
            onAction={pick}
          />
        </div>
      )}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && !deleting && setDeleteTarget(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              Delete “{deleteTarget?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The file will be removed from this project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                setDeleting(true);
                const ok = await onDelete(deleteTarget);
                setDeleting(false);
                if (ok) setDeleteTarget(undefined);
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ActivityTab({
  activity,
  state,
  taskTitles,
  onRetry,
}: {
  activity: ActivityEntry[];
  state: LoadState;
  taskTitles: Map<string, string>;
  onRetry: () => void;
}) {
  const [filter, setFilter] = useState<"all" | ActivityCategory>("all");
  // No "Team" filter: joining or leaving a project is not recorded as activity,
  // so it could only ever be empty.
  const labels: Record<"all" | ActivityCategory, string> = {
    all: "All Activity",
    tasks: "Tasks",
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
            aria-pressed={filter === id}
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
          entries={activity.filter(
            (entry) => filter === "all" || activityCategory(entry) === filter,
          )}
          state={state}
          taskTitles={taskTitles}
          onRetry={onRetry}
          detailed
        />
      </Section>
    </div>
  );
}

const TASK_STATUS_VALUES = new Set<string>(["todo", "progress", "review", "done"]);

/** "moved “Homepage” to In Progress": the task's name in place of "this task". */
function activitySentence(
  entry: ActivityEntry,
  taskTitles: Map<string, string>,
  statusLabel: (value: string) => string,
): React.ReactNode {
  if (!entry.taskId) return describeActivity(entry, "project");
  const title = <b>“{taskTitles.get(entry.taskId) ?? "a task"}”</b>;
  // Status names as configured in Settings, not describeActivity's fixed
  // words, so the feed matches the board's column names (FD-018).
  const to = (entry.details as { to?: string }).to;
  if (entry.type === "task_status_changed" && to && TASK_STATUS_VALUES.has(to)) {
    return (
      <>
        moved {title} to {statusLabel(to)}
      </>
    );
  }
  if (entry.type === "task_completed")
    return (
      <>
        moved {title} to {statusLabel("done")}
      </>
    );
  const sentence = describeActivity(entry, "task");
  const [before, ...after] = sentence.split("this task");
  if (!after.length)
    return (
      <>
        {sentence} on {title}
      </>
    );
  return (
    <>
      {before}
      {title}
      {after.join("this task")}
    </>
  );
}

/**
 * The project's real activity feed (work_activity), newest first. It showed
 * five invented entries and credited every change to "Alex Morgan" (FD-033).
 */
function ActivityList({
  entries,
  state,
  taskTitles,
  onRetry,
  detailed,
}: {
  entries: ActivityEntry[];
  state: LoadState;
  taskTitles: Map<string, string>;
  onRetry: () => void;
  detailed?: boolean;
}) {
  const { statusLabel } = useTaskSettings();
  if (state !== "ready" && !entries.length) {
    return (
      <StateMessage
        state={state}
        loading="Loading activity…"
        error="Activity could not be loaded."
        onRetry={onRetry}
      />
    );
  }
  if (!entries.length) {
    return <p className="text-sm text-muted-foreground">No activity has been recorded yet.</p>;
  }
  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const occurred = toDate(entry.occurredAt);
        return (
          <div key={entry.id} className="flex gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="break-words">
                <b>{entry.actor.name}</b> {activitySentence(entry, taskTitles, statusLabel)}
              </p>
              {occurred && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <time dateTime={entry.occurredAt} title={format(occurred, "MMM d, yyyy h:mm a")}>
                    {formatDistanceToNow(occurred, { addSuffix: true })}
                    {detailed && ` · ${format(occurred, "MMM d, yyyy h:mm a")}`}
                  </time>
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function CompactSelect({
  value,
  onValue,
  options,
  labels,
  label,
}: {
  value: string;
  onValue: (value: string) => void;
  options: string[];
  /** Display text per option; defaults to the option in title case. */
  labels?: Record<string, string>;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onValue}>
      <SelectTrigger className="h-8 w-auto min-w-28 text-xs" aria-label={label}>
        <Filter className="h-3.5 w-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option === "all"
              ? `All ${label}`
              : (labels?.[option] ?? option.replace(/\b\w/g, (letter) => letter.toUpperCase()))}
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
        aria-hidden={!compact}
        title={compact ? person.name : undefined}
      >
        {person.initials}
      </span>
      {compact ? (
        <span className="sr-only">{person.name}</span>
      ) : (
        <span className="truncate text-xs font-medium">{person.name}</span>
      )}
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
  directory,
  selectedIds,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  directory: DirectoryPerson[];
  selectedIds: string[];
  onAdd: (ids: string[]) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const candidates = directory.filter(
    (person) => person.eligible && !selectedIds.includes(person.id),
  );
  // Only departments someone can still be added from, so no filter comes up empty.
  const departmentNames = new Map(
    candidates
      .filter((person) => person.departmentId)
      .map((person) => [person.departmentId, person.department]),
  );
  const available = candidates.filter(
    (person) =>
      (department === "all" || person.departmentId === department) &&
      `${person.name} ${person.title} ${person.department}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const close = (next: boolean) => {
    if (saving) return;
    if (!next) {
      setDraft([]);
      setQuery("");
    }
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
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
              aria-label="Search people"
              className="pl-9"
            />
          </div>
          <CompactSelect
            value={department}
            onValue={setDepartment}
            options={["all", ...departmentNames.keys()]}
            labels={Object.fromEntries(departmentNames)}
            label="Departments"
          />
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {available.map((person) => (
              <label
                key={person.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
              >
                <input
                  type="checkbox"
                  checked={draft.includes(person.id)}
                  onChange={(event) =>
                    setDraft((current) =>
                      event.target.checked
                        ? [...current, person.id]
                        : current.filter((id) => id !== person.id),
                    )
                  }
                />
                <Person person={person} />
                <span className="ml-auto text-right text-[10px] text-muted-foreground">
                  {person.title}
                  {person.title && person.department && <br />}
                  {person.department}
                </span>
              </label>
            ))}
            {!available.length && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {candidates.length
                  ? "No one matches this search."
                  : "Everyone is already on this project."}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={!draft.length || saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onAdd(draft);
              setSaving(false);
              if (!ok) return;
              setDraft([]);
              setQuery("");
              onOpenChange(false);
            }}
          >
            {saving ? "Adding…" : "Add Selected"}
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
  manager,
  team,
  memberIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: WorkspaceProject;
  manager: PersonRef;
  team: PersonRef[];
  /** project_members as loaded here, fresher than the list after Team tab changes. */
  memberIds?: string[];
  onSaved: (
    updates: Partial<WorkspaceProject>,
    saved: { managerId?: string | null; memberIds?: string[] },
  ) => void;
}) {
  // The form only offers Planning / Active / On Hold. A completed or archived
  // project must not be silently moved to Active by saving an unrelated edit.
  const formStatus =
    project.creationStatus === "planning" || project.creationStatus === "on-hold"
      ? project.creationStatus
      : "active";
  return (
    <ProjectFormDialog
      mode="edit"
      open={open}
      onClose={() => onOpenChange(false)}
      // Ids, not just names: the form resolves the manager, team and
      // department from these and saves the edit itself (FD-034, FD-052).
      initial={{
        id: project.id,
        orgId: project.orgId,
        name: project.name,
        description: project.description,
        projectType: project.projectType,
        category: project.category,
        client: project.client,
        manager: manager.name,
        managerId: manager.id || undefined,
        department: project.department,
        departmentId: project.departmentId ?? undefined,
        teamId: project.teamId ?? undefined,
        priority: project.priority,
        creationStatus: formStatus,
        startDate: project.startDate,
        deadline: project.deadline,
        teamNames: team.map((member) => member.name),
        teamIds: memberIds,
      }}
      onSubmit={(values) => {
        onSaved(
          {
            name: values.name,
            description: values.description,
            projectType: values.projectType,
            client: values.client,
            category: values.category,
            manager: values.manager,
            department: values.department,
            departmentId: values.departmentId,
            teamId: values.teamId,
            priority: values.priority,
            ...(values.creationStatus && values.creationStatus !== formStatus
              ? { creationStatus: values.creationStatus }
              : {}),
            startDate: values.startDate,
            deadline: values.deadline,
            team: values.team,
          },
          { managerId: values.managerId, memberIds: values.teamIds },
        );
        onOpenChange(false);
      }}
    />
  );
}

function MilestoneDialog({
  open,
  onOpenChange,
  owners,
  defaultOwnerId,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  owners: PersonRef[];
  defaultOwnerId: string | null;
  onCreate: (milestone: MilestoneInput) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [owner, setOwner] = useState(defaultOwnerId ?? "none");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<"upcoming" | "completed">("upcoming");
  const [saving, setSaving] = useState(false);
  const fieldId = "project-milestone";

  useEffect(() => {
    if (!open) return;
    setName("");
    setOwner(defaultOwnerId ?? "none");
    setDate("");
    setStatus("upcoming");
    setSaving(false);
  }, [open, defaultOwnerId]);

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add Milestone</DialogTitle>
        </DialogHeader>
        {/* Description, In Progress and Related Tasks were dropped: project_milestones
            has nowhere to keep them, so they were lost the moment the dialog closed. */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-name`} className="text-xs font-medium">
              Milestone Name*
            </label>
            <Input
              id={`${fieldId}-name`}
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-owner`} className="text-xs font-medium">
                Owner
              </label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger id={`${fieldId}-owner`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No owner</SelectItem>
                  {owners.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-date`} className="text-xs font-medium">
                Target Date*
              </label>
              <Input
                id={`${fieldId}-date`}
                type="date"
                value={date}
                max="9999-12-31"
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-status`} className="text-xs font-medium">
              Status
            </label>
            <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
              <SelectTrigger id={`${fieldId}-status`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              An open milestone past its target date shows as Delayed.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date) || saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onCreate({
                name: name.trim(),
                ownerId: owner === "none" ? null : owner,
                targetDate: date,
                completed: status === "completed",
              });
              setSaving(false);
              if (ok) onOpenChange(false);
            }}
          >
            {saving ? "Saving…" : "Add Milestone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
