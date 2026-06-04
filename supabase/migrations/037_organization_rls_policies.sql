-- ============================================================
-- 037_organization_rls_policies.sql
-- Add Row Level Security (RLS) policies for organizations and organization_users
-- ============================================================

-- 1. Organizations Policies
DROP POLICY IF EXISTS "Users can view organizations they belong to" ON public.organizations;
CREATE POLICY "Users can view organizations they belong to" ON public.organizations
  FOR SELECT USING (id IN (SELECT get_user_organizations()));

-- 2. Organization Users Policies
DROP POLICY IF EXISTS "Users can view organization users in their organizations" ON public.organization_users;
CREATE POLICY "Users can view organization users in their organizations" ON public.organization_users
  FOR SELECT USING (organization_id IN (SELECT get_user_organizations()) OR user_id = auth.uid());
