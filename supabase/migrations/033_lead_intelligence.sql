-- ============================================================
-- 033_lead_intelligence.sql
-- Source tables: lead_follow_ups, lead_stage_history, lead_lost_reasons, proposal, converted_leads
-- Insights table: lead_intelligence_insights
-- ============================================================

-- 1. lead_follow_ups
CREATE TABLE IF NOT EXISTS public.lead_follow_ups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'cancelled')),
  notes           TEXT,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_contact ON public.lead_follow_ups(contact_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_follow_ups_org     ON public.lead_follow_ups(organization_id);

ALTER TABLE public.lead_follow_ups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage lead_follow_ups" ON public.lead_follow_ups;
CREATE POLICY "Org members can manage lead_follow_ups" ON public.lead_follow_ups
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 2. lead_stage_history
CREATE TABLE IF NOT EXISTS public.lead_stage_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id         UUID REFERENCES deals(id) ON DELETE CASCADE,
  stage_name      TEXT NOT NULL,
  entered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exited_at       TIMESTAMPTZ,
  duration_days   NUMERIC,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_stage_hist_contact ON public.lead_stage_history(contact_id, entered_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_stage_hist_org     ON public.lead_stage_history(organization_id);

ALTER TABLE public.lead_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view lead_stage_history" ON public.lead_stage_history;
CREATE POLICY "Org members can view lead_stage_history" ON public.lead_stage_history
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 3. lead_lost_reasons
CREATE TABLE IF NOT EXISTS public.lead_lost_reasons (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id         UUID REFERENCES deals(id) ON DELETE CASCADE,
  reason          TEXT NOT NULL,
  details         TEXT,
  lost_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_lost_reasons_contact ON public.lead_lost_reasons(contact_id, lost_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_lost_reasons_org     ON public.lead_lost_reasons(organization_id);

ALTER TABLE public.lead_lost_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage lead_lost_reasons" ON public.lead_lost_reasons;
CREATE POLICY "Org members can manage lead_lost_reasons" ON public.lead_lost_reasons
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 4. proposal
CREATE TABLE IF NOT EXISTS public.proposal (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id         UUID REFERENCES deals(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  total_amount    NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposal_contact ON public.proposal(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposal_org     ON public.proposal(organization_id);

ALTER TABLE public.proposal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage proposal" ON public.proposal;
CREATE POLICY "Org members can manage proposal" ON public.proposal
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 5. converted_leads
CREATE TABLE IF NOT EXISTS public.converted_leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id         UUID REFERENCES deals(id) ON DELETE CASCADE,
  converted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  value           NUMERIC(12,2),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_converted_leads_contact ON public.converted_leads(contact_id, converted_at DESC);
CREATE INDEX IF NOT EXISTS idx_converted_leads_org     ON public.converted_leads(organization_id);

ALTER TABLE public.converted_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage converted_leads" ON public.converted_leads;
CREATE POLICY "Org members can manage converted_leads" ON public.converted_leads
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 6. lead_intelligence_insights
CREATE TABLE IF NOT EXISTS public.lead_intelligence_insights (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id            UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  score                 INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  conversion_probability NUMERIC(5,2) NOT NULL CHECK (conversion_probability >= 0 AND conversion_probability <= 100),
  likely_objections     TEXT[] NOT NULL DEFAULT '{}'::text[],
  churn_risk            NUMERIC(5,2) NOT NULL CHECK (churn_risk >= 0 AND churn_risk <= 100),
  next_best_action      TEXT NOT NULL,
  followup_suggestions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_intel_contact ON public.lead_intelligence_insights(contact_id);
CREATE INDEX IF NOT EXISTS idx_lead_intel_org     ON public.lead_intelligence_insights(organization_id);

ALTER TABLE public.lead_intelligence_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can manage lead_intelligence_insights" ON public.lead_intelligence_insights;
CREATE POLICY "Org members can manage lead_intelligence_insights" ON public.lead_intelligence_insights
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));
