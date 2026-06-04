// src/modules/rag/services/similarity-service.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { EmbeddingService } from './embedding-service';

export interface SimilarityResult {
  id: string;
  content: string;
  similarity: number;
}

export interface ConversationSimilarityResult extends SimilarityResult {
  message_id: string | null;
}

export class SimilaritySearchService {
  private embeddingService = new EmbeddingService();

  async searchDocumentChunks(params: {
    kbId: string;
    query: string;
    threshold?: number;
    limit?: number;
    category?: string;
    fileType?: string;
  }): Promise<SimilarityResult[]> {
    const embedding = await this.embeddingService.getEmbedding(params.query);
    const db = supabaseAdmin();
    const { data, error } = await db.rpc('match_document_chunks_filtered', {
      p_kb_id: params.kbId,
      query_embedding: embedding,
      match_threshold: params.threshold ?? 0.4,
      match_count: params.limit ?? 5,
      p_category: params.category || null,
      p_file_type: params.fileType || null,
    });
    if (error) throw error;
    return (data || []) as SimilarityResult[];
  }

  async searchContactMemories(params: {
    contactId: string;
    organizationId: string;
    query: string;
    threshold?: number;
    limit?: number;
  }): Promise<SimilarityResult[]> {
    const embedding = await this.embeddingService.getEmbedding(params.query);
    const db = supabaseAdmin();
    const { data, error } = await db.rpc('match_contact_memories', {
      p_contact_id: params.contactId,
      p_organization_id: params.organizationId,
      query_embedding: embedding,
      match_threshold: params.threshold ?? 0.4,
      match_count: params.limit ?? 5,
    });
    if (error) throw error;
    return (data || []) as SimilarityResult[];
  }

  async searchConversationEmbeddings(params: {
    conversationId: string;
    organizationId: string;
    query: string;
    threshold?: number;
    limit?: number;
  }): Promise<ConversationSimilarityResult[]> {
    const embedding = await this.embeddingService.getEmbedding(params.query);
    const db = supabaseAdmin();
    const { data, error } = await db.rpc('match_conversation_embeddings', {
      p_conversation_id: params.conversationId,
      p_organization_id: params.organizationId,
      query_embedding: embedding,
      match_threshold: params.threshold ?? 0.4,
      match_count: params.limit ?? 5,
    });
    if (error) throw error;
    return (data || []) as ConversationSimilarityResult[];
  }
}
