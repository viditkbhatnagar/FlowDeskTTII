CREATE TYPE public.organization_status AS ENUM ('active', 'inactive');
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'team_lead', 'employee', 'viewer');

CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 2 AND 8),
  logo_url TEXT,
  official_email TEXT,
  phone TEXT,
  website TEXT,
  country TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status public.organization_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  status public.organization_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);
GRANT SELECT, INSERT, UPDATE ON public.organization_memberships TO authenticated;
GRANT ALL ON public.organization_memberships TO service_role;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'employee',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_organization_access(_user_id UUID, _organization_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_memberships
    WHERE user_id = _user_id
      AND organization_id = _organization_id
      AND status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION public.has_organization_role(_user_id UUID, _organization_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles r
    JOIN public.organization_memberships m
      ON m.user_id = r.user_id AND m.organization_id = r.organization_id
    WHERE r.user_id = _user_id
      AND r.organization_id = _organization_id
      AND r.role = _role
      AND m.status = 'active'
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_organization_access(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_organization_role(UUID, UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_organization_access(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_organization_role(UUID, UUID, public.app_role) TO service_role;

CREATE POLICY "Members can view assigned organizations"
ON public.organizations FOR SELECT TO authenticated
USING (public.has_organization_access(auth.uid(), id));

CREATE POLICY "Organization admins can create organizations"
ON public.organizations FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY "Organization admins can update organizations"
ON public.organizations FOR UPDATE TO authenticated
USING (public.has_organization_role(auth.uid(), id, 'admin'))
WITH CHECK (public.has_organization_role(auth.uid(), id, 'admin'));

CREATE POLICY "Employees can view own memberships"
ON public.organization_memberships FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_organization_role(auth.uid(), organization_id, 'admin')
);

CREATE POLICY "Organization admins can add memberships"
ON public.organization_memberships FOR INSERT TO authenticated
WITH CHECK (public.has_organization_role(auth.uid(), organization_id, 'admin'));

CREATE POLICY "Organization admins can update memberships"
ON public.organization_memberships FOR UPDATE TO authenticated
USING (public.has_organization_role(auth.uid(), organization_id, 'admin'))
WITH CHECK (public.has_organization_role(auth.uid(), organization_id, 'admin'));

CREATE POLICY "Employees can view own roles"
ON public.user_roles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_organization_role(auth.uid(), organization_id, 'admin')
);

CREATE POLICY "Organization admins can add roles"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (public.has_organization_role(auth.uid(), organization_id, 'admin'));

CREATE POLICY "Organization admins can update roles"
ON public.user_roles FOR UPDATE TO authenticated
USING (public.has_organization_role(auth.uid(), organization_id, 'admin'))
WITH CHECK (public.has_organization_role(auth.uid(), organization_id, 'admin'));

CREATE POLICY "Organization admins can remove roles"
ON public.user_roles FOR DELETE TO authenticated
USING (public.has_organization_role(auth.uid(), organization_id, 'admin'));

CREATE UNIQUE INDEX organization_memberships_one_primary_per_user
ON public.organization_memberships (user_id)
WHERE is_primary = true AND status = 'active';

CREATE TRIGGER update_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_organization_memberships_updated_at
BEFORE UPDATE ON public.organization_memberships
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_user_roles_updated_at
BEFORE UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.organizations (name, code, official_email, phone, website, country, timezone)
VALUES
  ('upCarrera', 'UPC', 'hello@upcarrera.com', '+971 4 555 0100', 'https://upcarrera.com', 'United Arab Emirates', 'Asia/Dubai'),
  ('Teachers'' Training Institute of India', 'TTII', 'contact@ttii.in', '+91 22 4000 1200', 'https://ttii.in', 'India', 'Asia/Kolkata');