-- ============================================================
-- 038_kb_rls_policies.sql
-- Add Row Level Security (RLS) policies for knowledge_bases and document_chunks
-- ============================================================

-- 1. Knowledge Bases Policies
DROP POLICY IF EXISTS "Org members can manage knowledge bases" ON public.knowledge_bases;
CREATE POLICY "Org members can manage knowledge bases" ON public.knowledge_bases
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 2. Document Chunks Policies
DROP POLICY IF EXISTS "Org members can manage document chunks" ON public.document_chunks;
CREATE POLICY "Org members can manage document chunks" ON public.document_chunks
  FOR ALL USING (
    kb_id IN (
      SELECT id FROM public.knowledge_bases
      WHERE organization_id IN (SELECT get_user_organizations())
    )
  );
