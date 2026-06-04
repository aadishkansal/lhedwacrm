-- ============================================================
-- 030_workflow_engine_enhancements.sql
-- Tables: workflow_runs, workflow_step_executions, workflow_approvals
-- ============================================================

-- 1. Create workflow_runs table
CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  automation_id     UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
  variables         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_org ON public.workflow_runs(organization_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_automation ON public.workflow_runs(automation_id);

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view workflow runs" ON public.workflow_runs;
CREATE POLICY "Org members can view workflow runs" ON public.workflow_runs
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 2. Create workflow_step_executions table
CREATE TABLE IF NOT EXISTS public.workflow_step_executions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id            UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id           UUID NOT NULL REFERENCES automation_steps(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempt_count     INTEGER NOT NULL DEFAULT 1,
  input_payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message     TEXT,
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  finished_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_step_execs_run ON public.workflow_step_executions(run_id);
CREATE INDEX IF NOT EXISTS idx_step_execs_org ON public.workflow_step_executions(organization_id);

ALTER TABLE public.workflow_step_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view step executions" ON public.workflow_step_executions;
CREATE POLICY "Org members can view step executions" ON public.workflow_step_executions
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 3. Create workflow_approvals table
CREATE TABLE IF NOT EXISTS public.workflow_approvals (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id            UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id           UUID NOT NULL REFERENCES automation_steps(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  expires_at        TIMESTAMPTZ,
  decided_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approvals_org ON public.workflow_approvals(organization_id);

ALTER TABLE public.workflow_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view approvals" ON public.workflow_approvals;
CREATE POLICY "Org members can view approvals" ON public.workflow_approvals
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));
