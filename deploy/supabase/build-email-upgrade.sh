#!/usr/bin/env bash
# Build the paste-ready SQL for email notifications, for someone who only has the
# Supabase SQL editor of the hosted project:
#
#   bash deploy/supabase/build-email-upgrade.sh > email-upgrade.sql
#
# Generated from the migration file every time, so it can never drift from it. The
# migration is idempotent; running it twice is harmless. It needs the two migrations in
# build-hosted-upgrade.sh applied first and stops with a clear error if they are not.
set -euo pipefail
cd "$(dirname "$0")/../.."
F=supabase/migrations/20260926000000_email_notifications.sql
cat <<EOF
-- FlowDesk hosted upgrade (email notifications) — generated $(date -u +%Y-%m-%dT%H:%MZ) from:
--   $F
-- Paste into the Supabase SQL editor and run once. Safe to re-run.
-- Needs 20260922000000_admin_persistence.sql and 20260925000000_task_collaboration.sql
-- (build-hosted-upgrade.sh) applied first; it stops with a clear error if they are not.
-- The editor runs the whole script as one transaction: on any error nothing is applied.
--
-- Afterwards, set the worker secret (the plain secret never enters the database):
--   1. On the server: EMAIL_WORKER_SECRET=\$(openssl rand -hex 32), stored in the app's .env only.
--   2. Its sha256:    printf '%s' "\$EMAIL_WORKER_SECRET" | shasum -a 256
--   3. In this editor, with that 64-character hash:
--        INSERT INTO private.email_worker_config (id, secret_sha256)
--        VALUES (1, decode('<64 hex chars>', 'hex'))
--        ON CONFLICT (id) DO UPDATE SET secret_sha256 = EXCLUDED.secret_sha256, updated_at = now();

-- ==================================================================
-- $F
-- ==================================================================
EOF
cat "$F"
