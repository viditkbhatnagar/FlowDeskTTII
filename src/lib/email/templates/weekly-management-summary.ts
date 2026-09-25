import {
  BUTTON_MOBILE_CSS,
  SECTION_VISIBLE_LIMIT,
  SUMMARY_MOBILE_CSS,
  bodyText,
  escapeHtml,
  greeting,
  groupBlock,
  organizationCard,
  periodLabel,
  primaryButton,
  renderEmailDocument,
  stat,
  statRows,
  taskLink,
  viewAllRow,
  type RenderContext,
  type RenderedEmail,
} from "./shared";

export type WeeklyManagementSummaryVariables = {
  firstName: string;
  dateRange: string;
  completedCount: string;
  overdueCount: string;
  blockedCount: string;
  reviewCount: string;
  /** The organization's name for the review status; defaults to "Awaiting review". */
  reviewLabel?: string;
  attentionProjectCount: string;
  nextWeekCount: string;
  /** Trusted HTML from buildWeeklyManagementOrganizationSections. */
  organizationSections: string;
  dashboardUrl: string;
};

/**
 * A row in a weekly section: a task, a person (no url) or a project. `badgeTone` picks the
 * badge colour when its text is not one of the fixed names, e.g. an organization's review label.
 */
export type DetailItem = {
  title: string;
  url?: string;
  meta: string;
  badge?: string;
  badgeTone?: string;
};

export type SummarySectionLabel =
  | "Progress"
  | "Needs Attention"
  | "Team Workload"
  | "Project Health"
  | "Next Week";

export type SummarySection = {
  label: SummarySectionLabel;
  items: DetailItem[];
  viewAllUrl?: string;
};

export type SummaryOrganization = { name: string; summary: string; sections: SummarySection[] };

function badgeStyle(badge: string) {
  if (badge === "At risk" || badge === "Delayed" || badge === "Overdue" || badge === "Critical") {
    return "background:#fce8e8;color:#a42a2a;";
  }
  if (badge === "Blocked" || badge === "High") return "background:#fff0dc;color:#865000;";
  if (badge === "On track" || badge === "Completed") return "background:#e9f7ef;color:#26734d;";
  return "background:#eaf1ff;color:#1452ad;";
}

function detailItemRow(item: DetailItem) {
  const title = item.url
    ? taskLink(item.url, item.title)
    : `<span style="font-size:14px;font-weight:700;line-height:21px;color:#101b36;">${escapeHtml(item.title)}</span>`;
  const badge = item.badge
    ? `<span style="display:inline-block;margin:0 0 3px 6px;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;line-height:14px;text-transform:uppercase;${badgeStyle(item.badgeTone ?? item.badge)}">${escapeHtml(item.badge)}</span>`
    : "";
  return `<tr><td style="padding:9px 0;border-bottom:1px solid #e5eaf1;">${title}${badge}<div style="margin-top:2px;font-size:12px;line-height:18px;color:#68738a;">${escapeHtml(item.meta)}</div></td></tr>`;
}

export function buildWeeklyManagementOrganizationSections(
  organizations: SummaryOrganization[],
): string {
  return organizations
    .map((organization) => {
      const groupsHtml = organization.sections
        .filter((section) => section.items.length > 0)
        .map((section) => {
          const rows = section.items.slice(0, SECTION_VISIBLE_LIMIT).map(detailItemRow).join("");
          return groupBlock(
            section.label,
            rows + viewAllRow(section.label, section.items.length, section.viewAllUrl),
          );
        })
        .join("");
      return organizationCard({
        name: organization.name,
        summary: organization.summary,
        groupsHtml,
      });
    })
    .join("");
}

export function buildWeeklyManagementSummaryEmail(
  variables: WeeklyManagementSummaryVariables,
  ctx: RenderContext,
): RenderedEmail {
  const stats = statRows(
    [
      [
        stat(variables.completedCount, "Completed", "#e9f7ef", "#26734d"),
        stat(variables.overdueCount, "Currently overdue", "#fce8e8", "#a42a2a"),
        stat(variables.blockedCount, "Blocked", "#fff0dc", "#865000"),
      ],
      [
        stat(
          variables.reviewCount,
          variables.reviewLabel || "Awaiting review",
          "#eaf1ff",
          "#1452ad",
        ),
        stat(variables.attentionProjectCount, "Projects at risk", "#fce8e8", "#a42a2a"),
        stat(variables.nextWeekCount, "Due next week", "#eaf1ff", "#1468ff"),
      ],
    ],
    "33.33%",
    "10px 6px",
  );
  const content = `${greeting(variables.firstName)}
              ${bodyText("Here’s your weekly overview of team progress and priorities for the week ahead.", "0 0 8px")}
              ${periodLabel(variables.dateRange)}
              ${stats}
              ${variables.organizationSections}
              ${bodyText("Review outstanding issues, confirm task ownership and align your teams on next week’s priorities.", "28px 0 0")}
              ${primaryButton(variables.dashboardUrl, "Open Dashboard")}`;

  return renderEmailDocument(
    {
      title: `Flowdesk weekly management summary — ${variables.dateRange}`,
      preheader: `Your weekly management overview for ${variables.dateRange}.`,
      mobileCss: [SUMMARY_MOBILE_CSS, BUTTON_MOBILE_CSS],
      content,
    },
    ctx,
  );
}
