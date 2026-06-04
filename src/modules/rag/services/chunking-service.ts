// src/modules/rag/services/chunking-service.ts

export class ChunkingService {
  /**
   * Splits a text document into chunks of approximately chunkSize characters,
   * respecting sentence or paragraph boundaries to ensure high coherence.
   */
  chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
    const chunks: string[] = [];
    if (!text || text.trim().length === 0) return chunks;

    // Split text into paragraphs first
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      const cleanPara = paragraph.trim();
      if (!cleanPara) continue;

      // If a single paragraph is larger than the chunk size, split it by sentence
      if (cleanPara.length > chunkSize) {
        // If we have accumulated text in currentChunk, flush it first
        if (currentChunk.trim().length > 0) {
          chunks.push(currentChunk.trim());
          // Keep overlap
          currentChunk = currentChunk.slice(-overlap);
        }

        const sentences = cleanPara.match(/[^.!?]+[.!?]+(\s|$)/g) || [cleanPara];
        for (const sentence of sentences) {
          const cleanSentence = sentence.trim();
          if (!cleanSentence) continue;

          if (currentChunk.length + cleanSentence.length > chunkSize) {
            if (currentChunk.trim().length > 0) {
              chunks.push(currentChunk.trim());
            }
            // Keep overlap
            currentChunk = currentChunk.slice(-overlap) + ' ' + cleanSentence;
          } else {
            currentChunk += (currentChunk ? ' ' : '') + cleanSentence;
          }
        }
      } else {
        // Paragraph fits in chunk size limits
        if (currentChunk.length + cleanPara.length > chunkSize) {
          if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk.trim());
          }
          // Keep overlap
          currentChunk = currentChunk.slice(-overlap) + '\n\n' + cleanPara;
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + cleanPara;
        }
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Formats FAQ pairs into clean, single semantic chunks of Question & Answer.
   */
  chunkFAQs(faqs: Array<{ question: string; answer: string }>): string[] {
    return faqs
      .filter(faq => faq.question.trim() && faq.answer.trim())
      .map(faq => {
        return `Question: ${faq.question.trim()}\nAnswer: ${faq.answer.trim()}`;
      });
  }
}
