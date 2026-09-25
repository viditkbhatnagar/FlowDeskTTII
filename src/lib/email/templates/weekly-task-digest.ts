import {
  BUTTON_MOBILE_CSS,
  SUMMARY_MOBILE_CSS,
  bodyText,
  buildTaskListSections,
  greeting,
  periodLabel,
  primaryButton,
  renderEmailDocument,
  stat,
  statRows,
  type ListGroup,
  type ListOrganization,
  type ListTask,
  type RenderContext,
  type RenderedEmail,
} from "./shared";

export type WeeklyTaskDigestVariables = {
  firstName: string;
  dateRange: string;
  completedCount: string;
  openCount: string;
  overdueCount: string;
  nextWeekCount: string;
  /** Trusted HTML from buildWeeklyOrganizationSections. */
  organizationSections: string;
  myTasksUrl: string;
};

export type WeeklyGroupLabel = "Completed" | "Overdue" | "Due Next Week" | "Other Open Tasks";
export type WeeklyTask = ListTask;
export type WeeklyGroup = ListGroup<WeeklyGroupLabel>;
export type WeeklyOrganization = ListOrganization<WeeklyGroupLabel>;

export const buildWeeklyOrganizationSections = (organizations: WeeklyOrganization[]): string =>
  buildTaskListSections(organizations);

export function buildWeeklyTaskDigestEmail(
  variables: WeeklyTaskDigestVariables,
  ctx: RenderContext,
): RenderedEmail {
  const stats = statRows(
    [
      [
        stat(variables.completedCount, "Completed", "#e9f7ef", "#26734d"),
        stat(variables.openCount, "Currently open", "#edf1f6", "#101b36"),
        stat(variables.overdueCount, "Overdue", "#fce8e8", "#a42a2a"),
        stat(variables.nextWeekCount, "Due next week", "#eaf1ff", "#1468ff"),
      ],
    ],
    "25%",
    "10px 8px",
  );
  const content = `${greeting(variables.firstName)}
              ${bodyText("Here’s a summary of your week and what needs attention next.", "0 0 8px")}
              ${periodLabel(variables.dateRange)}
              ${stats}
              ${variables.organizationSections}
              ${bodyText("Review any overdue work and plan your upcoming priorities in Flowdesk.", "28px 0 0")}
              ${primaryButton(variables.myTasksUrl, "Open My Tasks")}`;

  return renderEmailDocument(
    {
      title: `Your Flowdesk weekly summary — ${variables.dateRange}`,
      preheader: `Your Flowdesk weekly summary for ${variables.dateRange}.`,
      mobileCss: [SUMMARY_MOBILE_CSS, BUTTON_MOBILE_CSS],
      content,
    },
    ctx,
  );
}
