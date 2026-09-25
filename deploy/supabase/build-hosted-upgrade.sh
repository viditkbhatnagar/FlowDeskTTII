#!/usr/bin/env bash
# Concatenate the migrations the hosted project is missing into ONE file that can be
# pasted into the Supabase SQL editor by someone with access to that project.
#
#   bash deploy/supabase/build-hosted-upgrade.sh > hosted-upgrade.sql
#
# Generated from the migration files every time, so it can never drift from them.
# Every statement in both migrations is idempotent; running it twice is harmless.
set -euo pipefail
cd "$(dirname "$0")/../.."
FILES=(
  supabase/migrations/20260922000000_admin_persistence.sql
  supabase/migrations/20260925000000_task_collaboration.sql
)
echo "-- FlowDesk hosted upgrade — generated $(date -u +%Y-%m-%dT%H:%MZ) from:"
for f in "${FILES[@]}"; do echo "--   $f"; done
echo "-- Paste into the Supabase SQL editor and run once. Safe to re-run."
for f in "${FILES[@]}"; do
  echo; echo "-- =================================================================="
  echo "-- $f"; echo "-- =================================================================="
  cat "$f"
done
