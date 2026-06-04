-- ============================================================
-- 032_ticketing_system_enhancements.sql
-- Add ticket assignment, category, resolution, and RLS policies
-- ============================================================

-- 1. Alter support_tickets to add columns
ALTER TABLE public.support_tickets 
  ADD COLUMN IF NOT EXISTS assigned_agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Create index for performance
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_agent ON public.support_tickets(assigned_agent_id);

-- 3. Configure RLS on support_tickets
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can manage support tickets" ON public.support_tickets;
CREATE POLICY "Org members can manage support tickets" ON public.support_tickets
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));
