export const EMAIL_KINDS = [
  "account_access",
  "project_invitation",
  "task_assigned",
  "due_reminder",
  "overdue_alert",
  "daily_digest",
  "weekly_digest",
  "daily_management",
  "weekly_management",
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

// account_access is transactional (it is how a new person gets in), so it can
// never be switched off by an organization or opted out of by the recipient.
export const PREFERENCE_KINDS = [
  "project_invitation",
  "task_assigned",
  "due_reminder",
  "overdue_alert",
  "daily_digest",
  "weekly_digest",
  "daily_management",
  "weekly_management",
] as const satisfies readonly EmailKind[];

export type PreferenceKind = (typeof PREFERENCE_KINDS)[number];

export const SCHEDULED_KINDS = [
  "due_reminder",
  "overdue_alert",
  "daily_digest",
  "weekly_digest",
  "daily_management",
  "weekly_management",
] as const satisfies readonly EmailKind[];

export type ScheduledKind = (typeof SCHEDULED_KINDS)[number];

export const MANAGEMENT_KINDS = [
  "daily_management",
  "weekly_management",
] as const satisfies readonly PreferenceKind[];

export const EMAIL_KIND_LABELS: Record<PreferenceKind, { label: string; description: string }> = {
  task_assigned: {
    label: "Task assigned",
    description: "When someone assigns a task to you.",
  },
  project_invitation: {
    label: "Added to a project",
    description: "When someone adds you to a project team.",
  },
  due_reminder: {
    label: "Due-date reminder",
    description: "The working day before one of your tasks is due.",
  },
  overdue_alert: {
    label: "Overdue alert",
    description: "Once, the first working day after one of your tasks becomes overdue.",
  },
  daily_digest: {
    label: "Daily task digest",
    description: "Each working morning: your overdue, due-today and upcoming tasks.",
  },
  weekly_digest: {
    label: "Weekly task digest",
    description: "Once a week: what you completed and what is coming up.",
  },
  daily_management: {
    label: "Daily management summary",
    description: "Each working morning, for admins, managers and team leads: what needs attention.",
  },
  weekly_management: {
    label: "Weekly management summary",
    description: "Once a week, for admins, managers and team leads: the week in review.",
  },
};

export const ISO_WEEKDAYS = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 7, short: "Sun", long: "Sunday" },
] as const;

export const DEFAULT_EMAIL_SETTINGS = {
  enabled: true,
  send_hour: 8,
  working_days: [1, 2, 3, 4, 5],
  weekly_day: 1,
} as const;
