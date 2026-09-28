-- ============================================================================
-- FlowDesk — profile photos.
--
-- Naji asked for an upload, with crop and adjustment, instead of the "Profile
-- Photo URL" field. The browser crops the photo to a 512×512 square and stores
-- it here; profiles.avatar_url then holds the file's public URL, so every place
-- that already shows avatar_url keeps working unchanged.
--
--   Bucket "avatars"  public read: avatars are shown to colleagues all over the
--                     app, and a public URL is what an <img> needs. At most
--                     2 MB, and only WebP, JPEG or PNG.
--   Object path       "<person's user id>/<file>", e.g. "<user id>/<random
--                     uuid>.webp". Exactly one folder, the person's id written
--                     in lower case.
--
-- Who may add, replace, remove or list a person's photos: that person, or an
-- admin of an organization the person belongs to (the same people who may edit
-- their profile), and in both cases only while the account doing it is active
-- (private.account_is_active, from 20260927000000_admin_onboarding.sql). Anyone
-- may view a photo through its public URL. Nobody else may write to the bucket:
-- two restrictive policies (signed in, signed out) hold that even if some other
-- policy on storage.objects would allow more.
--
-- The storage API needs a SELECT policy as well as INSERT/UPDATE/DELETE: it
-- reads the row back after an upload, looks it up to overwrite it, and deletes
-- only the rows it can see. That SELECT policy is limited to the same people,
-- so nobody can list other people's photos; the public URL does not use it.
--
-- Needs 20260927000000_admin_onboarding.sql. Idempotent throughout; the storage
-- steps are skipped where the storage schema does not exist.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Prerequisites. Fail loudly and early rather than half-way through.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('private.account_is_active(uuid)') IS NULL
     OR to_regprocedure('private.has_organization_role(uuid, uuid, public.app_role)') IS NULL
     OR to_regprocedure('public.admin_create_user(text, text, uuid, public.app_role, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20260927000000_admin_onboarding.sql before the profile photos migration';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Who may manage the photos in a folder of the avatars bucket.
--
--    True only for an object name "<canonical user id>/<file>" when the caller's
--    account is active and the caller is that person, or an admin (with an
--    active membership there) of an organization where that person has a
--    membership. Mirrors the "Users can update own profile" and "Admins can
--    update organization profiles" policies on public.profiles.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.can_manage_avatar(_caller UUID, _object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_person UUID;
BEGIN
  IF _caller IS NULL OR _object_name IS NULL THEN
    RETURN false;
  END IF;
  IF _object_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$' THEN
    RETURN false;
  END IF;
  IF NOT private.account_is_active(_caller) THEN
    RETURN false;
  END IF;
  v_person := split_part(_object_name, '/', 1)::uuid;
  IF v_person = _caller THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM public.organization_memberships m
     WHERE m.user_id = v_person
       AND private.has_organization_role(_caller, m.organization_id, 'admin'::public.app_role)
  );
END;
$$;
REVOKE ALL ON FUNCTION private.can_manage_avatar(UUID, TEXT) FROM PUBLIC, anon;
-- Policies run their functions as the person asking.
GRANT EXECUTE ON FUNCTION private.can_manage_avatar(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The bucket. Re-running resets it to exactly these settings.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RETURN; END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/webp', 'image/jpeg', 'image/png'])
  ON CONFLICT (id) DO UPDATE
    SET public = true,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Policies on storage.objects, for the avatars bucket only.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;

  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk avatars: see own and members'' photos" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk avatars: see own and members' photos" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'avatars' AND private.can_manage_avatar(auth.uid(), name))$p$;

  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk avatars: upload own and members'' photos" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk avatars: upload own and members' photos" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars' AND private.can_manage_avatar(auth.uid(), name))$p$;

  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk avatars: replace own and members'' photos" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk avatars: replace own and members' photos" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars' AND private.can_manage_avatar(auth.uid(), name))
    WITH CHECK (bucket_id = 'avatars' AND private.can_manage_avatar(auth.uid(), name))$p$;

  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk avatars: remove own and members'' photos" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk avatars: remove own and members' photos" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'avatars' AND private.can_manage_avatar(auth.uid(), name))$p$;

  -- The backstop: whatever other policies say, a row of the avatars bucket is
  -- only for its person or their admins. Rows of other buckets are untouched
  -- (CASE, so the function is never even called for them).
  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk avatars: nobody else" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk avatars: nobody else" ON storage.objects AS RESTRICTIVE
    FOR ALL TO authenticated
    USING (CASE WHEN bucket_id IS DISTINCT FROM 'avatars' THEN true
                ELSE private.can_manage_avatar(auth.uid(), name) END)
    WITH CHECK (CASE WHEN bucket_id IS DISTINCT FROM 'avatars' THEN true
                     ELSE private.can_manage_avatar(auth.uid(), name) END)$p$;

  -- Signed-out callers never touch the bucket's rows (the public URL does not
  -- need them). This policy deliberately calls no function: anon may not
  -- execute private functions, and on Supabase's Postgres 17.6 image a call
  -- to a function the caller may not execute kills the database process
  -- instead of raising "permission denied" (found while testing this file).
  EXECUTE 'DROP POLICY IF EXISTS "FlowDesk avatars: not signed out" ON storage.objects';
  EXECUTE $p$CREATE POLICY "FlowDesk avatars: not signed out" ON storage.objects AS RESTRICTIVE
    FOR ALL TO anon
    USING (bucket_id IS DISTINCT FROM 'avatars')
    WITH CHECK (bucket_id IS DISTINCT FROM 'avatars')$p$;
END $$;
