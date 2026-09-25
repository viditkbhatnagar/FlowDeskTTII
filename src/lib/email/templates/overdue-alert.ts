import {
  BUTTON_MOBILE_CSS,
  bodyText,
  detailsMobileCss,
  detailsTable,
  escapeHtml,
  greeting,
  optionalRow,
  primaryButton,
  renderEmailDocument,
  type RenderContext,
  type RenderedEmail,
} from "./shared";

export type OverdueAlertVariables = {
  firstName: string;
  taskTitle: string;
  organizationName: string;
  projectName: string;
  priority: string;
  dueDate: string;
  overdueDuration: string;
  taskUrl: string;
};

const OVERDUE_RED = "#a42a2a";

export function buildOverdueAlertEmail(
  variables: OverdueAlertVariables,
  ctx: RenderContext,
): RenderedEmail {
  const overdueDuration = escapeHtml(variables.overdueDuration);
  const content = `${greeting(variables.firstName)}
              ${bodyText(`Your task ${escapeHtml(variables.taskTitle)} has passed its deadline and is still incomplete.`, "0 0 22px")}
              <p style="margin:0 0 14px;"><span style="display:inline-block;border-radius:4px;background:#fce8e8;color:${OVERDUE_RED};font-size:12px;font-weight:700;line-height:18px;padding:5px 9px;">Overdue · ${overdueDuration}</span></p>
              ${detailsTable("task-details", [
                { label: "Organization", value: variables.organizationName },
                ...optionalRow("Project", variables.projectName),
                { label: "Priority", value: variables.priority },
                { label: "Due date", value: variables.dueDate },
                { label: "Overdue by", value: variables.overdueDuration, valueColor: OVERDUE_RED },
              ])}
              ${bodyText("Please update your progress in Flowdesk. If you need more time or support, inform the task owner and share your expected completion date.", "28px 0 0")}
              ${primaryButton(variables.taskUrl, "View Task")}`;

  return renderEmailDocument(
    {
      title: `Overdue task: ${variables.taskTitle}`,
      preheader: `Your task ${variables.taskTitle} has passed its deadline and is still incomplete.`,
      mobileCss: [detailsMobileCss("task-details"), BUTTON_MOBILE_CSS],
      content,
    },
    ctx,
  );
}
