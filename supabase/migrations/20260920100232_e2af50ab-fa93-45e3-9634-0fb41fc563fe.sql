CREATE POLICY "Organization colleagues can view profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_memberships viewer_membership
    JOIN public.organization_memberships profile_membership
      ON profile_membership.organization_id = viewer_membership.organization_id
     AND profile_membership.status = 'active'
    WHERE viewer_membership.user_id = auth.uid()
      AND viewer_membership.status = 'active'
      AND profile_membership.user_id = profiles.user_id
  )
);