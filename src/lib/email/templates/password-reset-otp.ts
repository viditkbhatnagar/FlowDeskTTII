import {
  bodyText,
  escapeHtml,
  noteText,
  renderEmailDocument,
  type RenderContext,
  type RenderedEmail,
} from "./shared";

// Supabase Auth sends this one itself (resetPasswordForEmail). Flowdesk never
// renders it at runtime; it is the source of deploy/email/supabase-reset-password.html.
export type PasswordResetOtpVariables = {
  otpCode: string;
  emailAddress: string;
  /** e.g. "1 hour" */
  expiresIn: string;
};

export const SUPABASE_RESET_PASSWORD_VARIABLES: PasswordResetOtpVariables = {
  otpCode: "{{ .Token }}",
  emailAddress: "{{ .Email }}",
  expiresIn: "1 hour",
};

export const SUPABASE_ASSET_BASE_URL = "https://flowdesk.upcarrera.com";

export function buildPasswordResetOtpEmail(
  variables: PasswordResetOtpVariables,
  ctx: RenderContext,
): RenderedEmail {
  const expiresIn = escapeHtml(variables.expiresIn);
  const content = `<p style="margin:0 0 18px;font-size:17px;line-height:27px;color:#101b36;">Hello,</p>
              ${bodyText(`We received a request to reset the Flowdesk password for ${escapeHtml(variables.emailAddress)}.`)}
              <p style="margin:0 0 10px;font-size:13px;font-weight:700;line-height:20px;color:#68738a;">Your verification code:</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;border:1px solid #dce4ef;border-radius:6px;">
                <tr>
                  <td align="center" style="padding:24px 18px;">
                    <span class="otp-code" style="display:inline-block;font-family:'Courier New',monospace;font-size:36px;font-weight:700;line-height:44px;letter-spacing:8px;color:#101b36;user-select:text;">${escapeHtml(variables.otpCode)}</span>
                  </td>
                </tr>
              </table>
              ${bodyText(`This code expires in ${expiresIn}. Enter it on the password-reset screen to set your new password.`, "28px 0 18px")}
              ${noteText("Do not share this code with anyone. If you didn’t request a password reset, ignore this email. Your password will remain unchanged.")}`;

  return renderEmailDocument(
    {
      title: "Your Flowdesk password reset code",
      preheader: `Use this verification code to reset your Flowdesk password. It expires in ${variables.expiresIn}.`,
      mobileCss: [".otp-code { font-size: 30px !important; letter-spacing: 6px !important; }"],
      content,
    },
    ctx,
  );
}

export function buildSupabaseResetPasswordHtml(): string {
  return buildPasswordResetOtpEmail(SUPABASE_RESET_PASSWORD_VARIABLES, {
    assetBaseUrl: SUPABASE_ASSET_BASE_URL,
  }).html;
}
