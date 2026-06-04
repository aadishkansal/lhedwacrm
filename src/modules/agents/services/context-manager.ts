// src/modules/agents/services/context-manager.ts

import { AIMessage } from '../types';
import { MemoryRetriever } from './memory-retriever';

export interface ContextPayload {
  systemPrompt: string;
  messages: AIMessage[];
}

export class ContextManager {
  constructor(private memoryRetriever: MemoryRetriever) {}

  async assemble(params: {
    organizationId: string;
    contactId?: string;
    kbId?: string;
    rawPrompt: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    baseSystemPrompt?: string;
  }): Promise<ContextPayload> {
    let systemPrompt = params.baseSystemPrompt || "You are a helpful AI Assistant in our Solar EPC CRM.";

    // 1. Fetch and inject contact memory context
    if (params.contactId) {
      const memoryContext = await this.memoryRetriever.retrieveContext({
        contactId: params.contactId,
        organizationId: params.organizationId,
        query: params.rawPrompt
      });

      if (memoryContext) {
        systemPrompt += `\n\n${memoryContext}`;
      }
    }

    // 2. Fetch and inject RAG document chunks
    if (params.kbId) {
      const chunks = await this.memoryRetriever.fetchDocumentChunks({
        kbId: params.kbId,
        query: params.rawPrompt,
        threshold: 0.4,
        limit: 5
      });

      if (chunks.length > 0) {
        systemPrompt += `\n\n[Knowledge Base Context]\n${chunks.map((c, idx) => `[Doc Chunk ${idx + 1}]:\n${c}`).join('\n\n')}`;
      }
    }

    // Construct unified messages array
    const messages: AIMessage[] = [
      ...params.history.map(h => ({
        role: h.role as 'user' | 'assistant',
        content: h.content
      })),
      { role: 'user' as const, content: params.rawPrompt }
    ];

    return { systemPrompt, messages };
  }
}
