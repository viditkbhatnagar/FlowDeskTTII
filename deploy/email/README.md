# Email templates for Supabase Auth

Supabase Auth sends the password-reset code itself (`resetPasswordForEmail` in
`src/routes/auth.tsx`, verified with `verifyOtp({ type: "recovery" })`). Flowdesk only
supplies the template; every other Flowdesk email is rendered by `src/lib/email/render.ts`.

Those other emails go out through Microsoft Graph from the shared mailbox
`flowdesk@upcarrera.com` ("Flowdesk"), with Reply-To `hello@upcarrera.com`. The setup is
described in `docs/06-deployment.md` → "Email notifications": the Entra app, its own
`flowdesk` client secret, the access-policy group, the worker secret and the PM2 restart.

## `supabase-reset-password.html`

Paste it into **Lovable Cloud → Emails → Reset password** (the password recovery template):

| Field   | Value                                |
| ------- | ------------------------------------ |
| Subject | `Your Flowdesk password reset code`  |
| Body    | the whole contents of this HTML file |

- The code is `{{ .Token }}` and the greeting has no name (Supabase only knows `{{ .Email }}`).
- The copy says the code expires in 1 hour, which is Supabase's default OTP expiry. If the
  project's email OTP expiry is changed, change the text too.
- The logo loads from `https://flowdesk.upcarrera.com/brand/flowdesk-email-header.png`, so the
  app must be deployed (with `public/brand/`) before the template goes live.

Do not edit the HTML by hand. It is generated from
`src/lib/email/templates/password-reset-otp.ts`, and `src/lib/email/templates.test.ts` fails
if the two drift apart. To regenerate after changing the template:

```sh
bun -e 'import { buildSupabaseResetPasswordHtml as b } from "./src/lib/email/templates/password-reset-otp.ts"; await Bun.write("deploy/email/supabase-reset-password.html", b() + "\n")'
```
