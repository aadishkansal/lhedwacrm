// src/modules/agents/services/ticket-ai-service.ts

import { AIService } from './ai-service';

export interface TicketAnalysis {
  category: 'billing' | 'technical' | 'installation' | 'sales' | 'general';
  priority: 'low' | 'medium' | 'high';
  escalated: boolean;
}

export class TicketAIService {
  private aiService = new AIService();

  async analyzeTicket(params: {
    text: string;
    organizationId: string;
    sessionId?: string;
  }): Promise<TicketAnalysis> {
    const prompt = `Analyze this customer support request or message for a Solar EPC company.
Classify it into one of these categories: billing, technical, installation, sales, general.
Detect the priority level: low, medium, high.
Detect if the user is escalated (frustrated, angry, threatening, or requesting a supervisor).

Output ONLY a raw JSON object with the following fields:
{
  "category": "billing" | "technical" | "installation" | "sales" | "general",
  "priority": "low" | "medium" | "high",
  "escalated": true | false
}

Request Text:
"${params.text}"`;

    try {
      const response = await this.aiService.generate({
        modelId: 'gemini-2.5-flash',
        systemPrompt: 'You are a support classification assistant. Output ONLY raw JSON.',
        messages: [{ role: 'user', content: prompt }],
        organizationId: params.organizationId,
        sessionId: params.sessionId || '00000000-0000-0000-0000-000000000000',
        agentName: 'TicketClassifierAgent',
      });

      const cleanText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanText);

      const category = ['billing', 'technical', 'installation', 'sales', 'general'].includes(parsed.category)
        ? parsed.category
        : 'general';

      const priority = ['low', 'medium', 'high'].includes(parsed.priority)
        ? parsed.priority
        : 'medium';

      const escalated = parsed.escalated === true;

      return { category, priority, escalated };
    } catch (err: any) {
      console.error('[TicketAIService] Analysis failed:', err.message);
      return {
        category: 'general',
        priority: 'medium',
        escalated: false,
      };
    }
  }

  async suggestReply(params: {
    ticket: { title: string; category?: string; priority?: string };
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    kbContext?: string;
    organizationId: string;
    sessionId?: string;
  }): Promise<string> {
    const prompt = `You are a helpful customer support agent for a Solar EPC company.
Draft a professional, helpful response to the customer.

Ticket Info:
- Title: ${params.ticket.title}
- Category: ${params.ticket.category || 'general'}
- Priority: ${params.ticket.priority || 'medium'}

${params.kbContext ? `Knowledge Base Context:\n${params.kbContext}\n` : ''}
Conversation History:
${params.history.map(h => `${h.role}: ${h.content}`).join('\n')}

Draft the response directly. Do not include introductory notes, pleasantries like "Sure, here is the reply:", or quotes.`;

    try {
      const response = await this.aiService.generate({
        modelId: 'gemini-2.5-flash',
        systemPrompt: 'You are a professional support responder.',
        messages: [{ role: 'user', content: prompt }],
        organizationId: params.organizationId,
        sessionId: params.sessionId || '00000000-0000-0000-0000-000000000000',
        agentName: 'TicketReplyAgent',
      });

      return response.text.trim();
    } catch (err: any) {
      console.error('[TicketAIService] Suggest reply failed:', err.message);
      return 'Thank you for contacting support. We are looking into your issue and will get back to you soon.';
    }
  }
}

export const ticketAIService = new TicketAIService();
