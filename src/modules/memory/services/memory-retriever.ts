// src/modules/memory/services/memory-retriever.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { EmbeddingService } from '../../rag/services/embedding-service';

export interface RetrievedMemories {
  facts: string[];
  preferences: string[];
  interactions: string[];
}

export class MemoryRetriever {
  private embeddingService = new EmbeddingService();

  async getEmbedding(text: string): Promise<number[]> {
    return this.embeddingService.getEmbedding(text);
  }

  async fetchDocumentChunks(params: {
    kbId: string;
    query: string;
    threshold?: number;
    limit?: number;
  }): Promise<string[]> {
    const admin = supabaseAdmin();
    try {
      const embedding = await this.getEmbedding(params.query);
      const { data, error } = await admin.rpc('match_document_chunks', {
        p_kb_id: params.kbId,
        query_embedding: embedding,
        match_threshold: params.threshold ?? 0.4,
        match_count: params.limit ?? 5,
      });

      if (error) {
        console.error('Error fetching document chunks:', error.message);
        return [];
      }

      return (data || []).map((row: any) => row.content as string);
    } catch (e: any) {
      console.error('Failed to retrieve document chunks:', e.message);
      return [];
    }
  }

  async fetchContactMemories(params: {
    contactId: string;
    organizationId: string;
    query: string;
    threshold?: number;
    limit?: number;
  }): Promise<string[]> {
    const admin = supabaseAdmin();
    try {
      const embedding = await this.getEmbedding(params.query);
      const { data, error } = await admin.rpc('match_contact_memories', {
        p_contact_id: params.contactId,
        p_organization_id: params.organizationId,
        query_embedding: embedding,
        match_threshold: params.threshold ?? 0.4,
        match_count: params.limit ?? 5,
      });

      if (error) {
        console.error('Error fetching contact memories:', error.message);
        return [];
      }

      return (data || []).map((row: any) => row.content as string);
    } catch (e: any) {
      console.error('Failed to retrieve contact memories:', e.message);
      return [];
    }
  }

  async retrieveMemories(params: {
    contactId: string;
    organizationId: string;
    query: string;
    limit?: number;
  }): Promise<RetrievedMemories> {
    const admin = supabaseAdmin();
    const limit = params.limit ?? 5;
    const facts: string[] = [];
    const preferences: string[] = [];
    const interactions: string[] = [];

    try {
      const queryEmbedding = await this.getEmbedding(params.query);

      // Perform pgvector cosine similarity search on contact memories
      const { data, error } = await admin.rpc('match_contact_memories', {
        p_contact_id: params.contactId,
        p_organization_id: params.organizationId,
        query_embedding: queryEmbedding,
        match_threshold: 0.4,
        match_count: limit * 3 // Pull extra to categorize and slice later
      });

      if (error) {
        console.error('[MemoryRetriever] Failed to retrieve memories:', error.message);
        return { facts, preferences, interactions };
      }

      if (data && data.length > 0) {
        // Query full memory rows using the matched ids to get their types
        const matchedIds = data.map((row: any) => row.id);
        const { data: fullRows, error: fetchError } = await admin
          .from('contact_memories')
          .select('content, memory_type')
          .in('id', matchedIds);

        if (!fetchError && fullRows) {
          for (const row of fullRows) {
            if (row.memory_type === 'fact') {
              facts.push(row.content);
            } else if (row.memory_type === 'preference') {
              preferences.push(row.content);
            } else if (row.memory_type === 'interaction') {
              interactions.push(row.content);
            }
          }
        }
      }
    } catch (err: any) {
      console.error('[MemoryRetriever] retrieveMemories error:', err.message);
    }

    return {
      facts: facts.slice(0, limit),
      preferences: preferences.slice(0, limit),
      interactions: interactions.slice(0, limit)
    };
  }

  async retrieveContext(params: {
    contactId: string;
    organizationId: string;
    query: string;
  }): Promise<string> {
    const { facts, preferences, interactions } = await this.retrieveMemories(params);
    let parts: string[] = [];

    if (facts.length > 0) {
      parts.push(`[Long-term Facts / Installation / Project History]\n${facts.map(f => `- ${f}`).join('\n')}`);
    }

    if (preferences.length > 0) {
      parts.push(`[Customer Preferences]\n${preferences.map(p => `- ${p}`).join('\n')}`);
    }

    if (interactions.length > 0) {
      parts.push(`[Previous Interaction Summaries]\n${interactions.map(it => `- ${it}`).join('\n')}`);
    }

    return parts.join('\n\n').trim();
  }
}
