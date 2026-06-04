-- ============================================================
-- 018_vector_dimension_768.sql
-- Adjust pgvector columns to 768 dimensions for Google Gemini
-- ============================================================

-- Drop indexes first
DROP INDEX IF EXISTS public.document_chunks_embedding_idx;
DROP INDEX IF EXISTS public.idx_contact_mem_embedding;

-- Recreate columns with vector(768)
ALTER TABLE public.document_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.document_chunks ADD COLUMN embedding vector(768);

ALTER TABLE public.contact_memories DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.contact_memories ADD COLUMN embedding vector(768);

-- Recreate HNSW indexes for 768 dimensions
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx ON public.document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_contact_mem_embedding ON public.contact_memories USING hnsw (embedding vector_cosine_ops);

-- Recreate RPC functions to match vector(768) parameters
CREATE OR REPLACE FUNCTION public.match_contact_memories (
  p_contact_id UUID,
  p_organization_id UUID,
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cm.id,
    cm.content,
    1 - (cm.embedding <=> query_embedding) AS similarity
  FROM contact_memories cm
  WHERE cm.contact_id = p_contact_id
    AND cm.organization_id = p_organization_id
    AND 1 - (cm.embedding <=> query_embedding) > match_threshold
  ORDER BY cm.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_document_chunks (
  p_kb_id UUID,
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  similarity float
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
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE dc.kb_id = p_kb_id
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
