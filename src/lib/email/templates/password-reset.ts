import {
  BUTTON_MOBILE_CSS,
  bodyText,
  escapeHtml,
  greeting,
  noteText,
  primaryButton,
  renderEmailDocument,
  type RenderContext,
  type RenderedEmail,
} from "./shared";

// Flowdesk's own Forgot password email. The hosted auth server's reset email belongs to Lovable
// (its sender, its template, a link to the old prototype), so the app sends this one instead.
// Like the welcome email, it carries a one-time link rather than a code or a password.
export type PasswordResetVariables = {
  firstName: string;
  /** The sign-in address the reset was asked for. */
  emailAddress: string;
  /** The one-time /reset-password link. A secret: it goes in the button and nowhere else. */
  resetUrl: string;
};

const SINGLE_USE = "The link works once and expires in 1 hour.";

export function buildPasswordResetEmail(
  variables: PasswordResetVariables,
  ctx: RenderContext,
): RenderedEmail {
  const content = `${greeting(variables.firstName)}
              ${bodyText(`We received a request to reset the Flowdesk password for ${escapeHtml(variables.emailAddress)}.`, "0 0 16px")}
              ${bodyText(`Choose a new password with the button below. ${SINGLE_USE}`, "0")}
              ${primaryButton(variables.resetUrl, "Choose a new password", "24px 0 28px")}
              ${noteText("Do not share this link with anyone. If you didn’t request a password reset, ignore this email. Your password will remain unchanged.")}`;

  return renderEmailDocument(
    {
      title: "Reset your Flowdesk password",
      preheader: `Choose a new Flowdesk password. ${SINGLE_USE}`,
      mobileCss: [BUTTON_MOBILE_CSS],
      content,
    },
    ctx,
  );
}
