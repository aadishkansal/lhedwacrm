-- ============================================================
-- 022_vector_dimension_1536.sql
-- Adjust pgvector columns to 1536 dimensions for OpenAI text-embedding-3-small
-- and create conversation_embeddings table.
-- ============================================================

-- 1. Drop existing indexes
DROP INDEX IF EXISTS public.document_chunks_embedding_idx;
DROP INDEX IF EXISTS public.idx_contact_mem_embedding;
DROP INDEX IF EXISTS public.conversation_embeddings_embedding_idx;

-- 2. Alter columns in document_chunks and contact_memories to vector(1536)
ALTER TABLE public.document_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.document_chunks ADD COLUMN embedding vector(1536);

ALTER TABLE public.contact_memories DROP COLUMN IF EXISTS embedding;
ALTER TABLE public.contact_memories ADD COLUMN embedding vector(1536);

-- 3. Create conversation_embeddings table
CREATE TABLE IF NOT EXISTS public.conversation_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Create HNSW indexes
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx ON public.document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_contact_mem_embedding ON public.contact_memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS conversation_embeddings_embedding_idx ON public.conversation_embeddings USING hnsw (embedding vector_cosine_ops);

-- 5. Enable RLS
ALTER TABLE public.conversation_embeddings ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policy
DROP POLICY IF EXISTS "Users view conversation embeddings in their organizations" ON public.conversation_embeddings;
CREATE POLICY "Users view conversation embeddings in their organizations" ON public.conversation_embeddings FOR ALL
  USING (organization_id IN (SELECT get_user_organizations()));

-- 7. RPC matching functions for 1536 dimensions
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

CREATE OR REPLACE FUNCTION public.match_conversation_embeddings (
  p_conversation_id UUID,
  p_organization_id UUID,
  query_embedding vector(1536),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id UUID,
  message_id UUID,
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
    ce.id,
    ce.message_id,
    ce.content,
    1 - (ce.embedding <=> query_embedding) AS similarity
  FROM conversation_embeddings ce
  WHERE ce.conversation_id = p_conversation_id
    AND ce.organization_id = p_organization_id
    AND 1 - (ce.embedding <=> query_embedding) > match_threshold
  ORDER BY ce.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
