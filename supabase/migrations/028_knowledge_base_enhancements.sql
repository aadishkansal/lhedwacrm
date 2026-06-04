-- ============================================================
-- 028_knowledge_base_enhancements.sql
-- Tables: kb_documents
-- Columns: document_chunks.document_id
-- RPC: match_document_chunks_filtered
-- ============================================================

-- 1. Create kb_documents table
CREATE TABLE IF NOT EXISTS public.kb_documents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kb_id             UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  file_path         TEXT NOT NULL,
  file_size         INTEGER NOT NULL,
  file_type         TEXT NOT NULL CHECK (file_type IN ('pdf', 'docx', 'txt', 'faq', 'markdown')),
  category          TEXT NOT NULL CHECK (category IN ('Company Information', 'Solar Products', 'Warranty Documents', 'Subsidy Documents', 'Installation Guides', 'Policies', 'Sales Scripts')),
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  error_message     TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(kb_id, title)
);

CREATE INDEX IF NOT EXISTS idx_kb_documents_org ON public.kb_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_kb_documents_kb ON public.kb_documents(kb_id);

-- 2. Row Level Security Policies
ALTER TABLE public.kb_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can manage kb documents" ON public.kb_documents;
CREATE POLICY "Org members can manage kb documents" ON public.kb_documents
  FOR ALL USING (organization_id IN (SELECT get_user_organizations()));

-- 3. Attach Audit Logging Trigger
DROP TRIGGER IF EXISTS audit_kb_documents ON public.kb_documents;
CREATE TRIGGER audit_kb_documents
  AFTER INSERT OR UPDATE OR DELETE ON public.kb_documents
  FOR EACH ROW EXECUTE FUNCTION process_audit_logging();

-- 4. Alter document_chunks to add document_id
ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES public.kb_documents(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON public.document_chunks(document_id);

-- 5. Create match_document_chunks_filtered RPC
CREATE OR REPLACE FUNCTION public.match_document_chunks_filtered (
  p_kb_id UUID,
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_category TEXT DEFAULT NULL,
  p_file_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity float,
  metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    dc.metadata
  FROM document_chunks dc
  LEFT JOIN kb_documents doc ON dc.document_id = doc.id
  WHERE dc.kb_id = p_kb_id
    AND (p_category IS NULL OR doc.category = p_category)
    AND (p_file_type IS NULL OR doc.file_type = p_file_type)
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
