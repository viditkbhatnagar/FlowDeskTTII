import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

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

interface TaskSettingsContextValue {
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
  const [taskStatuses, setTaskStatuses] = useState<TaskStatusConfig[]>(seedTaskStatuses);
  const [projectCategories, setProjectCategories] = useState<ProjectCategory[]>(seedCategories);
  const [tags, setTags] = useState<TagConfig[]>(seedTags);

  const resequence = useCallback(
    (list: TaskStatusConfig[]) => list.map((item, index) => ({ ...item, order: index + 1 })),
    [],
  );

  const value = useMemo<TaskSettingsContextValue>(() => {
    const ordered = [...taskStatuses].sort((a, b) => a.order - b.order);
    return {
      taskStatuses: ordered,
      activeTaskStatuses: ordered.filter((s) => s.status === "active"),
      defaultTaskStatus: ordered.find((s) => s.isDefault),
      completedTaskStatus: ordered.find((s) => s.isCompletedState),
      addTaskStatus: ({ name, type, status }) =>
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
        ]),
      updateTaskStatus: (id, updates) =>
        setTaskStatuses((current) => current.map((s) => (s.id === id ? { ...s, ...updates } : s))),
      reorderTaskStatuses: (fromId, toId) =>
        setTaskStatuses((current) => {
          const list = [...current].sort((a, b) => a.order - b.order);
          const from = list.findIndex((s) => s.id === fromId);
          const to = list.findIndex((s) => s.id === toId);
          if (from < 0 || to < 0 || from === to) return current;
          const [moved] = list.splice(from, 1);
          list.splice(to, 0, moved);
          return resequence(list);
        }),
      setTaskStatusActive: (id, status) =>
        setTaskStatuses((current) =>
          current.map((s) =>
            s.id === id && !(status === "inactive" && (s.isDefault || s.isCompletedState))
              ? { ...s, status }
              : s,
          ),
        ),
      setDefaultTaskStatus: (id) =>
        setTaskStatuses((current) =>
          current.map((s) => ({ ...s, isDefault: s.id === id, status: s.id === id ? "active" : s.status })),
        ),
      setCompletedTaskStatus: (id) =>
        setTaskStatuses((current) =>
          current.map((s) => ({
            ...s,
            isCompletedState: s.id === id,
            status: s.id === id ? "active" : s.status,
          })),
        ),
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
      addCategory: (input) =>
        setProjectCategories((current) => [
          ...current,
          { ...input, name: input.name.trim(), id: `PC-${current.length + 1}-${Date.now()}` },
        ]),
      updateCategory: (id, updates) =>
        setProjectCategories((current) => current.map((c) => (c.id === id ? { ...c, ...updates } : c))),
      setCategoryStatus: (id, status) =>
        setProjectCategories((current) => current.map((c) => (c.id === id ? { ...c, status } : c))),
      isCategoryNameTaken: (name, exceptId) =>
        projectCategories.some((c) => c.id !== exceptId && normalize(c.name) === normalize(name)),

      tags,
      activeTags: tags.filter((t) => t.status === "active"),
      addTag: (name) =>
        setTags((current) => [
          ...current,
          { id: `TG-${current.length + 1}-${Date.now()}`, name: name.trim(), status: "active" },
        ]),
      renameTag: (id, name) =>
        setTags((current) => current.map((t) => (t.id === id ? { ...t, name: name.trim() } : t))),
      setTagStatus: (id, status) =>
        setTags((current) => current.map((t) => (t.id === id ? { ...t, status } : t))),
      isTagNameTaken: (name, exceptId) =>
        tags.some((t) => t.id !== exceptId && normalize(t.name) === normalize(name)),
    };
  }, [taskStatuses, projectCategories, tags, resequence]);

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
