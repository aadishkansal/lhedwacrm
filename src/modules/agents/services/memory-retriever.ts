// src/modules/agents/services/memory-retriever.ts

import { MemoryRetriever as UnifiedMemoryRetriever } from '../../memory/services/memory-retriever';

export class MemoryRetriever extends UnifiedMemoryRetriever {
  constructor(providerId: 'google' | 'openai' = 'openai') {
    super();
  }
}
