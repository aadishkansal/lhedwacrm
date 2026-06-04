// src/modules/rag/services/embedding-service.ts

import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';

export class EmbeddingService {
  async getEmbedding(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: text,
    });
    return embedding;
  }

  async getEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.getEmbedding(text));
    }
    return embeddings;
  }
}
