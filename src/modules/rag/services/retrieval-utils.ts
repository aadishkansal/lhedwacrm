// src/modules/rag/services/retrieval-utils.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { EmbeddingService } from './embedding-service';

export class VectorRetrievalUtils {
  private embeddingService = new EmbeddingService();

  async storeConversationEmbedding(params: {
    organizationId: string;
    conversationId: string;
    messageId?: string;
    content: string;
  }): Promise<void> {
    const db = supabaseAdmin();
    const embedding = await this.embeddingService.getEmbedding(params.content);
    const { error } = await db.from('conversation_embeddings').insert({
      organization_id: params.organizationId,
      conversation_id: params.conversationId,
      message_id: params.messageId || null,
      content: params.content,
      embedding
    });
    if (error) {
      console.error('[VectorRetrievalUtils] failed to store conversation embedding:', error.message);
      throw error;
    }
  }

  async generateRAGContext(params: {
    organizationId: string;
    query: string;
    kbId?: string;
    contactId?: string;
    conversationId?: string;
  }): Promise<string> {
    const db = supabaseAdmin();
    const embedding = await this.embeddingService.getEmbedding(params.query);
    let contextParts: string[] = [];

    // 1. Fetch document chunks (RAG)
    if (params.kbId) {
      const { data: chunks, error } = await db.rpc('match_document_chunks', {
        p_kb_id: params.kbId,
        query_embedding: embedding,
        match_threshold: 0.4,
        match_count: 3
      });
      if (!error && chunks && chunks.length > 0) {
        contextParts.push(`[Knowledge Base Context]\n${chunks.map((c: any) => c.content).join('\n')}`);
      }
    }

    // 2. Fetch contact memories
    if (params.contactId) {
      const { data: memories, error } = await db.rpc('match_contact_memories', {
        p_contact_id: params.contactId,
        p_organization_id: params.organizationId,
        query_embedding: embedding,
        match_threshold: 0.4,
        match_count: 3
      });
      if (!error && memories && memories.length > 0) {
        contextParts.push(`[Contact Memories]\n${memories.map((m: any) => m.content).join('\n')}`);
      }
    }

    // 3. Fetch past similar conversation context
    if (params.conversationId) {
      const { data: convs, error } = await db.rpc('match_conversation_embeddings', {
        p_conversation_id: params.conversationId,
        p_organization_id: params.organizationId,
        query_embedding: embedding,
        match_threshold: 0.4,
        match_count: 3
      });
      if (!error && convs && convs.length > 0) {
        contextParts.push(`[Past Similar Conversation Details]\n${convs.map((c: any) => c.content).join('\n')}`);
      }
    }

    return contextParts.join('\n\n').trim();
  }
}
