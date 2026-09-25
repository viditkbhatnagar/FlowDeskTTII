import {
  BUTTON_MOBILE_CSS,
  SUMMARY_MOBILE_CSS,
  bodyText,
  buildTaskListSections,
  greeting,
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

export type DailyTaskDigestVariables = {
  firstName: string;
  date: string;
  overdueCount: string;
  dueTodayCount: string;
  upcomingCount: string;
  completedCount: string;
  /** Trusted HTML from buildOrganizationSections. */
  organizationSections: string;
  myTasksUrl: string;
};

export type DigestGroupLabel = "Overdue" | "Due Today" | "Upcoming" | "Recently Completed";
export type DigestTask = ListTask;
export type DigestGroup = ListGroup<DigestGroupLabel>;
export type DigestOrganization = ListOrganization<DigestGroupLabel>;

export const buildOrganizationSections = (organizations: DigestOrganization[]): string =>
  buildTaskListSections(organizations);

export function buildDailyTaskDigestEmail(
  variables: DailyTaskDigestVariables,
  ctx: RenderContext,
): RenderedEmail {
  const stats = statRows(
    [
      [
        stat(variables.overdueCount, "Overdue", "#fce8e8", "#a42a2a"),
        stat(variables.dueTodayCount, "Due today", "#fff4df", "#8a5700"),
        stat(variables.upcomingCount, "Upcoming", "#eaf1ff", "#1468ff"),
        stat(variables.completedCount, "Completed", "#e9f7ef", "#26734d"),
      ],
    ],
    "25%",
    "10px 8px",
  );
  const content = `${greeting(variables.firstName)}
              ${bodyText("Here’s your task summary for today.", "0 0 22px")}
              ${stats}
              ${variables.organizationSections}
              ${bodyText("Start with overdue tasks and today’s deadlines. Keep your progress updated and flag any blockers in Flowdesk.", "28px 0 0")}
              ${primaryButton(variables.myTasksUrl, "Open My Tasks")}`;

  return renderEmailDocument(
    {
      title: `Your Flowdesk daily task summary — ${variables.date}`,
      preheader: `Your Flowdesk task summary for ${variables.date}.`,
      mobileCss: [SUMMARY_MOBILE_CSS, BUTTON_MOBILE_CSS],
      content,
    },
    ctx,
  );
}
