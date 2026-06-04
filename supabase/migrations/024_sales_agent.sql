-- ============================================================
-- 024_sales_agent.sql
-- Tables: agent_decisions, lead_scores, appointments
-- ============================================================

-- 1. agent_decisions — log every SalesAgent decision
CREATE TABLE IF NOT EXISTS public.agent_decisions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  agent_name        TEXT NOT NULL DEFAULT 'SalesAgent',
  action            TEXT NOT NULL,
  reasoning         TEXT,
  lead_score        INTEGER,
  lead_band         TEXT CHECK (lead_band IN ('cold', 'warm', 'hot')),
  metadata          JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_org       ON public.agent_decisions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_contact   ON public.agent_decisions(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_action    ON public.agent_decisions(action);

ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view agent decisions" ON public.agent_decisions;
CREATE POLICY "Org members can view agent decisions" ON public.agent_decisions
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 2. lead_scores — persist rolling score history per contact
CREATE TABLE IF NOT EXISTS public.lead_scores (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  band            TEXT NOT NULL CHECK (band IN ('cold', 'warm', 'hot')),
  signals         JSONB DEFAULT '{}'::jsonb,
  computed_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_contact  ON public.lead_scores(contact_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_scores_org_band ON public.lead_scores(organization_id, band, computed_at DESC);

ALTER TABLE public.lead_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view lead scores" ON public.lead_scores;
CREATE POLICY "Org members can view lead scores" ON public.lead_scores
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 3. appointments — bookings made by the agent
CREATE TABLE IF NOT EXISTS public.appointments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id         UUID REFERENCES deals(id) ON DELETE SET NULL,
  project_id      UUID REFERENCES epc_projects(id) ON DELETE SET NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  duration_mins   INTEGER NOT NULL DEFAULT 60,
  appointment_type TEXT NOT NULL DEFAULT 'site_visit'
    CHECK (appointment_type IN ('site_visit', 'sales_call', 'installation_review', 'followup_call')),
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'rescheduled')),
  booked_by       TEXT NOT NULL DEFAULT 'SalesAgent',
  whatsapp_sent   BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_contact ON public.appointments(contact_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_org     ON public.appointments(organization_id, scheduled_at);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view appointments" ON public.appointments;
CREATE POLICY "Org members can view appointments" ON public.appointments
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));
