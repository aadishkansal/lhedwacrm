// src/modules/rag/services/faq-bot.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { SimilaritySearchService } from './similarity-service';
import { AIService } from '../../agents/services/ai-service';

import { MemoryRetriever } from '../../memory/services/memory-retriever';

export interface FAQResponse {
  answer: string;
  confidence: number;
  citations: Array<{ number: number; source: string; title: string }>;
  escalate: boolean;
}

export class FAQBot {
  private similaritySearch = new SimilaritySearchService();
  private aiService = new AIService();

  async answerQuestion(params: {
    kbId: string;
    contactId?: string;
    organizationId: string;
    conversationId: string;
    query: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<FAQResponse> {
    const admin = supabaseAdmin();

    // Retrieve customer memories if contactId is available
    let memoryContext = '';
    if (params.contactId) {
      try {
        const retriever = new MemoryRetriever();
        memoryContext = await retriever.retrieveContext({
          contactId: params.contactId,
          organizationId: params.organizationId,
          query: params.query
        });
      } catch (err: any) {
        console.warn('[FAQBot] customer memory retrieval failed:', err.message);
      }
    }

    // 1. Perform semantic retrieval of document chunks
    let matches: any[] = [];
    try {
      matches = await this.similaritySearch.searchDocumentChunks({
        kbId: params.kbId,
        query: params.query,
        threshold: 0.4,
        limit: 3
      });
    } catch (err: any) {
      console.error('[FAQBot] similarity search failed:', err.message);
    }

    let contextText = '';
    const citationMap = new Map<string, { number: number; source: string; title: string }>();

    if (matches.length > 0) {
      // 2. Fetch full rows with metadata for citation support
      const matchedIds = matches.map(m => m.id);
      const { data: chunkRows, error } = await admin
        .from('document_chunks')
        .select('id, content, metadata')
        .in('id', matchedIds);

      if (!error && chunkRows) {
        chunkRows.forEach((row, idx) => {
          const citationNumber = idx + 1;
          const meta = row.metadata || {};
          const sourceName = meta.source || 'document';
          const docTitle = meta.title || 'Knowledge Manual';
          const citationKey = `${sourceName}:${docTitle}`;

          if (!citationMap.has(citationKey)) {
            citationMap.set(citationKey, {
              number: citationNumber,
              source: sourceName,
              title: docTitle
            });
          }

          contextText += `[Doc ${citationNumber}] (Source: ${sourceName}, Title: ${docTitle})\n${row.content}\n\n`;
        });
      }
    }

    // 3. Assemble prompt with instructions for structured JSON response (confidence, citation details)
    const prompt = `You are a RAG-powered Solar EPC FAQ Bot. Answer the customer's question based strictly on the provided knowledge context.

Instructions:
1. If the context contains the answer, output the answer with inline citations (e.g. "Our warranties last for 12 years [1].").
2. Assign a "confidence" score between 0.0 and 1.0. If the context directly answers the question, confidence should be high (>= 0.70). If the context does not contain the answer, or is only partially related, confidence should be low (< 0.70).
3. Set "escalate" to true if the question cannot be answered, or if the customer specifically asks for a human.
4. Output a JSON object containing the fields: "answer" (string), "confidence" (number), "escalate" (boolean).
5. Output ONLY raw JSON, no markdown code block wraps.

Customer Profile / Memories:
${memoryContext || "No customer memories found."}

Context:
${contextText || "No context documents found."}

Conversation History:
${params.history.map(h => `${h.role}: ${h.content}`).join('\n')}

Customer's Question:
${params.query}`;

    try {
      const aiResponse = await this.aiService.generate({
        modelId: 'gemini-2.5-flash',
        systemPrompt: 'You are a precise, citation-aware customer service bot.',
        messages: [{ role: 'user', content: prompt }],
        organizationId: params.organizationId,
        sessionId: params.conversationId,
        agentName: 'FAQBotAgent'
      });

      const cleanText = aiResponse.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanText);

      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.0;
      const escalate = parsed.escalate === true || confidence < 0.70;

      // 4. If confidence is low, log unanswered question
      if (escalate) {
        console.log(`[FAQBot] Low confidence response (${confidence}) or escalation flagged. Logging unanswered question.`);
        
        const { error: logError } = await admin.from('unanswered_questions').insert({
          organization_id: params.organizationId,
          conversation_id: params.conversationId,
          question: params.query
        });

        if (logError) {
          console.error('[FAQBot] Failed to log unanswered question:', logError.message);
        }

        return {
          answer: parsed.answer || 'I am not sure about that. Let me connect you to a human agent.',
          confidence,
          citations: [],
          escalate: true
        };
      }

      // 5. Append citations to response if they match actual used docs
      const citations = Array.from(citationMap.values());

      return {
        answer: parsed.answer || '',
        confidence,
        citations,
        escalate: false
      };

    } catch (err: any) {
      console.error('[FAQBot] Generation or parsing failed:', err.message);

      // Log unanswered question on system failure
      try {
        await admin.from('unanswered_questions').insert({
          organization_id: params.organizationId,
          conversation_id: params.conversationId,
          question: params.query
        });
      } catch { /* best-effort */ }

      return {
        answer: 'I encountered an error. Connecting you to a support agent.',
        confidence: 0.0,
        citations: [],
        escalate: true
      };
    }
  }
}
