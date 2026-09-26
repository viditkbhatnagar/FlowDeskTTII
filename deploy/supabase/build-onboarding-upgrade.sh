#!/usr/bin/env bash
# Build the paste-ready SQL for adding people and organizations from the browser
# (Settings → Users → Add User, Settings → Organizations → Add Organization, and the
# /welcome set-password page), for someone who only has the Supabase SQL editor of
# the hosted project:
#
#   bash deploy/supabase/build-onboarding-upgrade.sh > onboarding-upgrade.sql
#
# Generated from the migration file every time, so it can never drift from it. The
# migration is idempotent; running it twice is harmless. It needs the email
# notifications migration (build-email-upgrade.sh) applied first and stops with a
# clear error, before changing anything, if it is not.
set -euo pipefail
cd "$(dirname "$0")/../.."
F=supabase/migrations/20260927000000_admin_onboarding.sql
PREREQ=supabase/migrations/20260926000000_email_notifications.sql
for f in "$F" "$PREREQ"; do
  [ -f "$f" ] || { echo "build-onboarding-upgrade: missing $f" >&2; exit 1; }
done
grep -q "Apply 20260926000000_email_notifications.sql before the admin onboarding migration" "$F" || {
  echo "build-onboarding-upgrade: $F lost its prerequisite check" >&2; exit 1;
}
cat <<EOF
-- FlowDesk hosted upgrade (add people and organizations) — generated $(date -u +%Y-%m-%dT%H:%MZ) from:
--   $F
-- Paste into the Supabase SQL editor and run once. Safe to re-run.
-- Needs $PREREQ
-- (build-email-upgrade.sh) applied first; it stops with a clear error if it is not.
-- The editor runs the whole script as one transaction: on any error nothing is applied.
--
-- The result the editor shows is the script's last statement, a read-only list of what its
-- one-off steps changed: every permission (user_roles) repaired to match the role shown in
-- Settings, and every membership switched off because its account was deactivated before
-- this release (Reactivate restores it). Columns: email, organization, role shown,
-- permission before and after, what happened. One row "Nothing to repair" means nothing was
-- changed. Keep a copy of this result. A row marked "NOT changed" or "NOT switched off" was
-- left alone because it would leave that organization with no active admin; make someone
-- else Admin there, then run the script again.
--
-- Afterwards, check it landed (expect 4 rows):
--   SELECT proname FROM pg_proc WHERE proname IN ('admin_create_user', 'admin_resend_welcome',
--     'complete_account_setup', 'admin_create_organization');

-- ==================================================================
-- $F
-- ==================================================================
EOF
cat "$F"
