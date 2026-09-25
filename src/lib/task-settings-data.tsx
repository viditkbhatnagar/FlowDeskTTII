import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createCategoryRow,
  createTagRow,
  loadSettings,
  setExclusiveStatusFlag,
  updateCategoryRow,
  updateStatusSettingRow,
  updateTagRow,
} from "@/lib/admin-api";

export type ConfigStatus = "active" | "inactive";

export type TaskStatusType = "open" | "in-progress" | "review" | "completed" | "cancelled";

export interface TaskStatusConfig {
  id: string;
  name: string;
  type: TaskStatusType;
  order: number;
  status: ConfigStatus;
  isDefault: boolean;
  isCompletedState: boolean;
  /** links to the internal task status key when it maps to a built-in column */
  key?: "todo" | "progress" | "review" | "done";
  usedByHistory?: boolean;
}

export interface PriorityConfig {
  id: "low" | "medium" | "high" | "critical";
  name: string;
  dotClass: string;
  badgeClass: string;
  order: number;
}

export interface ProjectCategory {
  id: string;
  name: string;
  scope: "global" | "selected";
  orgIds: string[];
  status: ConfigStatus;
}

export interface ProjectStatusConfig {
  id: string;
  name: string;
  description: string;
}

export interface TagConfig {
  id: string;
  name: string;
  status: ConfigStatus;
}

const seedTaskStatuses: TaskStatusConfig[] = [
  {
    id: "TS-1",
    name: "To Do",
    type: "open",
    order: 1,
    status: "active",
    isDefault: true,
    isCompletedState: false,
    key: "todo",
    usedByHistory: true,
  },
  {
    id: "TS-2",
    name: "In Progress",
    type: "in-progress",
    order: 2,
    status: "active",
    isDefault: false,
    isCompletedState: false,
    key: "progress",
    usedByHistory: true,
  },
  {
    id: "TS-3",
    name: "Review",
    type: "review",
    order: 3,
    status: "active",
    isDefault: false,
    isCompletedState: false,
    key: "review",
    usedByHistory: true,
  },
  {
    id: "TS-4",
    name: "Completed",
    type: "completed",
    order: 4,
    status: "active",
    isDefault: false,
    isCompletedState: true,
    key: "done",
    usedByHistory: true,
  },
];

export const priorities: PriorityConfig[] = [
  {
    id: "low",
    name: "Low",
    dotClass: "bg-muted-foreground/50",
    badgeClass: "bg-muted text-muted-foreground",
    order: 1,
  },
  {
    id: "medium",
    name: "Medium",
    dotClass: "bg-primary/60",
    badgeClass: "bg-primary/10 text-primary",
    order: 2,
  },
  {
    id: "high",
    name: "High",
    dotClass: "bg-amber-500",
    badgeClass: "bg-amber-500/10 text-amber-600",
    order: 3,
  },
  {
    id: "critical",
    name: "Critical",
    dotClass: "bg-destructive",
    badgeClass: "bg-destructive/10 text-destructive",
    order: 4,
  },
];

export const projectStatuses: ProjectStatusConfig[] = [
  { id: "planning", name: "Planning", description: "Being defined, not started yet." },
  { id: "active", name: "Active", description: "Work is in progress." },
  { id: "on-hold", name: "On Hold", description: "Temporarily paused." },
  { id: "completed", name: "Completed", description: "All work finished." },
  { id: "cancelled", name: "Cancelled", description: "Stopped and will not continue." },
  { id: "archived", name: "Archived", description: "Closed and kept for records." },
];

const seedCategories: ProjectCategory[] = [
  { id: "PC-1", name: "Marketing", scope: "global", orgIds: [], status: "active" },
  { id: "PC-2", name: "Academic", scope: "selected", orgIds: ["ORG-2"], status: "active" },
  { id: "PC-3", name: "Technology", scope: "global", orgIds: [], status: "active" },
  { id: "PC-4", name: "Operations", scope: "global", orgIds: [], status: "active" },
  { id: "PC-5", name: "Finance", scope: "global", orgIds: [], status: "active" },
  { id: "PC-6", name: "Admissions", scope: "selected", orgIds: ["ORG-2"], status: "active" },
  { id: "PC-7", name: "Content & Production", scope: "global", orgIds: [], status: "active" },
  { id: "PC-8", name: "Business Development", scope: "selected", orgIds: ["ORG-1"], status: "active" },
  { id: "PC-9", name: "Administration", scope: "global", orgIds: [], status: "active" },
  { id: "PC-10", name: "Other", scope: "global", orgIds: [], status: "active" },
];

/** Category rotation used by the demo project data set. */
export const projectCategoryRotation = ["Technology", "Marketing", "Operations", "Academic", "Finance"];

const seedTags: TagConfig[] = [
  { id: "TG-1", name: "Urgent", status: "active" },
  { id: "TG-2", name: "Follow-up", status: "active" },
  { id: "TG-3", name: "Approval Required", status: "active" },
  { id: "TG-4", name: "Management", status: "active" },
  { id: "TG-5", name: "Campaign", status: "active" },
  { id: "TG-6", name: "Event", status: "active" },
];

const normalize = (value: string) => value.trim().toLowerCase();

/** Database value of a task status (the work_task_status enum). */
export type TaskStatusValue = "todo" | "progress" | "review" | "done" | "cancelled";

const typeForValue: Record<TaskStatusValue, TaskStatusType> = {
  todo: "open",
  progress: "in-progress",
  review: "review",
  done: "completed",
  cancelled: "cancelled",
};

const fallbackLabel: Record<TaskStatusValue, string> = {
  todo: "To Do",
  progress: "In Progress",
  review: "Waiting Approval",
  done: "Completed",
  cancelled: "Cancelled",
};

interface TaskSettingsContextValue {
  /**
   * The configured name for a status, e.g. statusLabel("review").
   * Every screen must use this: "review" used to be shown as "Waiting Approval",
   * "Under Review" and "Awaiting review" on three different screens (FD-018).
   */
  statusLabel: (value: string) => string;
  taskStatuses: TaskStatusConfig[];
  activeTaskStatuses: TaskStatusConfig[];
  defaultTaskStatus: TaskStatusConfig | undefined;
  completedTaskStatus: TaskStatusConfig | undefined;
  addTaskStatus: (input: { name: string; type: TaskStatusType; status: ConfigStatus }) => void;
  updateTaskStatus: (id: string, updates: Partial<TaskStatusConfig>) => void;
  reorderTaskStatuses: (fromId: string, toId: string) => void;
  setTaskStatusActive: (id: string, status: ConfigStatus) => void;
  setDefaultTaskStatus: (id: string) => void;
  setCompletedTaskStatus: (id: string) => void;
  isTaskStatusNameTaken: (name: string, exceptId?: string) => boolean;

  priorities: PriorityConfig[];
  projectStatuses: ProjectStatusConfig[];

  projectCategories: ProjectCategory[];
  categoriesFor: (orgId?: string) => ProjectCategory[];
  addCategory: (input: Omit<ProjectCategory, "id">) => void;
  updateCategory: (id: string, updates: Partial<ProjectCategory>) => void;
  setCategoryStatus: (id: string, status: ConfigStatus) => void;
  isCategoryNameTaken: (name: string, exceptId?: string) => boolean;

  tags: TagConfig[];
  activeTags: TagConfig[];
  addTag: (name: string) => void;
  renameTag: (id: string, name: string) => void;
  setTagStatus: (id: string, status: ConfigStatus) => void;
  isTagNameTaken: (name: string, exceptId?: string) => boolean;
}

const TaskSettingsContext = createContext<TaskSettingsContextValue | null>(null);

export function TaskSettingsProvider({ children }: { children: ReactNode }) {
  // Loaded from the database. These were hardcoded arrays, so every status
  // rename, category and tag an admin created was discarded on refresh.
  const [taskStatuses, setTaskStatuses] = useState<TaskStatusConfig[]>([]);
  const [projectCategories, setProjectCategories] = useState<ProjectCategory[]>([]);
  const [tags, setTags] = useState<TagConfig[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadSettings().then((loaded) => {
      if (!active || !loaded) return;
      setTaskStatuses(
        loaded.statuses.map((row) => ({
          id: row.id,
          // The built-in column this status maps to. Missing before, so
          // defaultTaskStatus?.key was always undefined once settings loaded and
          // "Set as default" had no effect on the New Task form.
          key: row.value === "cancelled" ? undefined : (row.value as TaskStatusConfig["key"]),
          name: row.label,
          // The enum value is the type; a status cannot exist outside it.
          type: (row.value === "todo" ? "open"
            : row.value === "progress" ? "in-progress"
            : row.value === "review" ? "review"
            : row.value === "done" ? "completed"
            : "cancelled") as TaskStatusType,
          status: row.active ? "active" : "inactive",
          order: row.order,
          isDefault: row.isDefault,
          isCompletedState: row.isCompleted,
        })),
      );
      setProjectCategories(
        loaded.categories.map((row) => ({
          id: row.id,
          name: row.name,
          scope: "selected" as const,
          orgIds: [row.orgId],
          status: row.active ? "active" : "inactive",
        })),
      );
      setTags(loaded.tags.map((row) => ({ id: row.id, name: row.name, status: row.active ? "active" : "inactive" })));
      setOrgId(loaded.categories[0]?.orgId ?? loaded.tags[0]?.orgId ?? null);
    });
    return () => { active = false; };
  }, []);

  const resequence = useCallback(
    (list: TaskStatusConfig[]) => list.map((item, index) => ({ ...item, order: index + 1 })),
    [],
  );

  const value = useMemo<TaskSettingsContextValue>(() => {
    const ordered = [...taskStatuses].sort((a, b) => a.order - b.order);
    const statusLabel = (value: string) => {
      const type = typeForValue[value as TaskStatusValue];
      return ordered.find((s) => s.type === type)?.name ?? fallbackLabel[value as TaskStatusValue] ?? value;
    };
    return {
      statusLabel,
      taskStatuses: ordered,
      activeTaskStatuses: ordered.filter((s) => s.status === "active"),
      defaultTaskStatus: ordered.find((s) => s.isDefault),
      completedTaskStatus: ordered.find((s) => s.isCompletedState),
      // A task status is backed by the work_task_status enum, so a brand-new one
      // cannot be stored — work_tasks.status could never hold it. The five that
      // exist can be renamed, reordered and deactivated; adding a sixth needs a
      // schema change. Kept local so the screen still behaves, and loud about it.
      addTaskStatus: ({ name, type, status }) =>
        (console.warn(
          "[flowdesk] A new task status cannot be saved: statuses are backed by the work_task_status enum. Rename or reorder the existing ones instead.",
        ),
        setTaskStatuses((current) => [
          ...current,
          {
            id: `TS-${current.length + 1}-${Date.now()}`,
            name: name.trim(),
            type,
            status,
            order: current.length + 1,
            isDefault: false,
            isCompletedState: false,
          },
        ])),
      updateTaskStatus: (id, updates) => {
        setTaskStatuses((current) => current.map((s) => (s.id === id ? { ...s, ...updates } : s)));
        void updateStatusSettingRow(id, {
          label: updates.name,
          order: updates.order,
          active: updates.status ? updates.status === "active" : undefined,
        });
      },
      reorderTaskStatuses: (fromId, toId) =>
        setTaskStatuses((current) => {
          const list = [...current].sort((a, b) => a.order - b.order);
          const from = list.findIndex((s) => s.id === fromId);
          const to = list.findIndex((s) => s.id === toId);
          if (from < 0 || to < 0 || from === to) return current;
          const [moved] = list.splice(from, 1);
          list.splice(to, 0, moved);
          const next = resequence(list);
          for (const item of next) void updateStatusSettingRow(item.id, { order: item.order });
          return next;
        }),
      setTaskStatusActive: (id, status) => {
        const target = taskStatuses.find((s) => s.id === id);
        // The default and the completed state must stay available.
        if (!target || (status === "inactive" && (target.isDefault || target.isCompletedState))) return;
        setTaskStatuses((current) => current.map((s) => (s.id === id ? { ...s, status } : s)));
        void updateStatusSettingRow(id, { active: status === "active" });
      },
      setDefaultTaskStatus: (id) => {
        setTaskStatuses((current) =>
          current.map((s) => ({ ...s, isDefault: s.id === id, status: s.id === id ? "active" : s.status })),
        );
        if (orgId) void setExclusiveStatusFlag(orgId, id, "is_default");
      },
      setCompletedTaskStatus: (id) => {
        setTaskStatuses((current) =>
          current.map((s) => ({
            ...s,
            isCompletedState: s.id === id,
            status: s.id === id ? "active" : s.status,
          })),
        );
        if (orgId) void setExclusiveStatusFlag(orgId, id, "is_completed");
      },
      isTaskStatusNameTaken: (name, exceptId) =>
        taskStatuses.some((s) => s.id !== exceptId && normalize(s.name) === normalize(name)),

      priorities,
      projectStatuses,

      projectCategories,
      categoriesFor: (orgId) =>
        projectCategories.filter(
          (c) =>
            c.status === "active" &&
            (c.scope === "global" || !orgId || orgId === "all" || c.orgIds.includes(orgId)),
        ),
      addCategory: (input) => {
        const tempId = `PC-pending-${Date.now()}`;
        const name = input.name.trim();
        setProjectCategories((current) => [...current, { ...input, name, id: tempId }]);
        const target = orgId ?? input.orgIds[0];
        if (target) {
          void createCategoryRow(target, name).then((realId) =>
            setProjectCategories((current) =>
              realId
                ? current.map((c) => (c.id === tempId ? { ...c, id: realId } : c))
                : current.filter((c) => c.id !== tempId),
            ),
          );
        }
      },
      updateCategory: (id, updates) => {
        setProjectCategories((current) => current.map((c) => (c.id === id ? { ...c, ...updates } : c)));
        void updateCategoryRow(id, {
          name: updates.name,
          active: updates.status ? updates.status === "active" : undefined,
        });
      },
      setCategoryStatus: (id, status) => {
        setProjectCategories((current) => current.map((c) => (c.id === id ? { ...c, status } : c)));
        void updateCategoryRow(id, { active: status === "active" });
      },
      isCategoryNameTaken: (name, exceptId) =>
        projectCategories.some((c) => c.id !== exceptId && normalize(c.name) === normalize(name)),

      tags,
      activeTags: tags.filter((t) => t.status === "active"),
      addTag: (name) => {
        const tempId = `TG-pending-${Date.now()}`;
        const clean = name.trim();
        setTags((current) => [...current, { id: tempId, name: clean, status: "active" }]);
        if (orgId) {
          void createTagRow(orgId, clean).then((realId) =>
            setTags((current) =>
              realId
                ? current.map((t) => (t.id === tempId ? { ...t, id: realId } : t))
                : current.filter((t) => t.id !== tempId),
            ),
          );
        }
      },
      renameTag: (id, name) => {
        const clean = name.trim();
        setTags((current) => current.map((t) => (t.id === id ? { ...t, name: clean } : t)));
        void updateTagRow(id, { name: clean });
      },
      setTagStatus: (id, status) => {
        setTags((current) => current.map((t) => (t.id === id ? { ...t, status } : t)));
        void updateTagRow(id, { active: status === "active" });
      },
      isTagNameTaken: (name, exceptId) =>
        tags.some((t) => t.id !== exceptId && normalize(t.name) === normalize(name)),
    };
  }, [taskStatuses, projectCategories, tags, resequence, orgId]);

  return <TaskSettingsContext.Provider value={value}>{children}</TaskSettingsContext.Provider>;
}

export function useTaskSettings() {
  const context = useContext(TaskSettingsContext);
  if (!context) throw new Error("useTaskSettings must be used inside TaskSettingsProvider");
  return context;
}

export const taskStatusTypeOptions: { value: TaskStatusType; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in-progress", label: "In Progress" },
  { value: "review", label: "Review" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
