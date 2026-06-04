// src/modules/rag/services/embedding-worker.ts

import { EmbeddingService } from './embedding-service';

export class EmbeddingWorker {
  private embeddingService = new EmbeddingService();

  /**
   * Generates embeddings for an array of text chunks using controlled concurrency
   * to respect API rate limits and avoid timeout issues.
   */
  async generateEmbeddingsInBatches(chunks: string[], batchSize = 5): Promise<number[][]> {
    const results: number[][] = [];
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      // Process a single batch of chunks concurrently
      const embeddings = await Promise.all(
        batch.map(chunk => this.embeddingService.getEmbedding(chunk))
      );
      
      results.push(...embeddings);
    }
    
    return results;
  }
}
