import {
  BUTTON_MOBILE_CSS,
  bodyText,
  detailsMobileCss,
  detailsTable,
  escapeHtml,
  greeting,
  noteText,
  primaryButton,
  renderEmailDocument,
  type RenderContext,
  type RenderedEmail,
} from "./shared";

export type ProjectInvitationVariables = {
  firstName: string;
  inviterName: string;
  organizationName: string;
  projectName: string;
  projectRole: string;
  projectUrl: string;
};

export function buildProjectInvitationEmail(
  variables: ProjectInvitationVariables,
  ctx: RenderContext,
): RenderedEmail {
  const inviterName = escapeHtml(variables.inviterName);
  const projectName = escapeHtml(variables.projectName);
  const content = `${greeting(variables.firstName)}
              ${bodyText(`${inviterName} has invited you to collaborate on ${projectName} in Flowdesk.`)}
              ${detailsTable("project-details", [
                { label: "Organization", value: variables.organizationName },
                { label: "Project", value: variables.projectName },
                { label: "Your project role", value: variables.projectRole },
              ])}
              ${bodyText("Open the project to view its details, assigned tasks and upcoming deadlines.", "28px 0 0")}
              ${primaryButton(variables.projectUrl, "View Project", "24px 0")}
              ${noteText("Sign in using your existing Flowdesk account.")}`;

  return renderEmailDocument(
    {
      title: `You've been invited to ${variables.projectName} on Flowdesk`,
      preheader: `${variables.inviterName} invited you to collaborate on ${variables.projectName} in Flowdesk.`,
      mobileCss: [detailsMobileCss("project-details"), BUTTON_MOBILE_CSS],
      content,
    },
    ctx,
  );
}
