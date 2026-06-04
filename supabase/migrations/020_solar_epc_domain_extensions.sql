-- ============================================================
-- 020_solar_epc_domain_extensions.sql
-- Create database schema for epc_site_visits and net_metering
-- ============================================================

-- 1. Create epc_site_visits
CREATE TABLE IF NOT EXISTS public.epc_site_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES epc_projects(id) ON DELETE CASCADE,
  technician_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  notes TEXT,
  photos TEXT[] DEFAULT '{}'::text[],
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled'))
);

-- 2. Create net_metering_applications
CREATE TABLE IF NOT EXISTS public.net_metering_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES epc_projects(id) ON DELETE CASCADE,
  utility_company TEXT NOT NULL,
  application_number TEXT,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'review', 'approved', 'meter_installed', 'interconnected')),
  applied_at DATE NOT NULL DEFAULT CURRENT_DATE,
  approved_at DATE,
  interconnected_at DATE
);

-- 3. Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_visits_schedule ON public.epc_site_visits (organization_id, scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_visits_project ON public.epc_site_visits (project_id);
CREATE INDEX IF NOT EXISTS idx_net_metering_status ON public.net_metering_applications (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_net_metering_project ON public.net_metering_applications (project_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.epc_site_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.net_metering_applications ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DROP POLICY IF EXISTS "Users view site visits in their organizations" ON public.epc_site_visits;
CREATE POLICY "Users view site visits in their organizations" ON public.epc_site_visits FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));

DROP POLICY IF EXISTS "Users view net metering in their organizations" ON public.net_metering_applications;
CREATE POLICY "Users view net metering in their organizations" ON public.net_metering_applications FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));
