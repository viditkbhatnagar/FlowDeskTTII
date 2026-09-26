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

// Redesigned from Naji's credentials email: a password is never sent. The person chooses their
// own, through a one-time /welcome link when an admin added them in Flowdesk, or else through
// the reset-password flow (whose page explains the verification code it sends).
export type AccountAccessVariables = {
  firstName: string;
  emailAddress: string;
  setPasswordUrl: string;
  /** True when setPasswordUrl is a one-time setup link (it works once and expires in 7 days). */
  singleUseLink?: boolean;
  signInUrl: string;
};

const GET_STARTED = "To get started, choose your password with the button below.";
const SINGLE_USE = "The link works once and expires in 7 days.";

export function buildAccountAccessEmail(
  variables: AccountAccessVariables,
  ctx: RenderContext,
): RenderedEmail {
  const getStarted = variables.singleUseLink ? `${GET_STARTED} ${SINGLE_USE}` : GET_STARTED;
  const content = `${greeting(variables.firstName)}
              ${bodyText("Your Flowdesk account is ready. You can now manage your tasks, collaborate with your teams and track project progress in one place.")}
              <h1 style="margin:0 0 14px;font-size:20px;line-height:28px;color:#101b36;">Your login details</h1>
              ${detailsTable("account-details", [
                { label: "Sign-in email", value: variables.emailAddress },
              ])}
              ${bodyText(getStarted, "28px 0 0")}
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
