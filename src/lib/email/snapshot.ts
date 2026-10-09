import type { EmailKind, PreferenceKind, ScheduledKind } from "./kinds";

// Wire shapes of the email worker RPCs (public.email_worker_*). The SQL builds
// these with jsonb_build_object, so every key here is camelCase and every date
// is an ISO string: DATE columns as "YYYY-MM-DD", TIMESTAMPTZ as full ISO.

export type TaskStatus = "todo" | "progress" | "review" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type AppRole = "admin" | "manager" | "team_lead" | "employee" | "viewer";

export type KindToggles = Record<PreferenceKind, boolean>;

export type OrgEmailSettings = KindToggles & {
  enabled: boolean;
  sendHour: number;
  workingDays: number[];
  weeklyDay: number;
};

export type SnapshotOrganization = {
  id: string;
  name: string;
  timezone: string;
  settings: OrgEmailSettings;
};

export type SnapshotPerson = {
  userId: string;
  fullName: string | null;
  /** The app shows it wherever a person has no full name. */
  username: string | null;
  email: string | null;
  status: "active" | "inactive" | string;
};

export type SnapshotPreferences = KindToggles & { userId: string };

export type SnapshotMembership = {
  userId: string;
  organizationId: string;
  isPrimary: boolean;
  status: "active" | "inactive" | string;
  // Reporting lines (9 Oct 2026, group tasks): who manages the person here, for who may see a
  // task. Absent from a snapshot RPC older than that, which lookup.ts treats as managing no one.
  departmentId?: string | null;
  teamId?: string | null;
  reportingManagerId?: string | null;
};

/** A department's head manages everyone in it (private.manages_person). */
export type SnapshotDepartment = { id: string; organizationId: string; headUserId: string | null };

/** A team's lead manages everyone on it (private.manages_person). */
export type SnapshotTeam = { id: string; organizationId: string; leadUserId: string | null };

export type SnapshotRole = { userId: string; organizationId: string; role: AppRole };

export type SnapshotProject = {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  startDate: string | null;
  dueDate: string | null;
  archivedAt: string | null;
  /**
   * Who may open it besides the organization's admins and managers and its team
   * (20260930000100_project_access.sql). Absent from a snapshot RPC older than that.
   */
  ownerId: string;
  /** The Project Manager. */
  managerId: string | null;
};

export type SnapshotProjectMember = { projectId: string; userId: string; roleLabel: string | null };

export type SnapshotTask = {
  id: string;
  organizationId: string;
  projectId: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** NULL on a group task's parent (each person's part is a child); see parentTaskId. */
  assigneeId: string | null;
  reviewerId: string | null;
  createdBy: string;
  /**
   * Set on a group task's child: one per person, pointing at the group (the parent). Absent from
   * a snapshot RPC older than 9 Oct 2026, where there are no groups.
   */
  parentTaskId?: string | null;
  dueDate: string | null;
  dueAt: string | null;
  blocked: boolean;
  progress: number;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

/**
 * total excludes cancelled tasks; done counts status = 'done' (see project-metrics.ts). A group
 * task counts once, as its parent: rows with a parentTaskId are left out.
 */
export type SnapshotProjectCount = { projectId: string; total: number; done: number };

export type SnapshotLabel = { organizationId: string; value: string; label: string };

/** public.email_worker_snapshot(p_secret) */
export type EmailSnapshot = {
  generatedAt: string;
  organizations: SnapshotOrganization[];
  people: SnapshotPerson[];
  /** Only users who have saved preferences; everyone else has every kind on. */
  preferences: SnapshotPreferences[];
  memberships: SnapshotMembership[];
  /**
   * Every department and team, for their heads and leads. Absent from a snapshot RPC older than
   * 9 Oct 2026: then nobody manages anybody (lookup.ts fails closed).
   */
  departments?: SnapshotDepartment[];
  teams?: SnapshotTeam[];
  roles: SnapshotRole[];
  projects: SnapshotProject[];
  projectMembers: SnapshotProjectMember[];
  /**
   * Non-archived tasks that are open, or were completed/cancelled in the last 15 days.
   * Older closed tasks only matter as project totals, which come from projectCounts.
   */
  tasks: SnapshotTask[];
  /** Per project, over every non-archived task: the inputs projectProgress needs. */
  projectCounts: SnapshotProjectCount[];
  /** Org-configured display labels (task_priority_settings / task_status_settings). */
  priorityLabels: SnapshotLabel[];
  statusLabels: SnapshotLabel[];
};

/** One row for public.email_worker_enqueue(p_secret, p_rows). Scheduled kinds only. */
export type OutboxInsert = {
  kind: ScheduledKind;
  dedupeKey: string;
  recipientUserId: string;
  organizationId: string | null;
  taskId: string | null;
  projectId: string | null;
  payload: Record<string, unknown>;
  notBefore: string;
  expiresAt: string;
};

/** One element of public.email_worker_claim(p_secret, p_limit). */
export type ClaimedEmail = {
  id: string;
  kind: EmailKind;
  dedupeKey: string;
  recipientUserId: string | null;
  recipientEmail: string | null;
  organizationId: string | null;
  taskId: string | null;
  projectId: string | null;
  actorId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: string;
};

/** One element of p_results for public.email_worker_complete(p_secret, p_results). */
export type EmailResult =
  | { id: string; outcome: "sent" }
  | { id: string; outcome: "suppressed"; error: string }
  | { id: string; outcome: "retry"; error: string }
  | { id: string; outcome: "failed"; error: string }
  /** Throttled or misconfigured sender: back to pending without using up an attempt. */
  | { id: string; outcome: "defer"; error: string; retryAfterSeconds: number };
