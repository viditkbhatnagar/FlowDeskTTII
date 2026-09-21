GRANT EXECUTE ON FUNCTION private.has_organization_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_organization_role(UUID, UUID, public.app_role) TO authenticated;