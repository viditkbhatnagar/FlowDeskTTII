#!/usr/bin/env bash
# Build the paste-ready SQL for profile photos (upload, crop and adjust a photo in
# Settings → Users → Add User / Edit User and in your own Profile), for someone who
# only has the Supabase SQL editor of the hosted project:
#
#   bash deploy/supabase/build-photos-upgrade.sh > photos-upgrade.sql
#
# Generated from the migration file every time, so it can never drift from it. The
# migration is idempotent; running it twice is harmless. It needs the admin
# onboarding migration (build-onboarding-upgrade.sh) applied first and stops with a
# clear error, before changing anything, if it is not.
set -euo pipefail
cd "$(dirname "$0")/../.."
F=supabase/migrations/20260928000000_profile_photos.sql
PREREQ=supabase/migrations/20260927000000_admin_onboarding.sql
for f in "$F" "$PREREQ"; do
  [ -f "$f" ] || { echo "build-photos-upgrade: missing $f" >&2; exit 1; }
done
grep -q "Apply 20260927000000_admin_onboarding.sql before the profile photos migration" "$F" || {
  echo "build-photos-upgrade: $F lost its prerequisite check" >&2; exit 1;
}
cat <<EOF
-- FlowDesk hosted upgrade (profile photos) — generated $(date -u +%Y-%m-%dT%H:%MZ) from:
--   $F
-- Paste into the Supabase SQL editor and run once. Safe to re-run.
-- Needs $PREREQ
-- (build-onboarding-upgrade.sh) applied first; it stops with a clear error if it is not.
-- The editor runs the whole script as one transaction: on any error nothing is applied.
--
-- It adds the public "avatars" storage bucket (2 MB, WebP / JPEG / PNG only) and the
-- policies that let a person, or an admin of their organization, add, replace and
-- remove that person's photo. No table changes, and nothing else is touched. Deploy
-- the app release with the photo picker after this has run.
--
-- The result the editor shows is the script's last statement, a read-only check.
-- Expect 7 rows: the bucket's settings (public, 2097152 bytes, the three image types)
-- and the 6 "FlowDesk avatars: …" policies. Any further row is a policy that someone
-- else added for this bucket: it cannot widen access (the two restrictive FlowDesk
-- policies still apply), but review it and drop it if nobody knows why it is there.

-- ==================================================================
-- $F
-- ==================================================================
EOF
cat "$F"
cat <<'EOF'

-- ==================================================================
-- Read-only check (the result the editor shows).
-- ==================================================================
SELECT 'bucket' AS what,
       b.id AS name,
       'public=' || b.public || ', max bytes=' || b.file_size_limit
         || ', types=' || array_to_string(b.allowed_mime_types, ', ') AS detail
  FROM storage.buckets b
 WHERE b.id = 'avatars'
UNION ALL
SELECT CASE WHEN p.policyname LIKE 'FlowDesk avatars:%' THEN 'FlowDesk policy'
            ELSE 'OTHER policy: review it' END,
       p.policyname,
       p.permissive || ' ' || p.cmd || ' to ' || array_to_string(p.roles, ', ')
  FROM pg_policies p
 WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
   AND (p.policyname LIKE 'FlowDesk avatars:%'
        OR coalesce(p.qual, '') || coalesce(p.with_check, '') LIKE '%avatars%')
ORDER BY 1, 2;
EOF
