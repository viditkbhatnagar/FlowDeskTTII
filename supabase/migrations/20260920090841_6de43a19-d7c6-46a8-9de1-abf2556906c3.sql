CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER FUNCTION public.has_organization_access(UUID, UUID) SET SCHEMA private;
ALTER FUNCTION public.has_organization_role(UUID, UUID, public.app_role) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.has_organization_access(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.has_organization_role(UUID, UUID, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_organization_access(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION private.has_organization_role(UUID, UUID, public.app_role) TO service_role;