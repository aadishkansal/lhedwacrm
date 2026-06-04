-- ============================================================
-- 026_supervisor_routing.sql
-- Table: supervisor_routing_decisions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.supervisor_routing_decisions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id     UUID REFERENCES conversations(id) ON DELETE SET NULL,
  message_text        TEXT,
  detected_intent     TEXT,
  classified_dept     TEXT NOT NULL CHECK (classified_dept IN ('Sales', 'Support', 'Installation', 'Finance')),
  confidence          NUMERIC(4,3) NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  priority            TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  human_handoff       BOOLEAN NOT NULL DEFAULT FALSE,
  escalation_reason   TEXT,
  routing_decision    TEXT NOT NULL CHECK (routing_decision IN ('route_to_agent', 'escalate_to_human', 'no_action')),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supervisor_routing_org ON public.supervisor_routing_decisions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supervisor_routing_contact ON public.supervisor_routing_decisions(contact_id);

ALTER TABLE public.supervisor_routing_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view supervisor routing decisions" ON public.supervisor_routing_decisions;
CREATE POLICY "Org members can view supervisor routing decisions" ON public.supervisor_routing_decisions
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));
