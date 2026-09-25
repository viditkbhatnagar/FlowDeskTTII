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

export type DueDateReminderVariables = {
  firstName: string;
  taskTitle: string;
  organizationName: string;
  projectName: string;
  priority: string;
  dueDate: string;
  taskUrl: string;
};

export function buildDueDateReminderEmail(
  variables: DueDateReminderVariables,
  ctx: RenderContext,
): RenderedEmail {
  const content = `${greeting(variables.firstName)}
              ${bodyText(`Your task ${escapeHtml(variables.taskTitle)} is approaching its deadline.`)}
              ${detailsTable("task-details", [
                { label: "Organization", value: variables.organizationName },
                ...optionalRow("Project", variables.projectName),
                { label: "Priority", value: variables.priority },
                { label: "Due date", value: variables.dueDate },
              ])}
              ${bodyText("Please review the remaining work and update your progress in Flowdesk. If you expect a delay, let the task owner know before the deadline.", "28px 0 0")}
              ${primaryButton(variables.taskUrl, "View Task")}`;

  return renderEmailDocument(
    {
      title: `Due soon: ${variables.taskTitle}`,
      preheader: `Your task ${variables.taskTitle} is approaching its deadline.`,
      mobileCss: [detailsMobileCss("task-details"), BUTTON_MOBILE_CSS],
      content,
    },
    ctx,
  );
}
