-- ============================================================
-- 027_agent_management.sql
-- Tables: agent_configs, agent_prompt_versions
-- ============================================================

-- 1. agent_configs — stores current active agent metadata
CREATE TABLE IF NOT EXISTS public.agent_configs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  role              TEXT NOT NULL CHECK (role IN ('supervisor', 'sales', 'support', 'installation', 'finance')),
  system_prompt     TEXT NOT NULL,
  allowed_tools     TEXT[] NOT NULL DEFAULT '{}',
  model             TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  temperature       NUMERIC(3,2) NOT NULL DEFAULT 0.3,
  kb_access         BOOLEAN NOT NULL DEFAULT FALSE,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  current_version   INTEGER NOT NULL DEFAULT 1,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, role)
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_org_role ON public.agent_configs(organization_id, role);

ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can manage agent configs" ON public.agent_configs;
CREATE POLICY "Org members can manage agent configs" ON public.agent_configs
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 2. agent_prompt_versions — stores historical versions of prompts
CREATE TABLE IF NOT EXISTS public.agent_prompt_versions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id          UUID NOT NULL REFERENCES agent_configs(id) ON DELETE CASCADE,
  system_prompt     TEXT NOT NULL,
  version           INTEGER NOT NULL,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_prompt_versions_agent ON public.agent_prompt_versions(agent_id, version DESC);

ALTER TABLE public.agent_prompt_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view agent prompt versions" ON public.agent_prompt_versions;
CREATE POLICY "Org members can view agent prompt versions" ON public.agent_prompt_versions
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));
