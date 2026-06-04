-- ============================================================
-- 035_team_routing_engine.sql
-- Columns: organization_users.department, conversations.assigned_department
-- Table: team_routing_logs
-- ============================================================

-- 1. Add department to organization_users
ALTER TABLE public.organization_users ADD COLUMN IF NOT EXISTS department TEXT CHECK (department IN ('Sales', 'Support', 'Installation', 'Finance'));

-- 2. Add assigned_department to conversations
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS assigned_department TEXT CHECK (assigned_department IN ('Sales', 'Support', 'Installation', 'Finance'));

-- 3. Create team_routing_logs
CREATE TABLE IF NOT EXISTS public.team_routing_logs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id       UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ticket_id             UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  classified_department  TEXT NOT NULL CHECK (classified_department IN ('Sales', 'Support', 'Installation', 'Finance')),
  previous_agent_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_agent_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  routing_duration_ms   INTEGER NOT NULL DEFAULT 0,
  is_escalation         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_routing_logs_org ON public.team_routing_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_routing_logs_conv ON public.team_routing_logs(conversation_id);

ALTER TABLE public.team_routing_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can view team routing logs" ON public.team_routing_logs;
CREATE POLICY "Org members can view team routing logs" ON public.team_routing_logs
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));
