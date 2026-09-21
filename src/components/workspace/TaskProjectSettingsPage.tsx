import { useEffect, useMemo, useState } from "react";
import {
  Plus, MoreHorizontal, Pencil, Ban, CheckCircle2, GripVertical, Lock, Circle, Tag as TagIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrganizations } from "@/lib/organizations-data";
import { projects as demoProjects } from "@/lib/mock-data";
import {
  useTaskSettings, taskStatusTypeOptions, projectCategoryRotation,
  type ConfigStatus, type ProjectCategory, type TaskStatusConfig, type TaskStatusType, type TagConfig,
} from "@/lib/task-settings-data";

const inputClass =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";
const labelClass = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const primaryBtn =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-50";
const cardClass = "overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-soft)]";
const thClass = "px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const tdClass = "px-4 py-3 align-middle";

function StatusPill({ status }: { status: ConfigStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        status === "active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {status === "active" ? "Active" : "Inactive"}
    </span>
  );
}

const tabs = [
  { id: "task-status", label: "Task Status" },
  { id: "priority", label: "Priority" },
  { id: "project-category", label: "Project Category" },
  { id: "project-status", label: "Project Status" },
  { id: "tags", label: "Tags" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function TaskProjectSettingsPage() {
  const [tab, setTab] = useState<TabId>("task-status");

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Task &amp; Project Settings</h2>
        <p className="text-sm text-muted-foreground">
          One place to configure the statuses, priorities, categories and tags used across the workspace.
        </p>
      </div>

      <div className="inline-flex flex-wrap items-center rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition",
              tab === item.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "task-status" && <TaskStatusTab />}
      {tab === "priority" && <PriorityTab />}
      {tab === "project-category" && <CategoryTab />}
      {tab === "project-status" && <ProjectStatusTab />}
      {tab === "tags" && <TagsTab />}
    </div>
  );
}

/* ---------------------------------- Task Status ---------------------------------- */

function TaskStatusTab() {
  const {
    taskStatuses, reorderTaskStatuses, setTaskStatusActive, setDefaultTaskStatus,
    setCompletedTaskStatus,
  } = useTaskSettings();
  const [drawer, setDrawer] = useState<TaskStatusConfig | "new" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Drag to reorder. One status is the default for new tasks and one marks work as complete.
        </p>
        <button className={primaryBtn} onClick={() => setDrawer("new")}>
          <Plus className="h-4 w-4" /> Add Status
        </button>
      </div>

      <div className={cardClass}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className={cn(thClass, "w-10")} />
                <th className={thClass}>Status Name</th>
                <th className={thClass}>Type</th>
                <th className={thClass}>Order</th>
                <th className={thClass}>Status</th>
                <th className={cn(thClass, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {taskStatuses.map((status) => (
                <tr
                  key={status.id}
                  draggable
                  onDragStart={() => setDragId(status.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragId) reorderTaskStatuses(dragId, status.id);
                    setDragId(null);
                  }}
                  className={cn(
                    "border-b border-border/60 last:border-0 transition hover:bg-accent/40",
                    dragId === status.id && "opacity-50",
                  )}
                >
                  <td className={cn(tdClass, "cursor-grab text-muted-foreground")}>
                    <GripVertical className="h-4 w-4" />
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{status.name}</span>
                      {status.isDefault && (
                        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          Default
                        </span>
                      )}
                      {status.isCompletedState && (
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          Completed state
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cn(tdClass, "text-muted-foreground")}>
                    {taskStatusTypeOptions.find((t) => t.value === status.type)?.label ?? status.type}
                  </td>
                  <td className={cn(tdClass, "text-muted-foreground")}>{status.order}</td>
                  <td className={tdClass}>
                    <StatusPill status={status.status} />
                  </td>
                  <td className={cn(tdClass, "text-right")}>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => setDrawer(status)}>
                          <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={status.isDefault}
                          onClick={() => {
                            setDefaultTaskStatus(status.id);
                            toast.success(`${status.name} is now the default status.`);
                          }}
                        >
                          <Circle className="mr-2 h-3.5 w-3.5" /> Set as default
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={status.isCompletedState}
                          onClick={() => {
                            setCompletedTaskStatus(status.id);
                            toast.success(`${status.name} now marks tasks complete.`);
                          }}
                        >
                          <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Set as completed state
                        </DropdownMenuItem>
                        {status.status === "active" ? (
                          <DropdownMenuItem
                            disabled={status.isDefault || status.isCompletedState}
                            onClick={() => {
                              setTaskStatusActive(status.id, "inactive");
                              toast.success(`${status.name} deactivated. Existing tasks keep this status.`);
                            }}
                          >
                            <Ban className="mr-2 h-3.5 w-3.5" /> Deactivate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => setTaskStatusActive(status.id, "active")}>
                            <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Activate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Statuses are never deleted — deactivating hides a status from new work while historical tasks keep it.
      </p>

      <TaskStatusDrawer target={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

function TaskStatusDrawer({
  target,
  onClose,
}: {
  target: TaskStatusConfig | "new" | null;
  onClose: () => void;
}) {
  const { addTaskStatus, updateTaskStatus, isTaskStatusNameTaken } = useTaskSettings();
  const editing = target && target !== "new" ? target : null;
  const [name, setName] = useState("");
  const [type, setType] = useState<TaskStatusType>("open");
  const [status, setStatus] = useState<ConfigStatus>("active");
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const targetKey = editing?.id ?? (target === "new" ? "new" : "none");
  useEffect(() => {
    setName(editing?.name ?? "");
    setType(editing?.type ?? "open");
    setStatus(editing?.status ?? "active");
    setError(null);
    setKey((k) => k + 1);
  }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!name.trim()) return setError("Status name is required.");
    if (isTaskStatusNameTaken(name, editing?.id)) return setError("That status name already exists.");
    if (editing) {
      updateTaskStatus(editing.id, { name: name.trim(), type, status });
      toast.success("Status updated.");
    } else {
      addTaskStatus({ name, type, status });
      toast.success("Status added.");
    }
    onClose();
  };

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto" key={key}>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit Status" : "Add Status"}</SheetTitle>
          <SheetDescription>Statuses appear as columns and filters across task views.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <div className={labelClass}>Status Name*</div>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <div className={labelClass}>Type</div>
            <select
              className={inputClass}
              value={type}
              onChange={(e) => setType(e.target.value as TaskStatusType)}
            >
              {taskStatusTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <div className={labelClass}>Status</div>
            <select
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as ConfigStatus)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button className={ghostBtn} onClick={onClose}>
              Cancel
            </button>
            <button className={primaryBtn} onClick={submit}>
              {editing ? "Save Changes" : "Add Status"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------------------------- Priority ---------------------------------- */

function PriorityTab() {
  const { priorities: list } = useTaskSettings();
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Priority levels are system defined so reporting stays consistent. They cannot be added or removed.
      </p>
      <div className={cardClass}>
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className={thClass}>Priority</th>
              <th className={thClass}>Indicator</th>
              <th className={thClass}>Order</th>
              <th className={cn(thClass, "text-right")}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((priority) => (
              <tr key={priority.id} className="border-b border-border/60 last:border-0">
                <td className={cn(tdClass, "font-medium")}>
                  <span className="inline-flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full", priority.dotClass)} />
                    {priority.name}
                  </span>
                </td>
                <td className={tdClass}>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                      priority.badgeClass,
                    )}
                  >
                    {priority.name}
                  </span>
                </td>
                <td className={cn(tdClass, "text-muted-foreground")}>{priority.order}</td>
                <td className={cn(tdClass, "text-right text-xs text-muted-foreground")}>
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5" /> System defined
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------ Project Category ------------------------------ */

function CategoryTab() {
  const { projectCategories, setCategoryStatus } = useTaskSettings();
  const { organizations } = useOrganizations();
  const [drawer, setDrawer] = useState<ProjectCategory | "new" | null>(null);

  const activeProjects = useMemo(() => {
    const counts = new Map<string, number>();
    demoProjects.forEach((_, index) => {
      const name = projectCategoryRotation[index % projectCategoryRotation.length];
      counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return counts;
  }, []);

  const orgLabel = (category: ProjectCategory) =>
    category.scope === "global"
      ? "All Organizations"
      : category.orgIds
          .map((id) => organizations.find((o) => o.id === id)?.code ?? id)
          .join(", ") || "—";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Categories group projects. Keep them global, or limit them to specific organizations.
        </p>
        <button className={primaryBtn} onClick={() => setDrawer("new")}>
          <Plus className="h-4 w-4" /> Add Category
        </button>
      </div>

      <div className={cardClass}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className={thClass}>Category</th>
                <th className={thClass}>Organization</th>
                <th className={thClass}>Active Projects</th>
                <th className={thClass}>Status</th>
                <th className={cn(thClass, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projectCategories.map((category) => (
                <tr key={category.id} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                  <td className={cn(tdClass, "font-medium")}>{category.name}</td>
                  <td className={cn(tdClass, "text-muted-foreground")}>{orgLabel(category)}</td>
                  <td className={cn(tdClass, "text-muted-foreground")}>
                    {activeProjects.get(category.name) ?? 0}
                  </td>
                  <td className={tdClass}>
                    <StatusPill status={category.status} />
                  </td>
                  <td className={cn(tdClass, "text-right")}>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => setDrawer(category)}>
                          <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                        </DropdownMenuItem>
                        {category.status === "active" ? (
                          <DropdownMenuItem
                            onClick={() => {
                              setCategoryStatus(category.id, "inactive");
                              toast.success(`${category.name} deactivated. Existing projects are unchanged.`);
                            }}
                          >
                            <Ban className="mr-2 h-3.5 w-3.5" /> Deactivate
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => setCategoryStatus(category.id, "active")}>
                            <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Activate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CategoryDrawer target={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

function CategoryDrawer({
  target,
  onClose,
}: {
  target: ProjectCategory | "new" | null;
  onClose: () => void;
}) {
  const { addCategory, updateCategory, isCategoryNameTaken } = useTaskSettings();
  const { organizations } = useOrganizations();
  const editing = target && target !== "new" ? target : null;
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"global" | "selected">("global");
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const [status, setStatus] = useState<ConfigStatus>("active");
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const targetKey = editing?.id ?? (target === "new" ? "new" : "none");
  useEffect(() => {
    setName(editing?.name ?? "");
    setScope(editing?.scope ?? "global");
    setOrgIds(editing?.orgIds ?? []);
    setStatus(editing?.status ?? "active");
    setError(null);
    setKey((k) => k + 1);
  }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!name.trim()) return setError("Category name is required.");
    if (isCategoryNameTaken(name, editing?.id)) return setError("That category already exists.");
    if (scope === "selected" && orgIds.length === 0)
      return setError("Select at least one organization.");
    const payload = { name, scope, orgIds: scope === "global" ? [] : orgIds, status };
    if (editing) {
      updateCategory(editing.id, payload);
      toast.success("Category updated.");
    } else {
      addCategory(payload);
      toast.success("Category added.");
    }
    onClose();
  };

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto" key={key}>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit Category" : "Add Category"}</SheetTitle>
          <SheetDescription>Categories appear when creating and filtering projects.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <div className={labelClass}>Category Name*</div>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <div className={labelClass}>Available For</div>
            <select
              className={inputClass}
              value={scope}
              onChange={(e) => setScope(e.target.value as "global" | "selected")}
            >
              <option value="global">All Organizations</option>
              <option value="selected">Selected Organization(s)</option>
            </select>
          </div>
          {scope === "selected" && (
            <div className="space-y-1.5">
              <div className={labelClass}>Organizations</div>
              <div className="space-y-1 rounded-lg border border-border p-2">
                {organizations.map((org) => (
                  <label key={org.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={orgIds.includes(org.id)}
                      onChange={(e) =>
                        setOrgIds((current) =>
                          e.target.checked
                            ? [...current, org.id]
                            : current.filter((id) => id !== org.id),
                        )
                      }
                    />
                    <span>{org.name}</span>
                    <span className="text-xs text-muted-foreground">{org.code}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <div className={labelClass}>Status</div>
            <select
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as ConfigStatus)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button className={ghostBtn} onClick={onClose}>
              Cancel
            </button>
            <button className={primaryBtn} onClick={submit}>
              {editing ? "Save Changes" : "Add Category"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------- Project Status ------------------------------- */

function ProjectStatusTab() {
  const { projectStatuses: list } = useTaskSettings();
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Project statuses are system defined. Project health (On Track, At Risk, Delayed) is calculated
        automatically from dates and progress, and is not configured here.
      </p>
      <div className={cardClass}>
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className={thClass}>Status</th>
              <th className={thClass}>Meaning</th>
              <th className={cn(thClass, "text-right")}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((status) => (
              <tr key={status.id} className="border-b border-border/60 last:border-0">
                <td className={cn(tdClass, "font-medium")}>{status.name}</td>
                <td className={cn(tdClass, "text-muted-foreground")}>{status.description}</td>
                <td className={cn(tdClass, "text-right text-xs text-muted-foreground")}>
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5" /> System defined
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------ Tags ------------------------------------ */

function TagsTab() {
  const { tags, addTag, renameTag, setTagStatus, isTagNameTaken } = useTaskSettings();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<TagConfig | null>(null);
  const [editName, setEditName] = useState("");

  const create = () => {
    if (!draft.trim()) return;
    if (isTagNameTaken(draft)) {
      toast.error("That tag already exists.");
      return;
    }
    addTag(draft);
    setDraft("");
    toast.success("Tag added.");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={cn(inputClass, "max-w-xs")}
          placeholder="New tag name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
        <button className={primaryBtn} onClick={create}>
          <Plus className="h-4 w-4" /> Add Tag
        </button>
      </div>

      <div className={cardClass}>
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className={thClass}>Tag</th>
              <th className={thClass}>Status</th>
              <th className={cn(thClass, "text-right")}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.id} className="border-b border-border/60 last:border-0 hover:bg-accent/40">
                <td className={tdClass}>
                  {editing?.id === tag.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        className={cn(inputClass, "max-w-xs")}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                      <button
                        className={ghostBtn}
                        onClick={() => {
                          if (!editName.trim() || isTagNameTaken(editName, tag.id)) {
                            toast.error("Enter a unique tag name.");
                            return;
                          }
                          renameTag(tag.id, editName);
                          setEditing(null);
                          toast.success("Tag renamed.");
                        }}
                      >
                        Save
                      </button>
                      <button className={ghostBtn} onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-2 font-medium">
                      <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {tag.name}
                    </span>
                  )}
                </td>
                <td className={tdClass}>
                  <StatusPill status={tag.status} />
                </td>
                <td className={cn(tdClass, "text-right")}>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditing(tag);
                          setEditName(tag.name);
                        }}
                      >
                        <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
                      </DropdownMenuItem>
                      {tag.status === "active" ? (
                        <DropdownMenuItem onClick={() => setTagStatus(tag.id, "inactive")}>
                          <Ban className="mr-2 h-3.5 w-3.5" /> Deactivate
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => setTagStatus(tag.id, "active")}>
                          <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Activate
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Tags can be applied to both tasks and projects. Deactivated tags stay on existing records.
      </p>
    </div>
  );
}
