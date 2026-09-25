import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Plus,
  Search,
  Filter,
  LayoutGrid,
  List as ListIcon,
  GanttChart,
  Calendar,
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  Clock,
  FolderKanban,
  FileText,
  Activity,
  Paperclip,
  ChevronsUpDown,
  UserPlus,
  X,
  Loader2,
} from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { toast } from "sonner";
import { z } from "zod";
import { cn } from "@/lib/utils";
import {
  archiveProjectRow,
  createProjectRow,
  loadProjects,
  projectColor,
  setProjectMembers,
  updateProjectRow,
  type LoadedProject,
  type ProjectLifecycle,
} from "@/lib/admin-api";
import { healthLabel, type ProjectHealth } from "@/lib/project-metrics";
import {
  FILE_RULES,
  formatBytes,
  uploadProjectDocuments,
  validateFile,
  type PersonRef,
} from "@/lib/task-api";
import { useOrganizations } from "@/lib/organizations-data";
import { useTaskSettings } from "@/lib/task-settings-data";
import { useWorkspace } from "@/lib/workspace-data";
import { ProjectWorkspace, type WorkspaceProject } from "./ProjectWorkspace";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar as DateCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ProjectPerson = { id?: string; name: string; initials: string; color: string };

type ProjectExt = {
  id: string;
  name: string;
  color: string;
  /** projectProgress(...).percent, from admin-api loadProjects. */
  progress: number;
  taskCount: number;
  members: number;
  deadline: string;
  startDate: string;
  /** projectHealth(...) — the only health this screen shows (FD-014, FD-056). */
  health: ProjectHealth;
  client: string;
  manager: ProjectPerson;
  managerId?: string | null;
  team: ProjectPerson[];
  teamIds?: string[];
  pendingTasks: number;
  risk: "low" | "medium" | "high";
  category: string;
  description?: string;
  projectId?: string;
  projectType?: "internal" | "client";
  department?: string;
  departmentId?: string | null;
  teamId?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  creationStatus?: ProjectLifecycle;
  attachmentNames?: string[];
  createdAt?: string;
  updatedAt?: string;
  isNew?: boolean;
  /** Which organization owns it — required to write the row back. */
  orgId?: string;
};

/** A short, stable reference derived from the real row id. */
const displayId = (id: string) => id.slice(0, 8).toUpperCase();

/** Widen a project loaded from Supabase into the shape this screen renders. */
const fromLoaded = (p: LoadedProject): ProjectExt => ({
  id: p.id,
  name: p.name,
  color: p.color,
  progress: p.progress,
  taskCount: p.taskCount,
  members: p.members,
  deadline: p.deadline,
  startDate: p.startDate,
  health: p.health,
  // The real client_name, or the project type. The card used to show an
  // invented client company (FD-014).
  client: p.projectType === "client" ? p.client || "Client" : "Internal",
  manager: p.manager,
  managerId: p.managerId,
  team: p.team,
  teamIds: p.teamIds,
  pendingTasks: p.pendingTasks,
  risk: p.risk,
  category: p.category,
  description: p.description,
  projectId: displayId(p.id),
  projectType: p.projectType,
  department: p.department,
  departmentId: p.departmentId,
  teamId: p.teamId,
  priority: p.priority,
  creationStatus: p.creationStatus,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  orgId: p.organizationId,
});

const healthStyles: Record<ProjectHealth, string> = {
  completed: "bg-primary/10 text-primary border-primary/30",
  "on-track":
    "bg-[color:var(--status-done)]/15 text-[color:var(--status-done)] border-[color:var(--status-done)]/30",
  "at-risk":
    "bg-[color:var(--priority-medium)]/15 text-[color:var(--priority-medium)] border-[color:var(--priority-medium)]/30",
  delayed:
    "bg-[color:var(--priority-critical)]/15 text-[color:var(--priority-critical)] border-[color:var(--priority-critical)]/30",
  "no-tasks": "bg-muted text-muted-foreground border-border",
};

const HEALTH_ORDER: ProjectHealth[] = ["on-track", "at-risk", "delayed", "completed", "no-tasks"];

const riskColor: Record<ProjectExt["risk"], string> = {
  low: "text-[color:var(--status-done)]",
  medium: "text-[color:var(--priority-medium)]",
  high: "text-[color:var(--priority-critical)]",
};

const hasDate = (iso?: string) => Boolean(iso) && !Number.isNaN(new Date(iso as string).getTime());

function fmtDate(iso: string) {
  // A project without a date used to render "Invalid Date".
  if (!hasDate(iso)) return "No date";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Internal · Technology" — the same line the project detail header shows. */
const projectSubtitle = (project: ProjectExt) =>
  [project.client, project.department ?? project.category].filter(Boolean).join(" · ");

/** A yyyy-mm-dd date in local time, as the date columns store it. */
const localDate = (date: Date) => format(date, "yyyy-MM-dd");

/** Upload files picked in the project form and report any the bucket refused. */
async function attachProjectFiles(project: { id: string; organizationId: string }, files: File[]) {
  if (!files.length) return;
  const result = await uploadProjectDocuments(project, files);
  if (result.rejected.length) {
    toast.error(
      `Not attached: ${result.rejected.map((file) => `${file.name} (${file.reason})`).join(", ")}`,
    );
  }
}

/* ---------- Dashboard filter (contract C2) ---------- */
type ProjectsFilter =
  | { kind: "project"; target: string }
  | { kind: "health"; health: ProjectHealth };

/**
 * "project:<id or name>" opens that project; "health:<value>" (or the bare
 * value, e.g. "delayed") narrows the list. Anything else is ignored rather than
 * applied invisibly.
 */
function parseProjectsFilter(filter?: string): ProjectsFilter | null {
  if (!filter) return null;
  if (filter.startsWith("project:")) {
    const raw = filter.slice("project:".length);
    let target = raw;
    try {
      target = decodeURIComponent(raw);
    } catch {
      // A malformed escape is still a usable name.
    }
    return target ? { kind: "project", target } : null;
  }
  const key = filter.startsWith("health:") ? filter.slice("health:".length) : filter;
  return (HEALTH_ORDER as string[]).includes(key)
    ? { kind: "health", health: key as ProjectHealth }
    : null;
}

const matchesTarget = (project: ProjectExt, target: string) =>
  project.id === target || project.name === target;

/**
 * The project currently open in ProjectWorkspace.
 *
 * ProjectWorkspace renders the Edit Project form but only ever knew the project
 * by its display fields, so "Save Changes" merged into local state and nothing
 * reached the database (FD-052). The form reads the open row from here and
 * persists the edit itself.
 */
type EditingProject = { project: ProjectExt; onSaved: (project: ProjectExt) => void };
const EditingProjectContext = createContext<EditingProject | null>(null);

/**
 * The organization a new project goes into: the one selected in the switcher,
 * else the user's own. With "All organizations" selected (the default) every
 * create used to fail with "Could not tell which organization".
 */
function useDefaultOrgId(): string | undefined {
  const { activeOrgId, organizations, accessibleOrganizations, currentUser } = useOrganizations();
  if (activeOrgId !== "all") return activeOrgId;
  return currentUser?.primaryOrgId || accessibleOrganizations[0]?.id || organizations[0]?.id;
}

export function ProjectsPage({
  onNewTask: _onNewTask,
  dashboardFilter,
  onClearFilter,
  linkedProjectId,
  onLinkedProjectClosed,
}: {
  onNewTask?: () => void;
  dashboardFilter?: string;
  onClearFilter?: () => void;
  /** ?project=<id> from an email: the project to open once the list has loaded. */
  linkedProjectId?: string;
  /** Called when the person leaves that project, to drop the id from the URL. */
  onLinkedProjectClosed?: () => void;
}) {
  // Loaded from work_projects. This screen used to render five hardcoded
  // projects from mock-data.ts while the five real rows sat unread.
  const [projectItems, setProjectItems] = useState<ProjectExt[]>([]);
  const [projectsStatus, setProjectsStatus] = useState<"loading" | "ready" | "error">("loading");

  const refreshProjects = useCallback(async (): Promise<boolean> => {
    const rows = await loadProjects();
    if (!rows) return false;
    setProjectItems(rows.map(fromLoaded));
    setProjectsStatus("ready");
    return true;
  }, []);

  const retryLoad = useCallback(() => {
    setProjectsStatus("loading");
    void refreshProjects().then((ok) => {
      if (!ok) setProjectsStatus("error");
    });
  }, [refreshProjects]);

  useEffect(() => {
    retryLoad();
  }, [retryLoad]);

  const [view, setView] = useState<"grid" | "list" | "timeline">("grid");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<ProjectExt | null>(null);
  // An archive still in flight when the user goes back; the reload waits for it
  // so the archived project does not reappear.
  const pendingArchive = useRef<Promise<unknown>>(Promise.resolve());

  const { activeOrgId } = useOrganizations();
  const defaultOrgId = useDefaultOrgId();

  // The dashboard filter stays visible and clearable (FD-030). Clearing also
  // works before the route wires onClearFilter, so the chip can never get stuck.
  const [dismissedFilter, setDismissedFilter] = useState<string>();
  const activeFilterKey =
    dashboardFilter && dashboardFilter !== dismissedFilter ? dashboardFilter : undefined;
  const dashboardScope = useMemo(() => parseProjectsFilter(activeFilterKey), [activeFilterKey]);
  const clearDashboardFilter = useCallback(() => {
    setDismissedFilter(dashboardFilter);
    onClearFilter?.();
  }, [dashboardFilter, onClearFilter]);

  // Open the project a dashboard row pointed at — once per filter, so reloading
  // the list afterwards cannot pull the user back into it.
  const openedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (dashboardScope?.kind !== "project" || projectsStatus !== "ready") return;
    if (openedFor.current === activeFilterKey) return;
    openedFor.current = activeFilterKey;
    const match = projectItems.find((project) => matchesTarget(project, dashboardScope.target));
    if (match) setSelected(match);
  }, [dashboardScope, activeFilterKey, projectsStatus, projectItems]);

  // ?project=<id> (email links), likewise once. An archived project, or one this
  // person cannot see (RLS), is not in the list.
  const openedEmailProject = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!linkedProjectId) {
      openedEmailProject.current = undefined;
      return;
    }
    if (projectsStatus !== "ready" || openedEmailProject.current === linkedProjectId) return;
    openedEmailProject.current = linkedProjectId;
    const match = projectItems.find((project) => project.id === linkedProjectId);
    if (match) {
      setSelected(match);
      return;
    }
    toast.error("That project isn't available to you.", {
      description: "It may have been archived, or you may no longer be on its team.",
    });
    onLinkedProjectClosed?.();
  }, [linkedProjectId, projectsStatus, projectItems, onLinkedProjectClosed]);

  // Scoped by each project's own organization. This used to look projects up in
  // a hardcoded list of five sample projects ("P-1".."P-5", Operations in a
  // second organization), so Total counted five while four cards rendered (FD-015).
  const scoped = useMemo(
    () =>
      activeOrgId === "all"
        ? projectItems
        : projectItems.filter((project) => project.orgId === activeOrgId),
    [projectItems, activeOrgId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter((p) => {
      if (q && !`${p.name} ${projectSubtitle(p)}`.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && p.health !== statusFilter) return false;
      if (dashboardScope?.kind === "health" && p.health !== dashboardScope.health) return false;
      if (dashboardScope?.kind === "project" && !matchesTarget(p, dashboardScope.target))
        return false;
      return true;
    });
  }, [scoped, query, statusFilter, dashboardScope]);

  // One list, one health per project: Total = Active + Completed + Delayed, so
  // the tiles always add up and a Delayed count always has Delayed cards (FD-015).
  const metrics = useMemo(() => {
    const completed = scoped.filter((p) => p.health === "completed").length;
    const delayed = scoped.filter((p) => p.health === "delayed").length;
    return {
      total: scoped.length,
      active: scoped.length - completed - delayed,
      completed,
      delayed,
    };
  }, [scoped]);

  const filterChipLabel = !dashboardScope
    ? undefined
    : dashboardScope.kind === "health"
      ? healthLabel[dashboardScope.health]
      : (projectItems.find((project) => matchesTarget(project, dashboardScope.target))?.name ??
        dashboardScope.target);

  const handleProjectCreated = async (project: ProjectExt, files: File[]): Promise<boolean> => {
    // Saved first, shown second. The card used to appear straight away under a
    // made-up id (PRJ-00121...) and quietly vanish if the insert failed.
    const orgId = project.orgId ?? defaultOrgId;
    if (!orgId) {
      toast.error("Could not tell which organization this project belongs to.");
      return false;
    }
    const realId = await createProjectRow({
      orgId,
      name: project.name,
      description: project.description,
      startDate: project.startDate,
      dueDate: project.deadline,
      categoryName: project.category || undefined,
      priority: project.priority,
      projectType: project.projectType,
      clientName: project.projectType === "client" ? project.client : undefined,
      status: project.creationStatus,
      managerId: project.managerId,
      departmentId: project.departmentId,
      teamId: project.teamId,
    });
    if (!realId) {
      toast.error("Project could not be saved. Nothing was created.");
      return false;
    }
    if (project.teamIds?.length && !(await setProjectMembers(realId, project.teamIds))) {
      toast.error("The project was created, but its team members could not be saved.");
    }
    await attachProjectFiles({ id: realId, organizationId: orgId }, files);
    const saved: ProjectExt = { ...project, id: realId, projectId: displayId(realId), orgId };
    setProjectItems((current) => [saved, ...current]);
    setCreateOpen(false);
    setSelected(saved);
    toast.success("Project created successfully");
    return true;
  };

  /** Keep the list in step with an edit saved from the project workspace. */
  const handleProjectEdited = useCallback((updated: ProjectExt) => {
    const merge = (item: ProjectExt): ProjectExt =>
      item.id !== updated.id
        ? item
        : {
            ...item,
            ...updated,
            // Figures come from the tasks, not the form; the reload on the way
            // back recomputes them.
            id: item.id,
            projectId: item.projectId,
            orgId: item.orgId,
            color: item.color,
            progress: item.progress,
            taskCount: item.taskCount,
            pendingTasks: item.pendingTasks,
            health: item.health,
            risk: item.risk,
            isNew: item.isNew,
          };
    setProjectItems((current) => current.map(merge));
    setSelected((current) => (current ? merge(current) : current));
  }, []);

  /**
   * ProjectWorkspace's own onUpdated (status changes, saved edits). Its project
   * state was copied from ours on mount, so only the display fields are taken:
   * its ids (manager, department, team) can be stale.
   */
  const handleWorkspaceUpdated = useCallback((updated: WorkspaceProject) => {
    const merge = (item: ProjectExt): ProjectExt =>
      item.id !== updated.id
        ? item
        : {
            ...item,
            name: updated.name,
            description: updated.description,
            projectType: updated.projectType,
            client: updated.client,
            category: updated.category,
            department: updated.department,
            priority: updated.priority,
            creationStatus: updated.creationStatus,
            startDate: updated.startDate,
            deadline: updated.deadline,
            manager: updated.manager,
            team: updated.team,
            members: updated.team.length,
          };
    setProjectItems((current) => current.map(merge));
    setSelected((current) => (current ? merge(current) : current));
  }, []);

  const duplicateProject = async (source: WorkspaceProject) => {
    const original = projectItems.find((item) => item.id === source.id);
    // onDuplicate hands back a WorkspaceProject, which carries no organization
    // or ids, so resolve them from the list we loaded.
    const orgId = original?.orgId ?? defaultOrgId;
    if (!orgId) {
      toast.error("Could not tell which organization the copy belongs to.");
      return;
    }
    const name = `${source.name} Copy`;
    const realId = await createProjectRow({
      orgId,
      name,
      description: source.description,
      startDate: source.startDate,
      dueDate: source.deadline,
      categoryName: source.category || undefined,
      priority: source.priority,
      projectType: source.projectType,
      clientName: source.projectType === "client" ? source.client : undefined,
      status: "planning",
      managerId: original?.managerId ?? undefined,
      departmentId: original?.departmentId ?? null,
      teamId: original?.teamId ?? null,
    });
    if (!realId) {
      toast.error("The copy could not be saved.");
      return;
    }
    const teamIds = original?.teamIds ?? [];
    if (teamIds.length && !(await setProjectMembers(realId, teamIds))) {
      toast.error("The copy was created, but its team members could not be copied.");
    }
    // A copy is a fresh project: no tasks, 0%, planning. It used to spread the
    // source, carrying its 62% progress, and number itself PRJ-00126 (FD-035).
    const copy: ProjectExt = {
      id: realId,
      projectId: displayId(realId),
      name,
      color: projectColor(name),
      description: source.description,
      startDate: source.startDate,
      deadline: source.deadline,
      category: source.category,
      client: source.client,
      projectType: source.projectType,
      department: original ? original.department : source.department,
      departmentId: original?.departmentId ?? null,
      teamId: original?.teamId ?? null,
      priority: source.priority,
      creationStatus: "planning",
      // The same people the ids above were copied from.
      manager: original?.manager ?? source.manager,
      managerId: original?.managerId ?? null,
      team: original?.team ?? source.team,
      teamIds,
      members: teamIds.length,
      progress: 0,
      taskCount: 0,
      pendingTasks: 0,
      health: "no-tasks",
      risk: "low",
      orgId,
      isNew: true,
    };
    setProjectItems((current) => [copy, ...current]);
    setSelected(copy);
  };

  const backToList = () => {
    setSelected(null);
    // Clearing the filter clears the whole query string, ?project included.
    if (dashboardScope?.kind === "project") clearDashboardFilter();
    else if (linkedProjectId) onLinkedProjectClosed?.();
    // Pick up edits, task changes and archives made inside the project.
    void pendingArchive.current.then(() =>
      refreshProjects().then((ok) => {
        if (!ok) toast.error("Projects could not be refreshed. Showing the last loaded list.");
      }),
    );
  };

  if (selected) {
    return (
      <>
        <EditingProjectContext.Provider value={{ project: selected, onSaved: handleProjectEdited }}>
          {/* Keyed so a duplicate opens as itself: ProjectWorkspace copies its
              project prop into state once, on mount. */}
          <ProjectWorkspace
            key={selected.id}
            project={selected}
            onBack={backToList}
            onDuplicate={(source) => void duplicateProject(source)}
            onUpdated={handleWorkspaceUpdated}
            onDelete={(projectId) => {
              const removed = projectItems.find((item) => item.id === projectId);
              setProjectItems((current) => current.filter((item) => item.id !== projectId));
              // Archived, not deleted: work_tasks reference the project, and
              // removing it would take their history with it.
              pendingArchive.current = archiveProjectRow(projectId).then((ok) => {
                if (ok) return;
                toast.error("The project could not be archived.");
                if (removed) setProjectItems((current) => [removed, ...current]);
              });
            }}
          />
        </EditingProjectContext.Provider>
        <ProjectFormDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSubmit={handleProjectCreated}
        />
      </>
    );
  }

  const ready = projectsStatus === "ready";

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Projects</h2>
            <p className="text-sm text-muted-foreground">
              {ready
                ? `${metrics.total} ${metrics.total === 1 ? "project" : "projects"} • ${metrics.active} active`
                : projectsStatus === "loading"
                  ? "Loading projects…"
                  : "Projects could not be loaded"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects…"
                aria-label="Search projects"
                className="h-9 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="Filter by health">
                <Filter className="h-3.5 w-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                {HEALTH_ORDER.map((health) => (
                  <SelectItem key={health} value={health}>
                    {healthLabel[health]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
              {[
                { id: "grid", label: "Grid view", Icon: LayoutGrid },
                { id: "list", label: "List view", Icon: ListIcon },
                { id: "timeline", label: "Timeline view", Icon: GanttChart },
              ].map((v) => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id as typeof view)}
                  className={cn(
                    "inline-flex h-7 w-8 items-center justify-center rounded-md transition",
                    view === v.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-label={v.label}
                  aria-pressed={view === v.id}
                >
                  <v.Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
            <Button size="sm" className="h-9" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New Project
            </Button>
          </div>
        </div>

        {filterChipLabel && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 py-1 pl-3 pr-1.5 text-xs font-medium text-primary">
              Filtered: {filterChipLabel}
              <button
                type="button"
                onClick={clearDashboardFilter}
                aria-label={`Clear filter: ${filterChipLabel}`}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-primary/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        {/* Metrics */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Metric
            icon={FolderKanban}
            label="Total"
            value={ready ? metrics.total : "—"}
            tint="primary"
          />
          <Metric
            icon={Activity}
            label="Active"
            value={ready ? metrics.active : "—"}
            tint="primary"
          />
          <Metric
            icon={CheckCircle2}
            label="Completed"
            value={ready ? metrics.completed : "—"}
            tint="done"
          />
          <Metric
            icon={AlertTriangle}
            label="Delayed"
            value={ready ? metrics.delayed : "—"}
            tint="critical"
          />
        </div>

        {/* Views */}
        {projectsStatus === "loading" && (
          <StatePanel>
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
            Loading projects…
          </StatePanel>
        )}
        {projectsStatus === "error" && (
          <StatePanel>
            <p>Projects could not be loaded.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={retryLoad}>
              Try again
            </Button>
          </StatePanel>
        )}
        {ready && filtered.length === 0 && (
          <StatePanel>
            {scoped.length ? (
              <p>No projects match these filters.</p>
            ) : (
              <>
                <p>No projects yet.</p>
                <Button size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> New Project
                </Button>
              </>
            )}
          </StatePanel>
        )}
        {ready && filtered.length > 0 && view === "grid" && (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <ProjectCard key={p.id} project={p} onOpen={() => setSelected(p)} />
            ))}
          </div>
        )}
        {ready && filtered.length > 0 && view === "list" && (
          <ProjectList items={filtered} onOpen={(p) => setSelected(p)} />
        )}
        {ready && filtered.length > 0 && view === "timeline" && (
          <ProjectTimeline items={filtered} onOpen={(p) => setSelected(p)} />
        )}
      </div>

      <ProjectFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleProjectCreated}
      />
    </>
  );
}

function StatePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground shadow-[var(--shadow-soft)]">
      {children}
    </div>
  );
}

/* ---------- Metric ---------- */
function Metric({
  icon: Icon,
  label,
  value,
  tint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tint: "primary" | "done" | "critical" | "medium";
}) {
  const tintMap = {
    primary: "text-primary bg-primary/10",
    done: "text-[color:var(--status-done)] bg-[color:var(--status-done)]/10",
    critical: "text-[color:var(--priority-critical)] bg-[color:var(--priority-critical)]/10",
    medium: "text-[color:var(--priority-medium)] bg-[color:var(--priority-medium)]/10",
  } as const;
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] hover:shadow-md transition">
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md",
            tintMap[tint],
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function HealthBadge({ health, className }: { health: ProjectHealth; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-md border px-2 py-0.5 text-[10px] font-medium",
        healthStyles[health],
        className,
      )}
    >
      {healthLabel[health]}
    </span>
  );
}

/* ---------- Project Card ---------- */
function ProjectCard({ project, onOpen }: { project: ProjectExt; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group text-left rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-soft)] hover:shadow-lg hover:-translate-y-0.5 transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-xs font-semibold shrink-0"
            style={{ background: project.color }}
          >
            {project.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="font-semibold truncate">{project.name}</div>
            <div className="text-xs text-muted-foreground truncate">{projectSubtitle(project)}</div>
          </div>
        </div>
        <HealthBadge health={project.health} className="shrink-0" />
      </div>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Calendar className="h-3 w-3" />
        {fmtDate(project.startDate)} → {fmtDate(project.deadline)}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Progress
            {project.taskCount > 0 && (
              <span className="ml-1">
                · {project.taskCount - project.pendingTasks}/{project.taskCount} tasks
              </span>
            )}
          </span>
          <span className="font-medium">{project.progress}%</span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${project.progress}%`, background: project.color }}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <AvatarStack people={project.team} />
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1" title="Open tasks">
            <Clock className="h-3 w-3" /> {project.pendingTasks}
          </span>
          <span
            className={cn("inline-flex items-center gap-1", riskColor[project.risk])}
            title={`Risk: ${project.risk}`}
          >
            <AlertTriangle className="h-3 w-3" /> {project.risk}
          </span>
          <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition" />
        </div>
      </div>
    </button>
  );
}

function AvatarStack({ people }: { people: { initials: string; color: string; name: string }[] }) {
  if (!people.length) {
    return <span className="text-[11px] text-muted-foreground">No team yet</span>;
  }
  return (
    <div className="flex -space-x-2">
      {people.slice(0, 4).map((p, i) => (
        <span
          key={i}
          title={p.name}
          className="h-6 w-6 rounded-full ring-2 ring-card flex items-center justify-center text-[10px] font-semibold text-white"
          style={{ background: p.color }}
        >
          {p.initials}
        </span>
      ))}
      {people.length > 4 && (
        <span className="h-6 w-6 rounded-full ring-2 ring-card bg-muted text-[10px] font-medium flex items-center justify-center">
          +{people.length - 4}
        </span>
      )}
    </div>
  );
}

/* ---------- List View ---------- */
function ProjectList({ items, onOpen }: { items: ProjectExt[]; onOpen: (p: ProjectExt) => void }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="grid grid-cols-[2fr_1fr_1fr_1.4fr_1fr_0.6fr] gap-4 px-5 py-3 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
        <div>Project</div>
        <div>Status</div>
        <div>Deadline</div>
        <div>Progress</div>
        <div>Team</div>
        <div>Risk</div>
      </div>
      {items.map((p) => (
        <button
          key={p.id}
          onClick={() => onOpen(p)}
          className="w-full grid grid-cols-[2fr_1fr_1fr_1.4fr_1fr_0.6fr] gap-4 px-5 py-3.5 text-left text-sm border-b border-border last:border-0 hover:bg-accent/40 transition"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-7 w-7 rounded-md shrink-0" style={{ background: p.color }} />
            <div className="min-w-0">
              <div className="font-medium truncate">{p.name}</div>
              <div className="text-xs text-muted-foreground truncate">{projectSubtitle(p)}</div>
            </div>
          </div>
          <div>
            <HealthBadge health={p.health} />
          </div>
          <div className="text-xs text-muted-foreground self-center">{fmtDate(p.deadline)}</div>
          <div className="self-center">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${p.progress}%`, background: p.color }}
                />
              </div>
              <span className="text-xs font-medium w-9 text-right">{p.progress}%</span>
            </div>
          </div>
          <div className="self-center">
            <AvatarStack people={p.team} />
          </div>
          <div
            className={cn(
              "self-center text-xs capitalize inline-flex items-center gap-1",
              riskColor[p.risk],
            )}
          >
            <AlertTriangle className="h-3 w-3" /> {p.risk}
          </div>
        </button>
      ))}
    </div>
  );
}

/* ---------- Timeline / Gantt ---------- */
function ProjectTimeline({
  items,
  onOpen,
}: {
  items: ProjectExt[];
  onOpen: (p: ProjectExt) => void;
}) {
  // Only projects with both dates can be placed; one without used to turn the
  // whole scale into NaN.
  const dated = items.filter((p) => hasDate(p.startDate) && hasDate(p.deadline));
  const min = dated.length ? Math.min(...dated.map((p) => new Date(p.startDate).getTime())) : 0;
  const max = dated.length ? Math.max(...dated.map((p) => new Date(p.deadline).getTime())) : 0;
  const span = max - min || 1;
  const months: string[] = [];
  if (dated.length) {
    const cursor = new Date(min);
    cursor.setDate(1);
    while (cursor.getTime() <= max) {
      months.push(cursor.toLocaleDateString(undefined, { month: "short" }));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="grid grid-cols-[220px_1fr] border-b border-border">
        <div className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          Project
        </div>
        <div
          className="grid border-l border-border"
          style={{ gridTemplateColumns: `repeat(${Math.max(months.length, 1)}, 1fr)` }}
        >
          {months.map((m, i) => (
            <div
              key={i}
              className="px-3 py-3 text-[10px] uppercase tracking-wider text-muted-foreground border-r border-border last:border-0"
            >
              {m}
            </div>
          ))}
        </div>
      </div>
      {items.map((p) => {
        const placed = hasDate(p.startDate) && hasDate(p.deadline);
        const start = placed ? ((new Date(p.startDate).getTime() - min) / span) * 100 : 0;
        const end = placed ? ((new Date(p.deadline).getTime() - min) / span) * 100 : 0;
        return (
          <button
            key={p.id}
            onClick={() => onOpen(p)}
            className="w-full grid grid-cols-[220px_1fr] items-center border-b border-border last:border-0 hover:bg-accent/40 transition"
          >
            <div className="px-5 py-3 text-left flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
              <span className="text-sm font-medium truncate">{p.name}</span>
            </div>
            <div className="relative h-10 border-l border-border">
              {placed ? (
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-5 rounded-md flex items-center px-2 text-[10px] font-medium text-white shadow-sm"
                  style={{
                    left: `${start}%`,
                    width: `${Math.max(4, end - start)}%`,
                    background: p.color,
                    opacity: p.health === "delayed" ? 0.7 : 1,
                    outline:
                      p.health === "delayed" ? "1px dashed var(--priority-critical)" : "none",
                  }}
                >
                  {p.progress}%
                </div>
              ) : (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                  No dates set
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Create Project Dialog ---------- */
/**
 * A real user, from useWorkspace().people, with the designation, department and
 * team their membership records. The pickers used to list six invented people
 * with made-up titles, so searching for a real colleague found nothing (FD-034).
 */
type PersonOption = PersonRef & {
  title: string;
  department: string;
  team: string;
  departmentId?: string;
  teamId?: string;
};

const toPerson = ({ id, name, initials, color }: PersonOption): ProjectPerson => ({
  id,
  name,
  initials,
  color,
});

const personDetail = (person: PersonOption) =>
  [person.title, person.department].filter(Boolean).join(" · ") || undefined;

const makeProjectFormSchema = (requireCategory: boolean) =>
  z
    .object({
      name: z
        .string()
        .trim()
        .min(1, "Project name is required.")
        .max(120, "Project name must be 120 characters or fewer."),
      projectType: z.enum(["internal", "client"]),
      // Required when creating. A project saved before categories existed has
      // none, and must stay editable (FD-052).
      category: requireCategory ? z.string().min(1, "Please select a category.") : z.string(),
      client: z.string().trim().max(120, "Client name must be 120 characters or fewer."),
      manager: z.string().min(1, "Please select a project manager."),
      // Optional: seeded projects have no department, and a required one kept
      // Save disabled on every one of them (FD-052).
      department: z.string(),
      status: z.enum(["planning", "active", "on-hold"]),
      startDate: z.date({ required_error: "Please select a start date." }),
      endDate: z.date({ required_error: "Please select a target end date." }),
    })
    .superRefine((value, context) => {
      if (value.projectType === "client" && !value.client.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["client"],
          message: "Please enter the client for a client project.",
        });
      }
      if (value.endDate < value.startDate) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["endDate"],
          message: "Target end date cannot be earlier than the start date.",
        });
      }
    });

type FormField =
  | "name"
  | "category"
  | "client"
  | "manager"
  | "department"
  | "members"
  | "status"
  | "startDate"
  | "endDate";

export type ProjectFormInitial = {
  /** The row being edited. Inside ProjectsPage the open project supplies it. */
  id?: string;
  orgId?: string;
  name: string;
  description?: string;
  projectType?: "internal" | "client";
  category?: string;
  client?: string;
  /** Manager display name; resolved to a user id against useWorkspace().people. */
  manager: string;
  managerId?: string | null;
  /** Department or team name. */
  department?: string;
  departmentId?: string | null;
  teamId?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  creationStatus?: "planning" | "active" | "on-hold";
  startDate?: string;
  deadline?: string;
  teamNames?: string[];
  teamIds?: string[];
};

/** Department / Team picker values: "department:<id>" or "team:<id>". */
const scopeKey = (kind: "department" | "team", id: string) => `${kind}:${id}`;
const parseScope = (value: string) => {
  const [kind, id] = value.split(":");
  return {
    departmentId: kind === "department" && id ? id : null,
    teamId: kind === "team" && id ? id : null,
  };
};

export function ProjectFormDialog({
  open,
  onClose,
  onSubmit,
  mode = "create",
  initial,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Awaited while the button shows progress; the caller closes the dialog when
   * it is done, or leaves it open and says why. `files` are the attachments
   * picked in create mode — in edit mode the form uploads them itself.
   */
  onSubmit: (project: ProjectExt, files: File[]) => void | boolean | Promise<void | boolean>;
  /** No longer used: ids come from the database, not a running counter (FD-035). */
  nextNumber?: number;
  mode?: "create" | "edit";
  initial?: ProjectFormInitial;
}) {
  const today = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);
  // Field ids for label association; unique even if two forms are mounted.
  const uid = useId();
  const editing = useContext(EditingProjectContext);
  const editingProject = mode === "edit" ? editing?.project : undefined;
  const rowId = mode === "edit" ? (initial?.id ?? editingProject?.id) : undefined;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState<"internal" | "client">("internal");
  const { departments, teams, users } = useOrganizations();
  const { people } = useWorkspace();
  const defaultOrgId = useDefaultOrgId();
  // Pickers are scoped to the organization the project belongs to, so a
  // department from another organization cannot be attached to it.
  const formOrgId = initial?.orgId ?? editingProject?.orgId ?? defaultOrgId;
  const { categoriesFor } = useTaskSettings();
  const [category, setCategory] = useState("");
  const [client, setClient] = useState("");
  const [manager, setManager] = useState("");
  const [department, setDepartment] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [status, setStatus] = useState<"planning" | "active" | "on-hold">("planning");
  const [startDate, setStartDate] = useState<Date>(today);
  const [endDate, setEndDate] = useState<Date>();
  const [members, setMembers] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [touched, setTouched] = useState<Partial<Record<FormField, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const categoryOptions = useMemo(() => {
    const options = categoriesFor(formOrgId).map((item) => ({ id: item.id, name: item.name }));
    // Keep a project's current category selectable even if it was deactivated.
    return category && !options.some((item) => item.name === category)
      ? [...options, { id: `current-${category}`, name: category }]
      : options;
  }, [categoriesFor, formOrgId, category]);

  // Departments and teams from Teams & Departments — the one list (FD-036).
  const orgDepartments = useMemo(
    () =>
      departments.filter(
        (item) =>
          (item.status === "active" || department === scopeKey("department", item.id)) &&
          (!formOrgId || item.orgId === formOrgId),
      ),
    [departments, formOrgId, department],
  );
  const orgTeams = useMemo(
    () =>
      teams.filter(
        (item) =>
          (item.status === "active" || department === scopeKey("team", item.id)) &&
          (!formOrgId || item.orgId === formOrgId),
      ),
    [teams, formOrgId, department],
  );
  const departmentOptions: SearchOption[] = useMemo(
    () => [
      ...(department ? [{ value: "", label: "No department or team" }] : []),
      ...orgDepartments.map((item) => ({
        value: scopeKey("department", item.id),
        label: item.name,
        group: "Departments",
      })),
      ...orgTeams.map((item) => ({
        value: scopeKey("team", item.id),
        label: item.name,
        group: "Teams",
        detail: departments.find((d) => d.id === item.departmentId)?.name,
      })),
    ],
    [orgDepartments, orgTeams, departments, department],
  );

  const directory = useMemo<PersonOption[]>(
    () =>
      people
        .map((person) => {
          const user = users.find((item) => item.id === person.id);
          const membership =
            user?.memberships.find((item) => item.orgId === formOrgId) ?? user?.memberships[0];
          return {
            ...person,
            title: user?.designation ?? "",
            department: departments.find((d) => d.id === membership?.departmentId)?.name ?? "",
            team: teams.find((t) => t.id === membership?.teamId)?.name ?? "",
            departmentId: membership?.departmentId,
            teamId: membership?.teamId,
            // Unknown to the admin snapshot means we cannot tell, so keep them.
            eligible:
              !user ||
              (user.status !== "inactive" &&
                (!formOrgId || user.memberships.some((item) => item.orgId === formOrgId))),
          };
        })
        .filter((person) => person.eligible || person.id === manager || members.includes(person.id))
        .map(({ eligible: _eligible, ...person }) => person),
    [people, users, departments, teams, formOrgId, manager, members],
  );

  // Resolve the names ProjectWorkspace passes in to real ids, preferring the
  // ids of the project that is open.
  const resolveManager = () => {
    if (initial?.managerId) return initial.managerId;
    if (editingProject?.managerId && editingProject.manager.name === initial?.manager) {
      return editingProject.managerId;
    }
    return people.find((person) => person.name === initial?.manager)?.id ?? "";
  };
  const resolveMembers = () => {
    if (initial?.teamIds) return initial.teamIds;
    return (initial?.teamNames ?? [])
      .map(
        (memberName) =>
          editingProject?.team.find((person) => person.name === memberName && person.id)?.id ??
          people.find((person) => person.name === memberName)?.id,
      )
      .filter((id): id is string => Boolean(id));
  };
  const resolveDepartment = () => {
    const teamId =
      initial?.teamId ??
      (editingProject?.department === initial?.department ? editingProject?.teamId : null);
    if (teamId) return scopeKey("team", teamId);
    const departmentId =
      initial?.departmentId ??
      (editingProject?.department === initial?.department ? editingProject?.departmentId : null);
    if (departmentId) return scopeKey("department", departmentId);
    if (!initial?.department) return "";
    const byDepartment = departments.find(
      (item) => item.name === initial.department && (!formOrgId || item.orgId === formOrgId),
    );
    if (byDepartment) return scopeKey("department", byDepartment.id);
    const byTeam = teams.find(
      (item) => item.name === initial.department && (!formOrgId || item.orgId === formOrgId),
    );
    return byTeam ? scopeKey("team", byTeam.id) : "";
  };

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setProjectType(initial?.projectType ?? "internal");
    setCategory(initial?.category ?? "");
    setClient(
      initial?.client && initial.client !== "Internal" && initial.client !== "Client"
        ? initial.client
        : "",
    );
    setManager(resolveManager());
    setDepartment(resolveDepartment());
    setPriority(initial?.priority ?? "medium");
    setStatus(initial?.creationStatus ?? "planning");
    setStartDate(
      initial?.startDate && hasDate(initial.startDate) ? new Date(initial.startDate) : today,
    );
    setEndDate(
      initial?.deadline && hasDate(initial.deadline) ? new Date(initial.deadline) : undefined,
    );
    setMembers(resolveMembers());
    setFiles([]);
    setTouched({});
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // People and departments can arrive after the dialog opens; fill in whatever
  // could not be resolved yet, without overriding anything the user picked.
  useEffect(() => {
    if (!open || !initial) return;
    if (!manager && !touched.manager) setManager(resolveManager());
    if (!department && !touched.department) setDepartment(resolveDepartment());
    if (!members.length && !touched.members) setMembers(resolveMembers());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, people.length, departments.length, teams.length]);

  const projectFormSchema = useMemo(() => makeProjectFormSchema(mode === "create"), [mode]);
  const result = projectFormSchema.safeParse({
    name,
    projectType,
    category,
    client,
    manager,
    department,
    status,
    startDate,
    endDate,
  });
  const errors = result.success ? {} : result.error.flatten().fieldErrors;
  const duration =
    endDate && endDate >= startDate ? differenceInCalendarDays(endDate, startDate) + 1 : null;

  const close = () => {
    if (!submitting) onClose();
  };

  const addFiles = (picked: File[]) => {
    const refused = picked
      .map((file) => ({ file, reason: validateFile(file) }))
      .filter((item) => item.reason);
    if (refused.length) {
      toast.error(refused.map((item) => `${item.file.name} ${item.reason}`).join("; "));
    }
    const accepted = picked.filter((file) => !validateFile(file));
    if (accepted.length) setFiles((current) => [...current, ...accepted]);
  };

  /** Write an edit to work_projects and project_members. */
  const persistEdit = async (id: string, project: ProjectExt): Promise<boolean> => {
    const saved = await updateProjectRow(id, {
      name: project.name,
      description: project.description ?? "",
      startDate: project.startDate,
      dueDate: project.deadline,
      priority: project.priority,
      projectType: project.projectType,
      clientName: project.projectType === "client" ? project.client : "",
      categoryName: project.category !== (initial?.category ?? "") ? project.category : undefined,
      managerId: project.managerId,
      departmentId: project.departmentId,
      teamId: project.teamId,
      // Only when changed: ProjectWorkspace folds completed and cancelled into
      // "active" before opening this form, so re-sending an untouched status
      // would silently reopen a finished project.
      status: status !== (initial?.creationStatus ?? "planning") ? status : undefined,
    });
    if (!saved) {
      toast.error("Your changes could not be saved.");
      return false;
    }
    if (!(await setProjectMembers(id, project.teamIds ?? []))) {
      toast.error("The project was saved, but its team members could not be updated.");
    }
    if (files.length && project.orgId) {
      await attachProjectFiles({ id, organizationId: project.orgId }, files);
    }
    editing?.onSaved(project);
    return true;
  };

  const submit = async () => {
    setTouched({
      name: true,
      category: true,
      client: true,
      manager: true,
      department: true,
      status: true,
      startDate: true,
      endDate: true,
    });
    if (!result.success || !endDate || submitting) return;
    const selectedManager = directory.find((person) => person.id === manager);
    if (!selectedManager) {
      toast.error("The selected project manager is no longer available. Please pick another.");
      return;
    }
    const selectedTeam = directory.filter(
      (person) => members.includes(person.id) && person.id !== selectedManager.id,
    );
    const team = [selectedManager, ...selectedTeam];
    const scope = parseScope(department);
    const trimmedName = name.trim();
    const now = new Date().toISOString();
    const project: ProjectExt = {
      // In create mode the caller replaces this with the id the database returns.
      id: rowId ?? "",
      projectId: rowId ? displayId(rowId) : undefined,
      name: trimmedName,
      description: description.trim(),
      projectType,
      client: projectType === "client" ? client.trim() : "Internal",
      category,
      manager: toPerson(selectedManager),
      managerId: selectedManager.id,
      department: departmentOptions.find((item) => item.value === department && item.value)?.label,
      departmentId: scope.departmentId,
      teamId: scope.teamId,
      priority,
      creationStatus: status,
      attachmentNames: files.map((file) => file.name),
      createdAt: editingProject?.createdAt ?? now,
      updatedAt: now,
      // Stored as the local calendar day. toISOString() used to shift a
      // midnight date into the previous day for anyone east of UTC.
      startDate: `${localDate(startDate)}T00:00:00`,
      deadline: `${localDate(endDate)}T23:59:59`,
      team: team.map(toPerson),
      teamIds: team.map((person) => person.id),
      members: team.length,
      progress: editingProject?.progress ?? 0,
      taskCount: editingProject?.taskCount ?? 0,
      pendingTasks: editingProject?.pendingTasks ?? 0,
      health: editingProject?.health ?? "no-tasks",
      risk: editingProject?.risk ?? "low",
      color: editingProject?.color ?? projectColor(trimmedName),
      orgId: formOrgId,
      isNew: mode === "create",
    };
    setSubmitting(true);
    try {
      if (mode === "edit" && rowId && !(await persistEdit(rowId, project))) return;
      await onSubmit(project, mode === "create" ? files : []);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[88vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>{mode === "edit" ? "Edit Project" : "Create New Project"}</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 gap-5 overflow-y-auto px-6 py-5">
          <FormControl
            id={`${uid}-name`}
            label="Project Name*"
            error={touched.name ? errors.name?.[0] : undefined}
          >
            <Input
              id={`${uid}-name`}
              value={name}
              maxLength={120}
              onBlur={() => setTouched((value) => ({ ...value, name: true }))}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. LMS Version 2 Development"
              aria-invalid={Boolean(touched.name && errors.name)}
            />
          </FormControl>
          <div className="grid gap-2">
            <Label htmlFor={`${uid}-description`}>Description</Label>
            <Textarea
              id={`${uid}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Briefly describe the objective, scope and expected outcome..."
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${uid}-type`}>Project Type*</Label>
              <Select
                value={projectType}
                onValueChange={(value: "internal" | "client") => {
                  setProjectType(value);
                  if (value === "internal") setClient("");
                }}
              >
                <SelectTrigger id={`${uid}-type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Internal Project</SelectItem>
                  <SelectItem value="client">Client Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <FormControl
              id={`${uid}-category`}
              label={mode === "create" ? "Category*" : "Category"}
              error={touched.category ? errors.category?.[0] : undefined}
            >
              <Select
                value={category}
                onValueChange={(value) => {
                  setCategory(value);
                  setTouched((state) => ({ ...state, category: true }));
                }}
              >
                <SelectTrigger id={`${uid}-category`}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((item) => (
                    <SelectItem key={item.id} value={item.name}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
          </div>

          {projectType === "client" && (
            // Free text: there is no clients table, and the old picker offered
            // five invented companies (FD-014).
            <FormControl
              id={`${uid}-client`}
              label="Client*"
              error={touched.client ? errors.client?.[0] : undefined}
            >
              <Input
                id={`${uid}-client`}
                value={client}
                maxLength={120}
                onBlur={() => setTouched((state) => ({ ...state, client: true }))}
                onChange={(event) => setClient(event.target.value)}
                placeholder="Client or organization name"
                aria-invalid={Boolean(touched.client && errors.client)}
              />
            </FormControl>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormControl
              id={`${uid}-manager`}
              label="Project Manager*"
              error={touched.manager ? errors.manager?.[0] : undefined}
            >
              <SearchableSingle
                id={`${uid}-manager`}
                value={manager}
                onChange={(value) => {
                  setManager(value);
                  setTouched((state) => ({ ...state, manager: true }));
                }}
                placeholder="Assign project manager"
                emptyText={people.length ? "No people match." : "No people found yet."}
                options={directory.map((person) => ({
                  value: person.id,
                  label: person.name,
                  detail: personDetail(person),
                  person,
                }))}
              />
            </FormControl>
            <FormControl id={`${uid}-department`} label="Department / Team">
              <SearchableSingle
                id={`${uid}-department`}
                value={department}
                onChange={(value) => {
                  setDepartment(value);
                  setTouched((state) => ({ ...state, department: true }));
                }}
                placeholder="Select department or team"
                emptyText="No departments or teams set up yet."
                options={departmentOptions}
              />
            </FormControl>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor={`${uid}-priority`}>Priority</Label>
              <Select
                value={priority}
                onValueChange={(value: typeof priority) => setPriority(value)}
              >
                <SelectTrigger id={`${uid}-priority`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <FormControl id={`${uid}-status`} label="Status*">
              <Select value={status} onValueChange={(value: typeof status) => setStatus(value)}>
                <SelectTrigger id={`${uid}-status`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on-hold">On Hold</SelectItem>
                </SelectContent>
              </Select>
            </FormControl>
          </div>

          <div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormControl
                id={`${uid}-start`}
                label="Start Date*"
                error={touched.startDate ? errors.startDate?.[0] : undefined}
              >
                <DatePicker
                  id={`${uid}-start`}
                  value={startDate}
                  onChange={(value) => {
                    if (value) setStartDate(value);
                    setTouched((state) => ({ ...state, startDate: true }));
                  }}
                  placeholder="Select start date"
                />
              </FormControl>
              <FormControl
                id={`${uid}-end`}
                label="Target End Date*"
                error={touched.endDate ? errors.endDate?.[0] : undefined}
              >
                <DatePicker
                  id={`${uid}-end`}
                  value={endDate}
                  onChange={(value) => {
                    setEndDate(value);
                    setTouched((state) => ({ ...state, endDate: true }));
                  }}
                  placeholder="Select target end date"
                />
              </FormControl>
            </div>
            {duration && (
              <p className="mt-2 text-xs text-muted-foreground">
                Project duration: {duration} days
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${uid}-members`}>Team Members</Label>
            <TeamMemberPicker
              id={`${uid}-members`}
              selected={members}
              onChange={(value) => {
                setMembers(value);
                setTouched((state) => ({ ...state, members: true }));
              }}
              directory={directory}
              scope={department}
              manager={manager}
              departmentChoices={orgDepartments}
              teamChoices={orgTeams}
            />
          </div>

          <div className="grid gap-2">
            <input
              ref={fileInput}
              className="hidden"
              type="file"
              multiple
              accept={FILE_RULES.accept}
              aria-label="Attach files"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                // Let the same file be picked again after removing it.
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip className="h-3.5 w-3.5" /> Attach files
            </Button>
            <p className="text-[11px] text-muted-foreground">{FILE_RULES.label}</p>
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-xs"
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="text-muted-foreground">{formatBytes(file.size)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter className="shrink-0 justify-between border-t border-border bg-background px-6 py-4 sm:justify-between">
          <Button variant="ghost" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!result.success || submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting
              ? mode === "edit"
                ? "Saving Changes..."
                : "Creating Project..."
              : mode === "edit"
                ? "Save Changes"
                : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormControl({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
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

type SearchOption = {
  value: string;
  label: string;
  detail?: string;
  group?: string;
  person?: PersonOption;
};

function SearchableSingle({
  id,
  value,
  onChange,
  placeholder,
  options,
  emptyText = "No results found.",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: SearchOption[];
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = options.filter((option) =>
    `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const groups = Array.from(new Set(filtered.map((option) => option.group ?? "")));
  const selected = value ? options.find((option) => option.value === value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="h-9 w-full justify-between px-3 font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-2">
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search..."
            aria-label={`Search: ${placeholder}`}
            className="h-8 pl-8"
          />
        </div>
        <div className="max-h-56 overflow-y-auto">
          {groups.map((group) => (
            <div key={group}>
              {group && (
                <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                  {group}
                </div>
              )}
              {filtered
                .filter((option) => (option.group ?? "") === group)
                .map((option) => (
                  <button
                    type="button"
                    key={option.value || "none"}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent",
                      value === option.value && "bg-accent",
                    )}
                  >
                    {option.person && (
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
                        style={{ background: option.person.color }}
                      >
                        {option.person.initials}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{option.label}</span>
                      {option.detail && (
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {option.detail}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {options.length ? "No results found." : emptyText}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DatePicker({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  value?: Date;
  onChange: (value?: Date) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="h-9 w-full justify-start px-3 font-normal"
        >
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <span className={cn(!value && "text-muted-foreground")}>
            {value ? format(value, "MMM d, yyyy") : placeholder}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <DateCalendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange(date);
            if (date) setOpen(false);
          }}
          initialFocus
          className="pointer-events-auto p-3"
        />
      </PopoverContent>
    </Popover>
  );
}

function TeamMemberPicker({
  id,
  selected,
  onChange,
  directory,
  scope,
  manager,
  departmentChoices,
  teamChoices,
}: {
  id?: string;
  /** User ids. */
  selected: string[];
  onChange: (value: string[]) => void;
  directory: PersonOption[];
  /** The Department / Team picker value; matching people are listed first. */
  scope: string;
  /** Manager user id — already on the team, so not offered again. */
  manager: string;
  departmentChoices: { id: string; name: string }[];
  teamChoices: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [draft, setDraft] = useState<string[]>(selected);
  const visibleMembers = expanded ? selected : selected.slice(0, 3);
  const { departmentId: scopeDepartment, teamId: scopeTeam } = parseScope(scope);
  const inScope = (person: PersonOption) =>
    Boolean(
      (scopeDepartment && person.departmentId === scopeDepartment) ||
      (scopeTeam && person.teamId === scopeTeam),
    );
  const options = [...directory]
    .sort((a, b) => Number(inScope(b)) - Number(inScope(a)))
    .filter(
      (person) =>
        person.id !== manager &&
        `${person.name} ${person.title} ${person.department} ${person.team}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (departmentFilter === "all" || person.departmentId === departmentFilter) &&
        (teamFilter === "all" || person.teamId === teamFilter),
    );
  return (
    <div className="space-y-2">
      <Popover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value) setDraft(selected);
        }}
      >
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" size="sm" className="w-fit">
            <UserPlus className="h-3.5 w-3.5" /> Add Team Members
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[420px] max-w-[calc(100vw-3rem)] p-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search team members..."
              aria-label="Search team members"
              className="h-8 pl-8"
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="h-8 text-xs" aria-label="Filter by department">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departmentChoices.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className="h-8 text-xs" aria-label="Filter by team">
                <SelectValue placeholder="Team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teamChoices.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="my-3 max-h-60 space-y-1 overflow-y-auto">
            {options.map((person) => (
              <label
                key={person.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
              >
                <Checkbox
                  checked={draft.includes(person.id)}
                  onCheckedChange={(checked) =>
                    setDraft((current) =>
                      checked
                        ? [...current, person.id]
                        : current.filter((memberId) => memberId !== person.id),
                    )
                  }
                />
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
                  style={{ background: person.color }}
                >
                  {person.initials}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{person.name}</span>
                  {personDetail(person) && (
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {personDetail(person)}
                    </span>
                  )}
                </span>
              </label>
            ))}
            {options.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                {directory.length ? "No people match." : "No people found yet."}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              Add Selected
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visibleMembers.map((memberId) => {
            const person = directory.find((item) => item.id === memberId);
            const memberName = person?.name ?? "Unknown user";
            return (
              <span
                key={memberId}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-xs"
              >
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[8px] font-semibold text-primary-foreground"
                  style={person ? { background: person.color } : undefined}
                >
                  {person?.initials ?? "?"}
                </span>
                {memberName}
                <button
                  type="button"
                  aria-label={`Remove ${memberName}`}
                  onClick={() => onChange(selected.filter((item) => item !== memberId))}
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </span>
            );
          })}
          {!expanded && selected.length > 3 && (
            <button
              type="button"
              className="px-2 text-xs font-medium text-primary"
              onClick={() => setExpanded(true)}
            >
              +{selected.length - 3} more
            </button>
          )}
          {expanded && selected.length > 3 && (
            <button
              type="button"
              className="px-2 text-xs text-muted-foreground"
              onClick={() => setExpanded(false)}
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
