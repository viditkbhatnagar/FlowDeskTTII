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

export type TaskAssignedVariables = {
  firstName: string;
  assignedBy: string;
  taskTitle: string;
  organizationName: string;
  projectName: string;
  priority: string;
  dueDate: string;
  taskUrl: string;
};

export function buildTaskAssignedEmail(
  variables: TaskAssignedVariables,
  ctx: RenderContext,
): RenderedEmail {
  const content = `${greeting(variables.firstName)}
              ${bodyText(`${escapeHtml(variables.assignedBy)} has assigned you a task in Flowdesk.`)}
              ${detailsTable("task-details", [
                { label: "Task", value: variables.taskTitle },
                { label: "Organization", value: variables.organizationName },
                ...optionalRow("Project", variables.projectName),
                { label: "Priority", value: variables.priority },
                { label: "Due date", value: variables.dueDate.trim() || "Not set" },
              ])}
              ${bodyText("Please review the task details and update your progress in Flowdesk.", "28px 0 0")}
              ${primaryButton(variables.taskUrl, "View Task")}`;

  return renderEmailDocument(
    {
      title: `Task assigned to you: ${variables.taskTitle}`,
      preheader: `${variables.assignedBy} assigned you the task ${variables.taskTitle} in Flowdesk.`,
      mobileCss: [detailsMobileCss("task-details"), BUTTON_MOBILE_CSS],
      content,
    },
    ctx,
  );
}
