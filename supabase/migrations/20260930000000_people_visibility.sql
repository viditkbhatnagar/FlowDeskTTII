-- ============================================================================
-- FlowDesk — colleagues can see each other (QA, 29 Sep 2026)
-- ============================================================================
-- Team leads and managers saw every other person as "Unknown" (task cards,
-- assignee, activity, workload) and the Create Project member picker showed
-- "No people match" for any department or team. Admins saw everything, so
-- nobody who set the system up noticed.
--
-- Cause: organization_memberships could be read only by the person themself
-- and by admins. The profiles policy for colleagues looked colleagues up
-- through that table, and row-level security applies inside a policy's
-- subquery too, so for anyone but an admin it found nobody. Departments and
-- teams live on the memberships, so the picker had nothing to filter.
--
-- Now every active member of an organization can read its memberships (who is
-- in it, their department, team, reporting manager, designation and role
-- label) and the profiles of everyone who belongs or belonged to it. The
-- permission itself (user_roles) stays readable only by the person and admins.
-- Writes are unchanged.
--
-- Idempotent.
-- ============================================================================

-- Does _person belong (in any status) to an organization _viewer is an active
-- member of? SECURITY DEFINER, so the membership lookup is not filtered by the
-- viewer's own row-level security; deactivated colleagues still show by name
-- on their old work.
CREATE OR REPLACE FUNCTION private.shares_organization(_viewer UUID, _person UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.organization_memberships viewer
      JOIN public.organization_memberships person
        ON person.organization_id = viewer.organization_id
     WHERE viewer.user_id = _viewer
       AND viewer.status = 'active'
       AND person.user_id = _person
  )
$$;
REVOKE ALL ON FUNCTION private.shares_organization(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.shares_organization(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Admins can view organization profiles" ON public.profiles;
DROP POLICY IF EXISTS "Organization colleagues can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Colleagues can view profiles" ON public.profiles;
CREATE POLICY "Colleagues can view profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (private.shares_organization(auth.uid(), user_id));

DROP POLICY IF EXISTS "Members can view their organization's memberships" ON public.organization_memberships;
CREATE POLICY "Members can view their organization's memberships" ON public.organization_memberships
  FOR SELECT TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id));
