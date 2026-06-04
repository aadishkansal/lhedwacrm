-- ============================================================
-- 023_unanswered_questions_log.sql
-- Create unanswered_questions logging table to track
-- low-confidence RAG bot answers for continuous KB improvements.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.unanswered_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.unanswered_questions ENABLE ROW LEVEL SECURITY;

-- Policy
DROP POLICY IF EXISTS "Users view unanswered questions in their organizations" ON public.unanswered_questions;
CREATE POLICY "Users view unanswered questions in their organizations" ON public.unanswered_questions FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));
