// src/modules/memory/services/memory-extractor.ts

import { AIService } from '../../agents/services/ai-service';

export interface ExtractedMemory {
  facts: string[];
  preferences: string[];
}

export class MemoryExtractor {
  private aiService = new AIService();

  async extractMemories(params: {
    transcript: string;
    organizationId: string;
    conversationId: string;
  }): Promise<ExtractedMemory> {
    const prompt = `Analyze this chat transcript between a Solar company and a customer.
Extract key long-term customer details.

Categorize the extracted details into two lists:
1. "facts": Important facts about the customer (e.g. roof type, energy consumption details, shading issues, budget range, location, address, shading, electrical setup, previous issues).
2. "preferences": Customer preferences, communication preferences, buying interests, and objections (e.g. preferred communication times, messaging channel preference, solar panel/battery model preference, EV charger interest, pricing/financial objections, aesthetic objections, brand/warranty doubts, follow-up instructions).

CRITICAL CONSTRAINTS:
- Do NOT extract or store: Project Status, Proposal Status, Installation Status, or Invoices. These belong to the Sales Portal and must be completely excluded from memory.
- Keep each fact or preference concise, clear, and contextually independent (e.g. "Customer has a metal roof" rather than "They have a metal roof").

Reply with a JSON object containing "facts" (array of strings) and "preferences" (array of strings). Do NOT wrap in markdown block, return raw JSON.

Transcript:
${params.transcript}`;

    try {
      const response = await this.aiService.generate({
        modelId: 'gemini-2.5-flash',
        systemPrompt: 'You are an AI fact extraction agent.',
        messages: [{ role: 'user', content: prompt }],
        organizationId: params.organizationId,
        sessionId: params.conversationId,
        agentName: 'MemoryExtractorAgent'
      });

      const cleanText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanText);
      return {
        facts: Array.isArray(parsed.facts) ? parsed.facts : [],
        preferences: Array.isArray(parsed.preferences) ? parsed.preferences : []
      };
    } catch (err: any) {
      console.error('[MemoryExtractor] extraction failed:', err.message);
      return { facts: [], preferences: [] };
    }
  }

  async generateSummary(params: {
    transcript: string;
    existingSummary?: string;
    organizationId: string;
    conversationId: string;
  }): Promise<string> {
    const prompt = `Analyze the following WhatsApp conversation transcript between a customer and the agent/bot.
Generate a concise summary of the conversation (max 3 sentences). Focus on:
- Customer's core request/problem
- Outstanding questions or next actions
- Current status of inquiry

CRITICAL CONSTRAINTS:
- Do NOT include structured project status, proposal status, installation status, or invoices. Keep focus strictly on the dialogue summary.

${params.existingSummary ? `Existing previous summary to build upon:\n${params.existingSummary}\n` : ''}

Transcript:
${params.transcript}`;

    try {
      const response = await this.aiService.generate({
        modelId: 'gemini-2.5-flash',
        systemPrompt: 'You are a concise conversation summarization agent.',
        messages: [{ role: 'user', content: prompt }],
        organizationId: params.organizationId,
        sessionId: params.conversationId,
        agentName: 'MemorySummarizationAgent'
      });

      return response.text.trim();
    } catch (err: any) {
      console.error('[MemoryExtractor] summary generation failed:', err.message);
      return '';
    }
  }
}
