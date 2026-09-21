import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Search,
  Filter,
  LayoutGrid,
  List as ListIcon,
  GanttChart,
  Calendar,
  Users,
  AlertTriangle,
  ChevronRight,
  MoreHorizontal,
  CheckCircle2,
  Clock,
  FolderKanban,
  FileText,
  MessageSquare,
  Activity,
  Paperclip,
  ArrowLeft,
  ChevronsUpDown,
  UserPlus,
  X,
  Loader2,
  ClipboardCheck,
} from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { toast } from "sonner";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { projects as baseProjects, tasks, allPeople, type Project } from "@/lib/mock-data";
import { useOrganizations } from "@/lib/organizations-data";
import { useTaskSettings, projectCategoryRotation } from "@/lib/task-settings-data";
import { ProjectWorkspace } from "./ProjectWorkspace";
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

type ProjectExt = Project & {
  client: string;
  startDate: string;
  manager: { name: string; initials: string; color: string };
  team: { name: string; initials: string; color: string }[];
  pendingTasks: number;
  risk: "low" | "medium" | "high";
  category: string;
  description?: string;
  projectId?: string;
  projectType?: "internal" | "client";
  department?: string;
  priority?: "low" | "medium" | "high" | "critical";
  creationStatus?: "planning" | "active" | "on-hold";
  attachmentNames?: string[];
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
  isNew?: boolean;
};

const clients = ["Northwind Co.", "Lumen Labs", "Pioneer Bank", "Atlas Studios", "Helix Health"];
const categories = projectCategoryRotation;

const projectsData: ProjectExt[] = baseProjects.map((p, i) => ({
  ...p,
  client: clients[i % clients.length],
  startDate: new Date(Date.now() - (30 + i * 5) * 86400000).toISOString(),
  manager: allPeople[i % allPeople.length],
  team: allPeople.slice(0, 3 + (i % 3)),
  pendingTasks: tasks.filter((t) => t.project === p.name && t.status !== "done").length || 3 + i,
  risk: (["low", "medium", "high"] as const)[i % 3],
  category: categories[i % categories.length],
}));

const statusStyles: Record<Project["status"], string> = {
  "on-track":
    "bg-[color:var(--status-done)]/15 text-[color:var(--status-done)] border-[color:var(--status-done)]/30",
  "at-risk":
    "bg-[color:var(--priority-medium)]/15 text-[color:var(--priority-medium)] border-[color:var(--priority-medium)]/30",
  delayed:
    "bg-[color:var(--priority-critical)]/15 text-[color:var(--priority-critical)] border-[color:var(--priority-critical)]/30",
};

const statusLabel: Record<Project["status"], string> = {
  "on-track": "On track",
  "at-risk": "At risk",
  delayed: "Delayed",
};

const riskColor: Record<ProjectExt["risk"], string> = {
  low: "text-[color:var(--status-done)]",
  medium: "text-[color:var(--priority-medium)]",
  high: "text-[color:var(--priority-critical)]",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ProjectsPage({ onNewTask: _onNewTask, dashboardFilter }: { onNewTask?: () => void; dashboardFilter?: string }) {
  const [projectItems, setProjectItems] = useState<ProjectExt[]>(projectsData);
  const [view, setView] = useState<"grid" | "list" | "timeline">("grid");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<ProjectExt | null>(null);

  const { activeOrgId, projects: orgProjects } = useOrganizations();

  useEffect(() => {
    if (!dashboardFilter?.startsWith("project:")) return;
    const projectName = decodeURIComponent(dashboardFilter.slice(8));
    const match = projectItems.find((project) => project.name === projectName);
    if (match) setSelected(match);
  }, [dashboardFilter, projectItems]);

  const filtered = useMemo(() => {
    return projectItems.filter((p) => {
      if (activeOrgId !== "all") {
        const link = orgProjects.find((op) => op.id === p.id);
        // Projects created in-session without an organization link stay visible.
        if (link && link.orgId !== activeOrgId) return false;
      }
      const q = query.trim().toLowerCase();
      if (q && !p.name.toLowerCase().includes(q) && !p.client.toLowerCase().includes(q))
        return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      return true;
    });
  }, [projectItems, query, statusFilter, activeOrgId, orgProjects]);

  const metrics = useMemo(() => {
    const total = projectItems.length;
    const active = projectItems.filter((p) => p.progress < 100 && p.status !== "delayed").length;
    const completed = projectItems.filter((p) => p.progress === 100).length;
    const delayed = projectItems.filter((p) => p.status === "delayed").length;
    return { total, active, completed, delayed };
  }, [projectItems]);

  const handleProjectCreated = (project: ProjectExt) => {
    setProjectItems((current) => [project, ...current]);
    setCreateOpen(false);
    setSelected(project);
    toast.success("Project created successfully");
  };

  if (selected) {
    return (
      <>
        <ProjectWorkspace
          project={selected}
          onBack={() => setSelected(null)}
          onDuplicate={(source) => {
            const duplicate = {
              ...source,
              id: `P-${projectItems.length + 1}`,
              projectId: `PRJ-${String(projectItems.length + 121).padStart(5, "0")}`,
              name: `${source.name} Copy`,
              isNew: true,
            };
            setProjectItems((current) => [duplicate as ProjectExt, ...current]);
            setSelected(duplicate as ProjectExt);
          }}
          onDelete={(projectId) =>
            setProjectItems((current) => current.filter((item) => item.id !== projectId))
          }
        />
        <ProjectFormDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSubmit={handleProjectCreated}
          nextNumber={projectItems.length + 120}
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Projects</h2>
            <p className="text-sm text-muted-foreground">
              {projectItems.length} projects • {metrics.active} active this quarter
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects…"
                className="h-9 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[140px] text-xs">
                <Filter className="h-3.5 w-3.5 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="on-track">On track</SelectItem>
                <SelectItem value="at-risk">At risk</SelectItem>
                <SelectItem value="delayed">Delayed</SelectItem>
              </SelectContent>
            </Select>
            <div className="inline-flex items-center rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
              {[
                { id: "grid", Icon: LayoutGrid },
                { id: "list", Icon: ListIcon },
                { id: "timeline", Icon: GanttChart },
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
                  aria-label={v.id}
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

        {/* Metrics */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Metric icon={FolderKanban} label="Total" value={metrics.total} tint="primary" />
          <Metric icon={Activity} label="Active" value={metrics.active} tint="primary" />
          <Metric icon={CheckCircle2} label="Completed" value={metrics.completed} tint="done" />
          <Metric icon={AlertTriangle} label="Delayed" value={metrics.delayed} tint="critical" />
        </div>

        {/* Views */}
        {view === "grid" && (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <ProjectCard key={p.id} project={p} onOpen={() => setSelected(p)} />
            ))}
          </div>
        )}
        {view === "list" && <ProjectList items={filtered} onOpen={(p) => setSelected(p)} />}
        {view === "timeline" && <ProjectTimeline items={filtered} onOpen={(p) => setSelected(p)} />}
      </div>

      <ProjectFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleProjectCreated}
        nextNumber={projectItems.length + 120}
      />
    </>
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
            <div className="text-xs text-muted-foreground truncate">{project.client}</div>
          </div>
        </div>
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-[10px] font-medium shrink-0",
            statusStyles[project.status],
          )}
        >
          {statusLabel[project.status]}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Calendar className="h-3 w-3" />
        {fmtDate(project.startDate)} → {fmtDate(project.deadline)}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Progress</span>
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
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {project.pendingTasks}
          </span>
          <span className={cn("inline-flex items-center gap-1", riskColor[project.risk])}>
            <AlertTriangle className="h-3 w-3" /> {project.risk}
          </span>
          <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition" />
        </div>
      </div>
    </button>
  );
}

function AvatarStack({ people }: { people: { initials: string; color: string; name: string }[] }) {
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
              <div className="text-xs text-muted-foreground truncate">{p.client}</div>
            </div>
          </div>
          <div>
            <span
              className={cn(
                "rounded-md border px-2 py-0.5 text-[10px] font-medium",
                statusStyles[p.status],
              )}
            >
              {statusLabel[p.status]}
            </span>
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
  const min = Math.min(...items.map((p) => new Date(p.startDate).getTime()));
  const max = Math.max(...items.map((p) => new Date(p.deadline).getTime()));
  const span = max - min || 1;
  const months: string[] = [];
  const cursor = new Date(min);
  cursor.setDate(1);
  while (cursor.getTime() <= max) {
    months.push(cursor.toLocaleDateString(undefined, { month: "short" }));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="grid grid-cols-[220px_1fr] border-b border-border">
        <div className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          Project
        </div>
        <div
          className="grid border-l border-border"
          style={{ gridTemplateColumns: `repeat(${months.length}, 1fr)` }}
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
        const start = ((new Date(p.startDate).getTime() - min) / span) * 100;
        const end = ((new Date(p.deadline).getTime() - min) / span) * 100;
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
              <div
                className="absolute top-1/2 -translate-y-1/2 h-5 rounded-md flex items-center px-2 text-[10px] font-medium text-white shadow-sm"
                style={{
                  left: `${start}%`,
                  width: `${Math.max(4, end - start)}%`,
                  background: p.color,
                  opacity: p.status === "delayed" ? 0.7 : 1,
                  outline: p.status === "delayed" ? "1px dashed var(--priority-critical)" : "none",
                }}
              >
                {p.progress}%
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Create Project Dialog ---------- */
type PersonOption = (typeof allPeople)[number] & {
  title: string;
  department: string;
  team: string;
};

const peopleOptions: PersonOption[] = allPeople.map((person, index) => ({
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
  team:
    ["Operations", "Product", "Development Team", "Creative Team", "Finance"][index] ??
    "Operations",
}));

const clientOptions = [
  "Northwind Co.",
  "Lumen Labs",
  "Pioneer Bank",
  "Atlas Studios",
  "Helix Health",
];
const departmentOptions = [
  { value: "Operations", group: "Departments" },
  { value: "Technology", group: "Departments" },
  { value: "Marketing", group: "Departments" },
  { value: "Finance", group: "Departments" },
  { value: "Development Team", group: "Teams", detail: "Technology" },
  { value: "Creative Team", group: "Teams", detail: "Marketing" },
];

const projectFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Project name is required.")
      .max(120, "Project name must be 120 characters or fewer."),
    projectType: z.enum(["internal", "client"]),
    category: z.string().min(1, "Please select a category."),
    client: z.string(),
    manager: z.string().min(1, "Please select a project manager."),
    department: z.string().min(1, "Please select a department or team."),
    status: z.enum(["planning", "active", "on-hold"]),
    startDate: z.date({ required_error: "Please select a start date." }),
    endDate: z.date({ required_error: "Please select a target end date." }),
  })
  .superRefine((value, context) => {
    if (value.projectType === "client" && !value.client) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["client"],
        message: "Please select a client for a client project.",
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
  | "status"
  | "startDate"
  | "endDate";

export type ProjectFormInitial = {
  name: string;
  description?: string;
  projectType?: "internal" | "client";
  category?: string;
  client?: string;
  manager: string;
  department?: string;
  priority?: "low" | "medium" | "high" | "critical";
  creationStatus?: "planning" | "active" | "on-hold";
  startDate?: string;
  deadline?: string;
  teamNames?: string[];
};

export function ProjectFormDialog({
  open,
  onClose,
  onSubmit,
  nextNumber,
  mode = "create",
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (project: ProjectExt) => void;
  nextNumber: number;
  mode?: "create" | "edit";
  initial?: ProjectFormInitial;
}) {
  const today = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectType, setProjectType] = useState<"internal" | "client">("internal");
  const { activeOrgId } = useOrganizations();
  const { categoriesFor } = useTaskSettings();
  const categoryOptions = categoriesFor(activeOrgId);
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

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setProjectType(initial?.projectType ?? "internal");
    setCategory(initial?.category ?? "");
    setClient(initial?.client && initial.client !== "Internal" ? initial.client : "");
    setManager(initial?.manager ?? "");
    setDepartment(initial?.department ?? "");
    setPriority(initial?.priority ?? "medium");
    setStatus(initial?.creationStatus ?? "planning");
    setStartDate(initial?.startDate ? new Date(initial.startDate) : today);
    setEndDate(initial?.deadline ? new Date(initial.deadline) : undefined);
    setMembers(initial?.teamNames ?? []);
    setFiles([]);
    setTouched({});
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    const selectedManager = peopleOptions.find((person) => person.name === manager);
    if (!selectedManager) return;
    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const selectedTeam = peopleOptions.filter((person) => members.includes(person.name));
    const team = [
      selectedManager,
      ...selectedTeam.filter((person) => person.name !== selectedManager.name),
    ];
    const mappedStatus: Project["status"] = status === "on-hold" ? "at-risk" : "on-track";
    onSubmit({
      id: `P-${nextNumber}`,
      projectId: `PRJ-${String(nextNumber).padStart(5, "0")}`,
      name: name.trim(),
      description: description.trim(),
      projectType,
      client: projectType === "client" ? client : "Internal",
      category,
      manager: selectedManager,
      department,
      priority,
      creationStatus: status,
      attachmentNames: files.map((file) => file.name),
      createdBy: manager,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: mappedStatus,
      startDate: startDate.toISOString(),
      deadline: endDate.toISOString(),
      team,
      members: team.length,
      progress: 0,
      pendingTasks: 0,
      risk: "low",
      color: selectedManager.color,
      isNew: true,
    });
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent className="max-h-[88vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>{mode === "edit" ? "Edit Project" : "Create New Project"}</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 gap-5 overflow-y-auto px-6 py-5">
          <FormControl label="Project Name*" error={touched.name ? errors.name?.[0] : undefined}>
            <Input
              value={name}
              maxLength={120}
              onBlur={() => setTouched((value) => ({ ...value, name: true }))}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. LMS Version 2 Development"
              aria-invalid={Boolean(touched.name && errors.name)}
            />
          </FormControl>
          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Briefly describe the objective, scope and expected outcome..."
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Project Type*</Label>
              <Select
                value={projectType}
                onValueChange={(value: "internal" | "client") => {
                  setProjectType(value);
                  if (value === "internal") setClient("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Internal Project</SelectItem>
                  <SelectItem value="client">Client Project</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <FormControl
              label="Category*"
              error={touched.category ? errors.category?.[0] : undefined}
            >
              <Select
                value={category}
                onValueChange={(value) => {
                  setCategory(value);
                  setTouched((state) => ({ ...state, category: true }));
                }}
              >
                <SelectTrigger>
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
            <FormControl label="Client*" error={touched.client ? errors.client?.[0] : undefined}>
              <SearchableSingle
                value={client}
                onChange={(value) => {
                  setClient(value);
                  setTouched((state) => ({ ...state, client: true }));
                }}
                placeholder="Select client"
                options={clientOptions.map((item) => ({ value: item, label: item }))}
              />
            </FormControl>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormControl
              label="Project Manager*"
              error={touched.manager ? errors.manager?.[0] : undefined}
            >
              <SearchableSingle
                value={manager}
                onChange={(value) => {
                  setManager(value);
                  setTouched((state) => ({ ...state, manager: true }));
                }}
                placeholder="Assign project manager"
                options={peopleOptions.map((person) => ({
                  value: person.name,
                  label: person.name,
                  detail: `${person.title} · ${person.department}`,
                  person,
                }))}
              />
            </FormControl>
            <FormControl
              label="Department / Team*"
              error={touched.department ? errors.department?.[0] : undefined}
            >
              <SearchableSingle
                value={department}
                onChange={(value) => {
                  setDepartment(value);
                  setTouched((state) => ({ ...state, department: true }));
                }}
                placeholder="Select department or team"
                options={departmentOptions.map((item) => ({
                  value: item.value,
                  label: item.value,
                  detail: item.detail,
                  group: item.group,
                }))}
              />
            </FormControl>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(value: typeof priority) => setPriority(value)}
              >
                <SelectTrigger>
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
            <FormControl label="Status*">
              <Select value={status} onValueChange={(value: typeof status) => setStatus(value)}>
                <SelectTrigger>
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
                label="Start Date*"
                error={touched.startDate ? errors.startDate?.[0] : undefined}
              >
                <DatePicker
                  value={startDate}
                  onChange={(value) => {
                    if (value) setStartDate(value);
                    setTouched((state) => ({ ...state, startDate: true }));
                  }}
                  placeholder="Select start date"
                />
              </FormControl>
              <FormControl
                label="Target End Date*"
                error={touched.endDate ? errors.endDate?.[0] : undefined}
              >
                <DatePicker
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
            <Label>Team Members</Label>
            <TeamMemberPicker
              selected={members}
              onChange={setMembers}
              department={department}
              manager={manager}
            />
          </div>

          <div className="grid gap-2">
            <input
              ref={fileInput}
              className="hidden"
              type="file"
              multiple
              onChange={(event) =>
                setFiles((current) => [...current, ...Array.from(event.target.files ?? [])])
              }
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
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-xs"
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="text-muted-foreground">{formatFileSize(file.size)}</span>
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
          <Button onClick={submit} disabled={!result.success || submitting}>
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
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
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
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: SearchOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = options.filter((option) =>
    `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const groups = Array.from(new Set(filtered.map((option) => option.group ?? "")));
  const selected = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
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
                    key={option.value}
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
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No results found.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DatePicker({
  value,
  onChange,
  placeholder,
}: {
  value?: Date;
  onChange: (value?: Date) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
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
  selected,
  onChange,
  department,
  manager,
}: {
  selected: string[];
  onChange: (value: string[]) => void;
  department: string;
  manager: string;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [draft, setDraft] = useState<string[]>(selected);
  const visibleMembers = expanded ? selected : selected.slice(0, 3);
  const options = [...peopleOptions]
    .sort(
      (a, b) =>
        Number(b.department === department || b.team === department) -
        Number(a.department === department || a.team === department),
    )
    .filter(
      (person) =>
        person.name !== manager &&
        `${person.name} ${person.title} ${person.department}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (departmentFilter === "all" || person.department === departmentFilter) &&
        (teamFilter === "all" || person.team === teamFilter),
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
          <Button type="button" variant="outline" size="sm" className="w-fit">
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
              className="h-8 pl-8"
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {Array.from(new Set(peopleOptions.map((person) => person.department))).map(
                  (item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Select value={teamFilter} onValueChange={setTeamFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {Array.from(new Set(peopleOptions.map((person) => person.team))).map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="my-3 max-h-60 space-y-1 overflow-y-auto">
            {options.map((person) => (
              <label
                key={person.name}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
              >
                <Checkbox
                  checked={draft.includes(person.name)}
                  onCheckedChange={(checked) =>
                    setDraft((current) =>
                      checked
                        ? [...current, person.name]
                        : current.filter((name) => name !== person.name),
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
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {person.title} · {person.department}
                  </span>
                </span>
              </label>
            ))}
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
          {visibleMembers.map((name) => {
            const person = peopleOptions.find((item) => item.name === name);
            return (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-xs"
              >
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-primary-foreground"
                  style={{ background: person?.color }}
                >
                  {person?.initials}
                </span>
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => onChange(selected.filter((item) => item !== name))}
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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
