-- ============================================================
-- 016_vector_match_rpc.sql
-- Vector similarity matching RPC functions for contact memories
-- and document chunks (RAG).
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_contact_memories (
  p_contact_id UUID,
  p_organization_id UUID,
  query_embedding vector(1536),
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
  query_embedding vector(1536),
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
