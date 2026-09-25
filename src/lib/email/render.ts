import { buildAccountAccessEmail, type AccountAccessVariables } from "./templates/account-access";
import {
  buildDailyManagementSummaryEmail,
  buildManagementOrganizationSections,
  type DailyManagementSummaryVariables,
  type ManagementOrganization,
} from "./templates/daily-management-summary";
import {
  buildDailyTaskDigestEmail,
  buildOrganizationSections,
  type DailyTaskDigestVariables,
  type DigestOrganization,
} from "./templates/daily-task-digest";
import { buildDueDateReminderEmail, type DueDateReminderVariables } from "./templates/due-reminder";
import { buildOverdueAlertEmail, type OverdueAlertVariables } from "./templates/overdue-alert";
import {
  buildProjectInvitationEmail,
  type ProjectInvitationVariables,
} from "./templates/project-invitation";
import type { RenderContext, RenderedEmail } from "./templates/shared";
import { buildTaskAssignedEmail, type TaskAssignedVariables } from "./templates/task-assigned";
import {
  buildWeeklyManagementOrganizationSections,
  buildWeeklyManagementSummaryEmail,
  type SummaryOrganization,
  type WeeklyManagementSummaryVariables,
} from "./templates/weekly-management-summary";
import {
  buildWeeklyOrganizationSections,
  buildWeeklyTaskDigestEmail,
  type WeeklyOrganization,
  type WeeklyTaskDigestVariables,
} from "./templates/weekly-task-digest";

export type { RenderContext, RenderedEmail } from "./templates/shared";
export type { AccountAccessVariables } from "./templates/account-access";
export type { ProjectInvitationVariables } from "./templates/project-invitation";
export type { TaskAssignedVariables } from "./templates/task-assigned";
export type { DueDateReminderVariables } from "./templates/due-reminder";
export type { OverdueAlertVariables } from "./templates/overdue-alert";
export type {
  DailyTaskDigestVariables,
  DigestGroup,
  DigestGroupLabel,
  DigestOrganization,
  DigestTask,
} from "./templates/daily-task-digest";
export type {
  WeeklyGroup,
  WeeklyGroupLabel,
  WeeklyOrganization,
  WeeklyTask,
  WeeklyTaskDigestVariables,
} from "./templates/weekly-task-digest";
export type {
  DailyManagementSummaryVariables,
  LabelledBadge,
  ManagementBadge,
  ManagementGroup,
  ManagementOrganization,
  ManagementTask,
} from "./templates/daily-management-summary";
export type {
  DetailItem,
  SummaryOrganization,
  SummarySection,
  SummarySectionLabel,
  WeeklyManagementSummaryVariables,
} from "./templates/weekly-management-summary";

type WithOrganizations<Variables, Organization> = Omit<Variables, "organizationSections"> & {
  organizations: Organization[];
};

export type DailyDigestInput = WithOrganizations<DailyTaskDigestVariables, DigestOrganization>;
export type WeeklyDigestInput = WithOrganizations<WeeklyTaskDigestVariables, WeeklyOrganization>;
export type DailyManagementInput = WithOrganizations<
  DailyManagementSummaryVariables,
  ManagementOrganization
>;
export type WeeklyManagementInput = WithOrganizations<
  WeeklyManagementSummaryVariables,
  SummaryOrganization
>;

export function renderAccountAccess(v: AccountAccessVariables, ctx: RenderContext): RenderedEmail {
  return buildAccountAccessEmail(v, ctx);
}

export function renderProjectInvitation(
  v: ProjectInvitationVariables,
  ctx: RenderContext,
): RenderedEmail {
  return buildProjectInvitationEmail(v, ctx);
}

export function renderTaskAssigned(v: TaskAssignedVariables, ctx: RenderContext): RenderedEmail {
  return buildTaskAssignedEmail(v, ctx);
}

export function renderDueReminder(v: DueDateReminderVariables, ctx: RenderContext): RenderedEmail {
  return buildDueDateReminderEmail(v, ctx);
}

export function renderOverdueAlert(v: OverdueAlertVariables, ctx: RenderContext): RenderedEmail {
  return buildOverdueAlertEmail(v, ctx);
}

export function renderDailyDigest(v: DailyDigestInput, ctx: RenderContext): RenderedEmail {
  const { organizations, ...rest } = v;
  return buildDailyTaskDigestEmail(
    { ...rest, organizationSections: buildOrganizationSections(organizations) },
    ctx,
  );
}

export function renderWeeklyDigest(v: WeeklyDigestInput, ctx: RenderContext): RenderedEmail {
  const { organizations, ...rest } = v;
  return buildWeeklyTaskDigestEmail(
    { ...rest, organizationSections: buildWeeklyOrganizationSections(organizations) },
    ctx,
  );
}

export function renderDailyManagement(v: DailyManagementInput, ctx: RenderContext): RenderedEmail {
  const { organizations, ...rest } = v;
  return buildDailyManagementSummaryEmail(
    { ...rest, organizationSections: buildManagementOrganizationSections(organizations) },
    ctx,
  );
}

export function renderWeeklyManagement(
  v: WeeklyManagementInput,
  ctx: RenderContext,
): RenderedEmail {
  const { organizations, ...rest } = v;
  return buildWeeklyManagementSummaryEmail(
    { ...rest, organizationSections: buildWeeklyManagementOrganizationSections(organizations) },
    ctx,
  );
}
