import {
  BUTTON_MOBILE_CSS,
  SECTION_VISIBLE_LIMIT,
  SUMMARY_MOBILE_CSS,
  bodyText,
  escapeHtml,
  greeting,
  groupBlock,
  organizationCard,
  primaryButton,
  renderEmailDocument,
  stat,
  statRows,
  taskLink,
  viewAllRow,
  type RenderContext,
  type RenderedEmail,
} from "./shared";

export type DailyManagementSummaryVariables = {
  firstName: string;
  date: string;
  completedCount: string;
  dueTodayCount: string;
  overdueCount: string;
  blockedCount: string;
  reviewCount: string;
  /** The organization's name for the review status; defaults to "Awaiting review". */
  reviewLabel?: string;
  unassignedCount: string;
  /** Trusted HTML from buildManagementOrganizationSections. */
  organizationSections: string;
  dashboardUrl: string;
};

export type ManagementBadge = "Critical" | "High" | "Overdue" | "Blocked" | "Review" | "Unassigned";

/** A badge coloured as `tone` but reading `label`, e.g. an organization's name for review. */
export type LabelledBadge = { tone: ManagementBadge; label: string };

export type ManagementTask = {
  title: string;
  url: string;
  /** Omitted or empty renders "Unassigned". */
  assignee?: string;
  projectName?: string;
  dateLabel: string;
  badges?: (ManagementBadge | LabelledBadge)[];
};

export type ManagementGroup = {
  label: "Needs Attention" | "Due Today" | "Recently Completed";
  tasks: ManagementTask[];
  viewAllUrl?: string;
};

export type ManagementOrganization = {
  name: string;
  /** e.g. "12 open tasks · 3 need attention · 2 completed" */
  summary: string;
  groups: ManagementGroup[];
};

const BADGE_COLORS: Record<ManagementBadge, string> = {
  Critical: "background:#fce8e8;color:#8f1d1d;",
  High: "background:#fff0dc;color:#865000;",
  Overdue: "background:#fce8e8;color:#a42a2a;",
  Blocked: "background:#fff0dc;color:#865000;",
  Review: "background:#eaf1ff;color:#1452ad;",
  Unassigned: "background:#edf1f6;color:#4d5870;",
};

const badge = (value: ManagementBadge | LabelledBadge) => {
  const { tone, label } = typeof value === "string" ? { tone: value, label: value } : value;
  return `<span style="display:inline-block;margin:0 4px 3px 0;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;line-height:14px;text-transform:uppercase;${BADGE_COLORS[tone] ?? ""}">${escapeHtml(label)}</span>`;
};

function managementTaskRow(task: ManagementTask) {
  const project = task.projectName ? ` · ${escapeHtml(task.projectName)}` : "";
  return `<tr><td style="padding:9px 0;border-bottom:1px solid #e5eaf1;">
          <div style="margin-bottom:3px;">${(task.badges ?? []).map(badge).join("")}</div>
          ${taskLink(task.url, task.title)}
          <div style="margin-top:2px;font-size:12px;line-height:18px;color:#68738a;">${escapeHtml(task.assignee || "Unassigned")}${project} · ${escapeHtml(task.dateLabel)}</div>
        </td></tr>`;
}

export function buildManagementOrganizationSections(
  organizations: ManagementOrganization[],
): string {
  return organizations
    .map((organization) => {
      const groupsHtml = organization.groups
        .filter((group) => group.tasks.length > 0)
        .map((group) => {
          const rows = group.tasks.slice(0, SECTION_VISIBLE_LIMIT).map(managementTaskRow).join("");
          return groupBlock(
            group.label,
            rows + viewAllRow(group.label, group.tasks.length, group.viewAllUrl),
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

export function buildDailyManagementSummaryEmail(
  variables: DailyManagementSummaryVariables,
  ctx: RenderContext,
): RenderedEmail {
  const stats = statRows(
    [
      [
        stat(variables.completedCount, "Recently completed", "#e9f7ef", "#26734d"),
        stat(variables.dueTodayCount, "Due today", "#fff4df", "#8a5700"),
        stat(variables.overdueCount, "Overdue", "#fce8e8", "#a42a2a"),
      ],
      [
        stat(variables.blockedCount, "Blocked", "#fff0dc", "#865000"),
        stat(
          variables.reviewCount,
          variables.reviewLabel || "Awaiting review",
          "#eaf1ff",
          "#1452ad",
        ),
        stat(variables.unassignedCount, "Unassigned", "#edf1f6", "#4d5870"),
      ],
    ],
    "33.33%",
    "10px 6px",
  );
  const content = `${greeting(variables.firstName)}
              ${bodyText("Here’s your team overview for today.", "0 0 22px")}
              ${stats}
              ${variables.organizationSections}
              ${bodyText("Review overdue work, resolve blockers and assign ownership where needed to keep your teams moving.", "28px 0 0")}
              ${primaryButton(variables.dashboardUrl, "Open Dashboard")}`;

  return renderEmailDocument(
    {
      title: `Flowdesk daily management summary — ${variables.date}`,
      preheader: `Your management overview for ${variables.date}.`,
      mobileCss: [SUMMARY_MOBILE_CSS, BUTTON_MOBILE_CSS],
      content,
    },
    ctx,
  );
}
