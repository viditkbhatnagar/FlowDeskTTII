-- ============================================================================
-- FlowDesk — persistence for the admin surfaces.
--
-- Until now Departments, Teams, Roles, Users and Task/Project Settings were
-- React state seeded from hardcoded arrays in src/lib/organizations-data.tsx
-- and src/lib/task-settings-data.tsx. They looked like they worked and were
-- discarded on refresh, because no tables existed behind them.
--
-- This migration gives every one of them a real, organization-scoped table with
-- row-level security written the same way as the existing 13 migrations:
--   * private.has_organization_access(user, org)  -> any active member
--   * private.has_management_access(user, org)    -> admin | manager | team_lead
--   * private.has_organization_role(user, org, r) -> exact role
-- Reads are open to members, writes are restricted to management or admin.
--
-- DELIBERATE CALL — statuses and priorities stay enum-backed.
-- public.work_task_status, public.work_priority and public.project_lifecycle_status
-- are enums on hot columns that the Kanban board, the dashboard aggregation and
-- every RLS-adjacent query key off. Turning them into free-form rows would mean
-- rewriting work_tasks.status to TEXT and re-deriving all of that logic, for the
-- sake of inventing a sixth status nobody has asked for. Instead the Settings
-- screen now manages their *presentation* — label, colour, order, active — in
-- task_status_settings / task_priority_settings / project_status_settings, and
-- the genuinely open-ended vocabularies (project categories, tags) get real
-- tables of their own.
--
-- Everything here is idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING) so it
-- can be re-run safely.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Departments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  code            TEXT,
  description     TEXT,
  head_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status          public.organization_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view organization departments" ON public.departments;
CREATE POLICY "Members can view organization departments" ON public.departments
  FOR SELECT TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Admins can create departments" ON public.departments;
CREATE POLICY "Admins can create departments" ON public.departments
  FOR INSERT TO authenticated
  WITH CHECK (private.has_organization_role(auth.uid(), organization_id, 'admin'));

DROP POLICY IF EXISTS "Admins can update departments" ON public.departments;
CREATE POLICY "Admins can update departments" ON public.departments
  FOR UPDATE TO authenticated
  USING (private.has_organization_role(auth.uid(), organization_id, 'admin'))
  WITH CHECK (private.has_organization_role(auth.uid(), organization_id, 'admin'));

DROP POLICY IF EXISTS "Admins can delete departments" ON public.departments;
CREATE POLICY "Admins can delete departments" ON public.departments
  FOR DELETE TO authenticated
  USING (private.has_organization_role(auth.uid(), organization_id, 'admin'));

DROP TRIGGER IF EXISTS update_departments_updated_at ON public.departments;
CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 2. Teams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  department_id   UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  lead_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status          public.organization_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view organization teams" ON public.teams;
CREATE POLICY "Members can view organization teams" ON public.teams
  FOR SELECT TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Managers can create teams" ON public.teams;
CREATE POLICY "Managers can create teams" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (private.has_management_access(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Managers can update teams" ON public.teams;
CREATE POLICY "Managers can update teams" ON public.teams
  FOR UPDATE TO authenticated
  USING (private.has_management_access(auth.uid(), organization_id))
  WITH CHECK (private.has_management_access(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Admins can delete teams" ON public.teams;
CREATE POLICY "Admins can delete teams" ON public.teams
  FOR DELETE TO authenticated
  USING (private.has_organization_role(auth.uid(), organization_id, 'admin'));

DROP TRIGGER IF EXISTS update_teams_updated_at ON public.teams;
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 3. Roles
--
-- IMPORTANT: public.user_roles.role (the app_role enum) remains the ONLY thing
-- row-level security consults. A named role therefore MUST declare a base_role,
-- which is the actual privilege level; everything else on the row (scope,
-- permissions, settings) drives UI gating only.
--
-- That keeps one source of truth for security while letting admins name roles,
-- write descriptions and tune what each one sees. A role cannot grant more than
-- its base_role allows, because the database never reads these columns.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  description     TEXT,
  base_role       public.app_role NOT NULL,
  scope           TEXT NOT NULL DEFAULT 'own'
                    CHECK (scope IN ('own', 'team', 'department', 'organization', 'all')),
  permissions     TEXT[] NOT NULL DEFAULT '{}',
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  status          public.organization_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles TO authenticated;
GRANT ALL ON public.roles TO service_role;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view organization roles" ON public.roles;
CREATE POLICY "Members can view organization roles" ON public.roles
  FOR SELECT TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Admins can create roles" ON public.roles;
CREATE POLICY "Admins can create roles" ON public.roles
  FOR INSERT TO authenticated
  WITH CHECK (private.has_organization_role(auth.uid(), organization_id, 'admin'));

-- System roles are the five that RLS itself depends on; they may be described
-- and re-scoped but never renamed away or deactivated.
DROP POLICY IF EXISTS "Admins can update roles" ON public.roles;
CREATE POLICY "Admins can update roles" ON public.roles
  FOR UPDATE TO authenticated
  USING (private.has_organization_role(auth.uid(), organization_id, 'admin'))
  WITH CHECK (private.has_organization_role(auth.uid(), organization_id, 'admin'));

DROP POLICY IF EXISTS "Admins can delete custom roles" ON public.roles;
CREATE POLICY "Admins can delete custom roles" ON public.roles
  FOR DELETE TO authenticated
  USING (private.has_organization_role(auth.uid(), organization_id, 'admin') AND is_system = false);

DROP TRIGGER IF EXISTS update_roles_updated_at ON public.roles;
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Keep a named role pointing at the privilege level it claims.
CREATE OR REPLACE FUNCTION public.enforce_system_role_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_system THEN
    IF NEW.base_role <> OLD.base_role THEN
      RAISE EXCEPTION 'The base privilege of a system role cannot be changed';
    END IF;
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'A system role cannot be deactivated';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_system_role_integrity ON public.roles;
CREATE TRIGGER enforce_system_role_integrity BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_system_role_integrity();


-- ---------------------------------------------------------------------------
-- 4. People — profile-level and membership-level attributes
--
-- Attributes that belong to the person go on profiles; attributes that belong
-- to the person *within one organization* (department, team, role, manager,
-- designation) go on organization_memberships, which is how the app already
-- models it (see the Membership type in src/lib/organizations-data.tsx).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employee_id   TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone         TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS joining_date  DATE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status        public.organization_status NOT NULL DEFAULT 'active';

-- The Users screen lists people by email, but the address lives in auth.users,
-- which PostgREST does not expose. Mirror it onto the profile so the screen can
-- read it under the normal RLS rules.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE u.id = p.user_id AND p.email IS DISTINCT FROM u.email;

-- Keep it in step. handle_new_user() already creates the profile row on sign-up;
-- this covers the address changing afterwards.
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET email = NEW.email WHERE user_id = NEW.id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_profile_email ON auth.users;
CREATE TRIGGER sync_profile_email AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();

ALTER TABLE public.organization_memberships ADD COLUMN IF NOT EXISTS department_id        UUID REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.organization_memberships ADD COLUMN IF NOT EXISTS team_id              UUID REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.organization_memberships ADD COLUMN IF NOT EXISTS role_id              UUID REFERENCES public.roles(id) ON DELETE SET NULL;
ALTER TABLE public.organization_memberships ADD COLUMN IF NOT EXISTS reporting_manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.organization_memberships ADD COLUMN IF NOT EXISTS designation          TEXT;

-- user_roles keeps the enum as the enforcement anchor; role_id is the label.
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES public.roles(id) ON DELETE SET NULL;

-- Admins need to administer colleagues, and members need to see who is who.
-- The existing policies only allowed a user to read and write their own row,
-- which is why the Users screen could never have shown real people.
DROP POLICY IF EXISTS "Admins can view organization profiles" ON public.profiles;
CREATE POLICY "Admins can view organization profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = public.profiles.user_id
        AND private.has_organization_access(auth.uid(), m.organization_id)
    )
  );

DROP POLICY IF EXISTS "Admins can update organization profiles" ON public.profiles;
CREATE POLICY "Admins can update organization profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = public.profiles.user_id
        AND private.has_organization_role(auth.uid(), m.organization_id, 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = public.profiles.user_id
        AND private.has_organization_role(auth.uid(), m.organization_id, 'admin')
    )
  );

DROP POLICY IF EXISTS "Admins can delete organization memberships" ON public.organization_memberships;
CREATE POLICY "Admins can delete organization memberships" ON public.organization_memberships
  FOR DELETE TO authenticated
  USING (private.has_organization_role(auth.uid(), organization_id, 'admin'));
GRANT DELETE ON public.organization_memberships TO authenticated;


-- ---------------------------------------------------------------------------
-- 5. Project categories and tags — the genuinely open vocabularies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  description     TEXT,
  color           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          public.organization_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_categories TO authenticated;
GRANT ALL ON public.project_categories TO service_role;
ALTER TABLE public.project_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view project categories" ON public.project_categories;
CREATE POLICY "Members can view project categories" ON public.project_categories
  FOR SELECT TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Managers can write project categories" ON public.project_categories;
CREATE POLICY "Managers can write project categories" ON public.project_categories
  FOR ALL TO authenticated
  USING (private.has_management_access(auth.uid(), organization_id))
  WITH CHECK (private.has_management_access(auth.uid(), organization_id));

DROP TRIGGER IF EXISTS update_project_categories_updated_at ON public.project_categories;
CREATE TRIGGER update_project_categories_updated_at BEFORE UPDATE ON public.project_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE IF NOT EXISTS public.task_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  color           TEXT,
  status          public.organization_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_tags TO authenticated;
GRANT ALL ON public.task_tags TO service_role;
ALTER TABLE public.task_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view task tags" ON public.task_tags;
CREATE POLICY "Members can view task tags" ON public.task_tags
  FOR SELECT TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can write task tags" ON public.task_tags;
CREATE POLICY "Members can write task tags" ON public.task_tags
  FOR ALL TO authenticated
  USING (private.has_organization_access(auth.uid(), organization_id))
  WITH CHECK (private.has_organization_access(auth.uid(), organization_id));

DROP TRIGGER IF EXISTS update_task_tags_updated_at ON public.task_tags;
CREATE TRIGGER update_task_tags_updated_at BEFORE UPDATE ON public.task_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ---------------------------------------------------------------------------
-- 6. Presentation settings for the enum-backed vocabularies
--
-- One row per enum value per organization. `value` is validated against the
-- enum, so a row can never describe a status the database cannot store.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_status_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  value           public.work_task_status NOT NULL,
  label           TEXT NOT NULL,
  color           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  is_completed    BOOLEAN NOT NULL DEFAULT false,
  status          public.organization_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, value)
);

CREATE TABLE IF NOT EXISTS public.task_priority_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  value           public.work_priority NOT NULL,
  label           TEXT NOT NULL,
  color           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          public.organization_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, value)
);

CREATE TABLE IF NOT EXISTS public.project_status_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  value           public.project_lifecycle_status NOT NULL,
  label           TEXT NOT NULL,
  color           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  status          public.organization_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, value)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_status_settings', 'task_priority_settings', 'project_status_settings']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Members can view %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Members can view %1$s" ON public.%1$I FOR SELECT TO authenticated '
      'USING (private.has_organization_access(auth.uid(), organization_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Managers can write %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Managers can write %1$s" ON public.%1$I FOR ALL TO authenticated '
      'USING (private.has_management_access(auth.uid(), organization_id)) '
      'WITH CHECK (private.has_management_access(auth.uid(), organization_id))', t);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS update_%1$s_updated_at ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER update_%1$s_updated_at BEFORE UPDATE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 7. Projects — the columns the Create Project dialog already collects
-- ---------------------------------------------------------------------------
ALTER TABLE public.work_projects ADD COLUMN IF NOT EXISTS category_id   UUID REFERENCES public.project_categories(id) ON DELETE SET NULL;
ALTER TABLE public.work_projects ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.work_projects ADD COLUMN IF NOT EXISTS team_id       UUID REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.work_projects ADD COLUMN IF NOT EXISTS manager_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.work_projects ADD COLUMN IF NOT EXISTS priority      public.work_priority NOT NULL DEFAULT 'medium';
ALTER TABLE public.work_projects ADD COLUMN IF NOT EXISTS project_type  TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE public.work_projects ADD COLUMN IF NOT EXISTS client_name   TEXT;

CREATE TABLE IF NOT EXISTS public.project_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES public.work_projects(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_label  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_members TO authenticated;
GRANT ALL ON public.project_members TO service_role;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view project members" ON public.project_members;
CREATE POLICY "Members can view project members" ON public.project_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_projects p
      WHERE p.id = public.project_members.project_id
        AND private.has_organization_access(auth.uid(), p.organization_id)
    )
  );

DROP POLICY IF EXISTS "Managers can write project members" ON public.project_members;
CREATE POLICY "Managers can write project members" ON public.project_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_projects p
      WHERE p.id = public.project_members.project_id
        AND private.has_management_access(auth.uid(), p.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.work_projects p
      WHERE p.id = public.project_members.project_id
        AND private.has_management_access(auth.uid(), p.organization_id)
    )
  );


-- ---------------------------------------------------------------------------
-- 8. Seed every existing organization
--
-- These are the five roles, the status/priority vocabularies and a starter set
-- of categories and tags that the hardcoded screens used to show. Seeding them
-- means the admin screens are populated the moment this lands, rather than
-- presenting an empty table where staff previously saw content.
--
-- Departments, teams and users are NOT seeded: those were invented people and
-- structures (Alex Morgan, Priya Shah, UPC-0001 …). Inventing them as real rows
-- would be worse than an empty screen. Real staff get added by an admin.
-- ---------------------------------------------------------------------------
-- Seeding lives in a function so a NEW organization gets the same defaults as the
-- existing ones. Without this, creating an organization later would leave its
-- Roles and Settings screens empty with no way to bootstrap them from the UI.
CREATE OR REPLACE FUNCTION private.seed_organization_defaults(_organization_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.roles (organization_id, name, description, base_role, scope, permissions, settings, is_system)
  SELECT _organization_id, r.name, r.description, r.base_role::public.app_role, r.scope, '{}'::TEXT[], '{}'::jsonb, true
  FROM (VALUES
    ('Admin',               'Full application and settings access.',                                                    'admin',     'all'),
    ('Manager / HOD',       'Manage department projects and tasks, assign work and view department-level information.', 'manager',   'department'),
    ('Team Lead',           'Manage tasks for assigned teams.',                                                         'team_lead', 'team'),
    ('Employee',            'Manage own tasks and participate in assigned projects.',                                   'employee',  'own'),
    ('Management / Viewer', 'View organization-level information and reports without operational editing.',             'viewer',    'organization')
  ) AS r(name, description, base_role, scope)
  ON CONFLICT (organization_id, name) DO NOTHING;

  INSERT INTO public.task_status_settings (organization_id, value, label, sort_order, is_default, is_completed)
  SELECT _organization_id, s.value::public.work_task_status, s.label, s.sort_order, s.is_default, s.is_completed
  FROM (VALUES
    ('todo','To Do',1,true,false), ('progress','In Progress',2,false,false),
    ('review','Waiting Approval',3,false,false), ('done','Completed',4,false,true),
    ('cancelled','Cancelled',5,false,false)
  ) AS s(value, label, sort_order, is_default, is_completed)
  ON CONFLICT (organization_id, value) DO NOTHING;

  INSERT INTO public.task_priority_settings (organization_id, value, label, sort_order)
  SELECT _organization_id, p.value::public.work_priority, p.label, p.sort_order
  FROM (VALUES ('low','Low',1),('medium','Medium',2),('high','High',3),('critical','Critical',4))
    AS p(value, label, sort_order)
  ON CONFLICT (organization_id, value) DO NOTHING;

  INSERT INTO public.project_status_settings (organization_id, value, label, sort_order)
  SELECT _organization_id, s.value::public.project_lifecycle_status,
         initcap(replace(s.value, '_', ' ')), s.sort_order
  FROM (VALUES ('planning',1),('active',2),('on_hold',3),('completed',4),('cancelled',5),('archived',6))
    AS s(value, sort_order)
  ON CONFLICT (organization_id, value) DO NOTHING;

  INSERT INTO public.project_categories (organization_id, name, sort_order)
  SELECT _organization_id, c.name, c.sort_order
  FROM (VALUES ('Internal',1),('Client',2),('Product',3),('Marketing',4),('Operations',5),('Research',6))
    AS c(name, sort_order)
  ON CONFLICT (organization_id, name) DO NOTHING;

  INSERT INTO public.task_tags (organization_id, name)
  SELECT _organization_id, t.name
  FROM (VALUES ('frontend'),('backend'),('design'),('docs'),('security'),('urgent')) AS t(name)
  ON CONFLICT (organization_id, name) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION private.seed_organization_defaults(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.seed_organization_defaults(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_new_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.seed_organization_defaults(NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS seed_new_organization ON public.organizations;
CREATE TRIGGER seed_new_organization AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_new_organization();

-- Backfill every organization that already exists.
DO $$
DECLARE org RECORD;
BEGIN
  FOR org IN SELECT id FROM public.organizations LOOP
    PERFORM private.seed_organization_defaults(org.id);
  END LOOP;
END $$;

-- Point every existing user_roles row at its matching named role.
UPDATE public.user_roles ur
SET role_id = r.id
FROM public.roles r
WHERE r.organization_id = ur.organization_id
  AND r.base_role = ur.role
  AND r.is_system = true
  AND ur.role_id IS NULL;

UPDATE public.organization_memberships m
SET role_id = ur.role_id
FROM public.user_roles ur
WHERE ur.user_id = m.user_id
  AND ur.organization_id = m.organization_id
  AND m.role_id IS NULL;
