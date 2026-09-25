import {
  BUTTON_MOBILE_CSS,
  bodyText,
  detailsMobileCss,
  detailsTable,
  greeting,
  noteText,
  primaryButton,
  renderEmailDocument,
  safeHref,
  type RenderContext,
  type RenderedEmail,
} from "./shared";

// Redesigned from Naji's credentials email: a password is never sent. The
// person sets their own through the reset-password (verification code) flow.
export type AccountAccessVariables = {
  firstName: string;
  emailAddress: string;
  setPasswordUrl: string;
  signInUrl: string;
};

export function buildAccountAccessEmail(
  variables: AccountAccessVariables,
  ctx: RenderContext,
): RenderedEmail {
  const content = `${greeting(variables.firstName)}
              ${bodyText("Your Flowdesk account is ready. You can now manage your tasks, collaborate with your teams and track project progress in one place.")}
              <h1 style="margin:0 0 14px;font-size:20px;line-height:28px;color:#101b36;">Your login details</h1>
              ${detailsTable("account-details", [
                { label: "Sign-in email", value: variables.emailAddress },
              ])}
              ${bodyText("To get started, set your password. We’ll send a 6-digit verification code to this email address to confirm it’s you.", "28px 0 0")}
              ${primaryButton(variables.setPasswordUrl, "Set your password", "24px 0 28px")}
              ${bodyText(`Already set your password? <a href="${safeHref(variables.signInUrl)}" style="color:#1468ff;font-weight:700;text-decoration:none;">Sign in to Flowdesk</a>`, "0 0 16px")}
              ${noteText("Flowdesk will never ask for your password by email. If you weren’t expecting this, you can ignore it. If you need assistance, contact your administrator.")}`;

  return renderEmailDocument(
    {
      title: "Your Flowdesk account is ready",
      preheader: "Your Flowdesk workspace is ready. Set your password to sign in.",
      mobileCss: [detailsMobileCss("account-details"), BUTTON_MOBILE_CSS],
      content,
    },
    ctx,
  );
}
