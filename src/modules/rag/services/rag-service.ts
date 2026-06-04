import { customerContextService } from '../../crm/services/customer-context-service';
import { SimilaritySearchService } from './similarity-service';
import { AIService } from '../../agents/services/ai-service';

export interface RAGCitation {
  title: string;
  source: string;
  category: string;
  chunkIndex: number;
}

export interface RAGResponse {
  answer: string;
  confidence: number;
  citations: RAGCitation[];
  latencyMs: number;
  fromCache: boolean;
}

export interface RAGRequestParams {
  kbId: string;
  organizationId: string;
  contactId?: string;
  query: string;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  filters?: {
    category?: string;
    fileType?: string;
  };
  threshold?: number;
  limit?: number;
}

export class RAGEngine {
  private similaritySearch = new SimilaritySearchService();
  private aiService = new AIService();
  private cache = new Map<string, { response: RAGResponse; expiresAt: number }>();
  private cacheTtlMs: number;

  constructor(cacheTtlMs = 5 * 60 * 1000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Clears the RAG engine cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Generates a complete RAG-powered answer, resolving customer context,
   * performing filtered semantic search, applying re-ranking, and caching the output.
   */
  async generateResponse(params: RAGRequestParams): Promise<RAGResponse> {
    const startTime = Date.now();

    // 1. Generate cache key and check in-memory cache
    const cacheKey = `${params.kbId}:${params.contactId || 'none'}:${params.query.trim().toLowerCase()}:${JSON.stringify(params.filters || {})}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() <= cached.expiresAt) {
      console.log(`[RAGEngine] Cache hit for query "${params.query}"`);
      return {
        ...cached.response,
        latencyMs: Date.now() - startTime,
        fromCache: true,
      };
    }

    console.log(`[RAGEngine] Cache miss for query "${params.query}". Processing...`);

    // 2. Retrieve Customer Context (for personalized prompts)
    let customerContextStr = 'No customer profile context available.';
    if (params.contactId) {
      try {
        const ctx = await customerContextService.getCustomerContextByContactId(params.contactId);
        customerContextStr = `Customer Profile:
- Name: ${ctx.profile.name || 'there'}
- Phone: ${ctx.profile.phone || ''}
- Active Project Stage: ${ctx.project?.status || 'none'}
- Active Deal Stage: ${ctx.lead?.status || 'none'}
- Conversion: ${ctx.conversion.isConverted ? 'Converted' : 'Not Converted'}
- Budget: ${ctx.lead?.budget || 'Not provided'}
- Requirements: ${ctx.lead?.requirements || 'Not provided'}
- Active Quote/Proposal Size: ${ctx.proposal?.systemSizeKw || 'None'} kW, Status: ${ctx.proposal?.quoteStatus || 'None'}
- Installation Slots: Slot ID: ${ctx.installation?.slotId || 'None'}, Scheduled: ${ctx.installation?.scheduledAt || 'None'}
- Pending Invoices: ${ctx.followups.filter(f => f.status === 'pending' && f.notes?.toLowerCase().includes('invoice')).length}`;
      } catch (err: any) {
        console.warn(`[RAGEngine] Failed to retrieve customer context:`, err.message);
      }
    }

    // 3. Perform semantic similarity search with filters
    let searchResults: any[] = [];
    try {
      searchResults = await this.similaritySearch.searchDocumentChunks({
        kbId: params.kbId,
        query: params.query,
        threshold: params.threshold ?? 0.4,
        limit: params.limit ?? 5,
        category: params.filters?.category,
        fileType: params.filters?.fileType,
      });
    } catch (err: any) {
      console.error(`[RAGEngine] Semantic search failed:`, err.message);
    }

    // 4. In-memory Hybrid Re-ranking
    const reRanked = this.reRankChunks(searchResults, params.query);

    // 5. Build Knowledge Context and Citations Map
    let contextText = '';
    const citations: RAGCitation[] = [];
    const citationMap = new Map<string, number>();

    reRanked.forEach((chunk, index) => {
      const meta = chunk.metadata || {};
      const docTitle = meta.title || 'Document';
      const fileSource = meta.source || 'upload';
      const category = meta.category || meta.extra?.category || 'Company Information';
      const chunkIdx = meta.chunk_index !== undefined ? Number(meta.chunk_index) : index;

      const citationKey = `${docTitle}:${fileSource}:${category}:${chunkIdx}`;
      if (!citationMap.has(citationKey)) {
        const citationNumber = citations.length + 1;
        citationMap.set(citationKey, citationNumber);
        citations.push({
          title: docTitle,
          source: fileSource,
          category,
          chunkIndex: chunkIdx,
        });
      }

      const citationNum = citationMap.get(citationKey);
      contextText += `[Doc ${citationNum}] (Source: ${fileSource}, Title: ${docTitle}, Category: ${category})\n${chunk.content}\n\n`;
    });

    // 6. Assemble system prompt
    const systemPrompt = `You are a RAG-powered Solar EPC AI Assistant. Answer the customer's question based strictly on the provided knowledge context and customer profile.

Instructions:
1. Rely ONLY on the provided context. If the answer cannot be found in the context, state that you do not know the answer and set confidence score to low.
2. Personalize the answer if customer profile context is available.
3. Cite sources inline using doc numbers, e.g. "We provide a 12-year warranty on panels [1]."
4. Output a JSON object containing the following fields:
   - "answer" (string): The response text containing inline citations.
   - "confidence" (number): A score between 0.0 and 1.0 representing how fully the context answered the question.
5. Output ONLY raw JSON, no markdown code block wraps.

Customer Context:
${customerContextStr}

Knowledge Context:
${contextText || 'No relevant knowledge context found.'}
`;

    // 7. Invoke AIService to query Gemini 2.5 Flash and track cost telemetry
    const historyMessages = params.history
      ? params.history.map(h => ({
          role: h.role === 'system' ? 'system' as const : h.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: h.content,
        }))
      : [];

    const aiRes = await this.aiService.generate({
      modelId: 'gemini-2.5-flash',
      systemPrompt,
      messages: [
        ...historyMessages,
        { role: 'user', content: params.query },
      ],
      organizationId: params.organizationId,
      sessionId: params.kbId,
      agentName: 'RAGEngine',
      temperature: 0.2, // low temperature for strict factual alignment
    });

    // 8. Parse LLM JSON output
    let answer = 'Error formatting RAG response.';
    let confidence = 0.0;

    try {
      const parsed = JSON.parse(aiRes.text.trim());
      answer = parsed.answer || aiRes.text;
      confidence = Number(parsed.confidence) || 0.0;
    } catch {
      // Fallback if LLM output is not valid JSON
      answer = aiRes.text;
      confidence = citations.length > 0 ? 0.70 : 0.20;
    }

    const response: RAGResponse = {
      answer,
      confidence,
      citations,
      latencyMs: Date.now() - startTime,
      fromCache: false,
    };

    // 9. Write to cache
    this.cache.set(cacheKey, {
      response,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return response;
  }

  /**
   * Heuristic hybrid re-ranker. Calculates term matches and exact phrase match overlap
   * to score and sort similarity results.
   */
  private reRankChunks(chunks: any[], query: string): any[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    return chunks
      .map((chunk) => {
        let score = chunk.similarity || 0.0; // Base score is vector similarity
        const content = (chunk.content || '').toLowerCase();

        // 1. Term occurrences overlap
        let termMatches = 0;
        for (const term of terms) {
          if (content.includes(term)) {
            termMatches++;
          }
        }
        if (terms.length > 0) {
          score += (termMatches / terms.length) * 0.15; // Up to 0.15 boost
        }

        // 2. Exact phrase overlap
        if (content.includes(query.toLowerCase())) {
          score += 0.1; // 0.1 boost for exact phrase match
        }

        return { ...chunk, score };
      })
      .sort((a, b) => b.score - a.score);
  }
}

export const ragEngine = new RAGEngine();
