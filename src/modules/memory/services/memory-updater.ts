// src/modules/memory/services/memory-updater.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { MemoryExtractor } from './memory-extractor';
import { EmbeddingService } from '../../rag/services/embedding-service';

export class MemoryUpdater {
  private extractor = new MemoryExtractor();
  private embeddingService = new EmbeddingService();

  /**
   * Automatically consolidates the latest conversation messages, extracting key facts,
   * preferences, and updating the ongoing conversation summary. Enforces token efficiency
   * limits and duplicate checks.
   */
  async consolidateConversation(params: {
    conversationId: string;
    contactId: string;
    organizationId: string;
  }): Promise<void> {
    const admin = supabaseAdmin();

    // 1. Find last memory creation timestamp to optimize token usage (cooldown window check)
    const { data: lastMemory } = await admin
      .from('contact_memories')
      .select('created_at')
      .eq('contact_id', params.contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastMemory?.created_at) {
      const lastTime = new Date(lastMemory.created_at).getTime();
      const now = Date.now();
      if (now - lastTime < 120000) { // 2 minutes cooldown
        console.log('[MemoryUpdater] Skipping consolidation: within 2-minute cooldown.');
        return;
      }
    }

    // 2. Fetch new messages since the last consolidation
    let queryBuilder = admin
      .from('messages')
      .select('sender_type, content_text, created_at')
      .eq('conversation_id', params.conversationId)
      .order('created_at', { ascending: true });

    if (lastMemory?.created_at) {
      queryBuilder = queryBuilder.gt('created_at', lastMemory.created_at);
    }

    // Enforce token efficiency by limiting to a context window of the latest 30 messages
    const { data: messages, error: msgError } = await queryBuilder.limit(30);

    if (msgError || !messages || messages.length === 0) {
      console.log('[MemoryUpdater] No new messages to consolidate for conversation:', params.conversationId);
      return;
    }

    // Filter and format transcript
    const transcript = messages
      .filter(m => m.content_text)
      .map(m => `${m.sender_type}: ${m.content_text}`)
      .join('\n');

    if (!transcript.trim()) {
      return;
    }

    console.log(`[MemoryUpdater] Consolidating conversation ${params.conversationId} (${messages.length} new messages)`);

    // 3. Extract facts and preferences
    const extracted = await this.extractor.extractMemories({
      transcript,
      organizationId: params.organizationId,
      conversationId: params.conversationId
    });

    // 4. Retrieve existing summary if present to build upon
    const { data: latestSummaryRow } = await admin
      .from('contact_memories')
      .select('content')
      .eq('contact_id', params.contactId)
      .eq('memory_type', 'interaction')
      .like('content', 'Summary:%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingSummary = latestSummaryRow?.content ? latestSummaryRow.content.replace(/^Summary:\s*/, '') : undefined;

    // 5. Generate updated conversation summary
    const newSummary = await this.extractor.generateSummary({
      transcript,
      existingSummary,
      organizationId: params.organizationId,
      conversationId: params.conversationId
    });

    // 6. Store extracted facts & preferences (with duplicate checks)
    const allExtracted = [
      ...extracted.facts.map(fact => ({ content: fact, type: 'fact' as const })),
      ...extracted.preferences.map(pref => ({ content: pref, type: 'preference' as const }))
    ];

    for (const item of allExtracted) {
      try {
        const embedding = await this.embeddingService.getEmbedding(item.content);

        // Deduplication Check: Cosine similarity threshold > 0.85
        const { data: matches, error: rpcError } = await admin.rpc('match_contact_memories', {
          p_contact_id: params.contactId,
          p_organization_id: params.organizationId,
          query_embedding: embedding,
          match_threshold: 0.85,
          match_count: 1
        });

        if (rpcError) {
          console.warn('[MemoryUpdater] Duplicate check error:', rpcError.message);
        }

        if (matches && matches.length > 0) {
          console.log(`[MemoryUpdater] Skipping duplicate memory: "${item.content}" (Matches: "${matches[0].content}", similarity: ${matches[0].similarity})`);
          continue;
        }

        // Insert new long-term memory
        const { error: insertError } = await admin.from('contact_memories').insert({
          organization_id: params.organizationId,
          contact_id: params.contactId,
          memory_type: item.type,
          content: item.content,
          embedding
        });

        if (insertError) {
          console.error('[MemoryUpdater] Insert memory error:', insertError.message);
        }
      } catch (err: any) {
        console.error('[MemoryUpdater] Failed to process memory item:', err.message);
      }
    }

    // 7. Save updated summary as interaction memory
    if (newSummary.trim()) {
      try {
        const summaryText = `Summary: ${newSummary}`;
        const embedding = await this.embeddingService.getEmbedding(summaryText);

        const { error: summaryError } = await admin.from('contact_memories').insert({
          organization_id: params.organizationId,
          contact_id: params.contactId,
          memory_type: 'interaction',
          content: summaryText,
          embedding
        });

        if (summaryError) {
          console.error('[MemoryUpdater] Insert summary error:', summaryError.message);
        } else {
          console.log('[MemoryUpdater] Saved updated conversation summary.');
        }
      } catch (err: any) {
        console.error('[MemoryUpdater] Failed to store summary:', err.message);
      }
    }
  }
}

// Maintain backward compatibility with MemoryService alias
export const MemoryService = MemoryUpdater;
export type MemoryService = MemoryUpdater;
