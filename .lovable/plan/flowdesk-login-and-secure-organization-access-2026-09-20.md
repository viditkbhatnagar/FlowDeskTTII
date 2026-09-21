# Flowdesk login and secure organization access

## Goal
Replace the current mixed sign-in/sign-up/guest screen with a polished Flowdesk login and password-recovery experience, then connect the workspace to authenticated employee profiles and permitted organizations.

## What will change

### 1. Login experience
- Rebuild `/auth` as a responsive 55/45 split screen using the existing Flowdesk tokens, type scale, corner radius, and blue identity.
- Add the branded left panel, benefits, and a lightweight decorative task-flow animation with a reduced-motion static state.
- Keep only work email, password, password visibility, the recovery link, and Sign in.
- Add persistent labels, autocomplete attributes, accessible focus/error states, generic authentication errors, loading state, and duplicate-submit protection.
- Remove sign-up, Google, and guest access from the page and remove the guest bypass from protected pages.

### 2. Email-code password recovery
- Add an in-panel four-step flow: request code, verify code, set password, success.
- Request a real provider email OTP without creating accounts, verify it through the authentication provider, enforce matching password rules, update the password only after verification, then sign out the temporary recovery session.
- Add paste/autofill-friendly code input, keyboard navigation, resend countdown, change-email, and neutral request messaging.
- Map provider errors into safe messages for invalid, expired, or rate-limited codes without revealing whether an account exists.

### 3. Real employee and organization access
- Add backend tables for organizations, organization memberships, and organization-scoped roles, with explicit grants and row-level access rules.
- Keep roles separate from profiles and stop trusting the existing profile role field or in-memory current-user constant for authorization.
- Load the signed-in employee’s real profile, active memberships, organizations, and roles.
- For one organization, select it automatically; for multiple organizations, show the existing switcher; for none, show a clear contact-your-administrator screen.
- Replace guest/demo identity in the header with the authenticated profile and role.
- Use server-validated membership checks for protected organization data. Existing task/project demo records remain visually intact until their own data modules are migrated to backend tables.

### 4. Navigation and session safety
- Keep `/auth` public and all application pages behind the existing protected layout.
- Redirect authenticated users away from `/auth` and return successful sign-ins to the workspace.
- On sign-out, cancel and clear protected cached data before replacing history with `/auth`.
- Remove obsolete guest code once no call sites remain.

### 5. Verification
- Check desktop and mobile layouts at the requested breakpoints, no horizontal overflow, password toggles, validation, keyboard navigation, reduced-motion rendering, loading/error states, route protection, sign-out, and no-organization/one-organization/multi-organization states.
- Test OTP request, incorrect code, resend countdown/rate-limit messaging, password mismatch, successful update, temporary-session sign-out, and sign-in with the new password when provider email delivery is available.
- Run focused type checks and inspect browser console/network output.

## Authentication configuration
- Email/password is enabled.
- Public self-registration and anonymous access are disabled; leaked-password protection and current-password checks are enabled.
- No custom sending domain is configured. Built-in authentication email delivery may use the default sender, but the exact numeric-code template cannot be guaranteed or customized until an owned email domain is connected. The UI and provider-backed flow will be implemented without simulated codes; final end-to-end OTP delivery will be reported as verified or blocked by that configuration.
