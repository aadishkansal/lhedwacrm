// src/modules/whatsapp/services/whatsapp-assistant.ts

import { supabaseAdmin } from '../../workflows/services/admin-client';
import { markMessageAsRead } from './meta-api';
import { engineSendText } from '../../workflows/services/meta-send';
import { AIService } from '../../agents/services/ai-service';
import { ContextManager } from '../../agents/services/context-manager';
import { MemoryRetriever } from '../../agents/services/memory-retriever';
import { MemoryService } from '../../memory/services/memory-service';
import { FAQBot } from '../../rag/services/faq-bot';
import { SalesAgent } from '../../sales/services/sales-agent';
import { triageIncomingMessage } from '../../../features/ai/triage-agent';
import { supervisorAgent } from '../../agents/services/supervisor-agent';

export class WhatsAppAssistant {
  private aiService = new AIService();
  private contextManager = new ContextManager(new MemoryRetriever());

  async handleIncomingMessage(params: {
    userId: string;
    conversationId: string;
    contactId: string;
    incomingMessageText: string;
    messageId: string;
    accessToken: string;
  }): Promise<void> {
    const db = supabaseAdmin();

    // 1. Fetch latest conversation details to check assignment status
    const { data: conv, error: convError } = await db
      .from('conversations')
      .select('assigned_agent_id, status, is_bot_active')
      .eq('id', params.conversationId)
      .single();

    if (convError || !conv) {
      console.warn('[assistant] conversation not found:', params.conversationId);
      return;
    }

    // Check if bot is disabled explicitly (only flag that controls AI replies)
    if (!conv.is_bot_active) {
      console.log('[assistant] AI bot is disabled for this conversation. skipping bot response.');
      return;
    }

    // 2. Retrieve conversation history (up to last 15 messages)
    const { data: dbMessages, error: msgError } = await db
      .from('messages')
      .select('sender_type, content_text, created_at')
      .eq('conversation_id', params.conversationId)
      .order('created_at', { ascending: true })
      .limit(15);

    if (msgError) {
      console.error('[assistant] failed to retrieve message history:', msgError.message);
      return;
    }

    // 3. Mark message as read in Meta WhatsApp Cloud API
    const { data: config } = await db
      .from('whatsapp_config')
      .select('phone_number_id')
      .eq('user_id', params.userId)
      .maybeSingle();

    if (config?.phone_number_id) {
      try {
        await markMessageAsRead({
          phoneNumberId: config.phone_number_id,
          accessToken: params.accessToken,
          messageId: params.messageId
        });
      } catch (err: any) {
        console.warn('[assistant] markMessageAsRead failed:', err.message);
      }
    }

    // 4. Human handoff check via incoming keywords
    const handoffKeywords = ['talk to agent', 'human', 'support agent', 'talk to human', 'representative', 'customer service', 'help agent'];
    const textLower = params.incomingMessageText.toLowerCase();
    const needsHandoff = handoffKeywords.some(kw => textLower.includes(kw));

    if (needsHandoff) {
      await this.triggerHumanHandoff({
        userId: params.userId,
        conversationId: params.conversationId,
        contactId: params.contactId,
        history: dbMessages || [],
        accessToken: params.accessToken,
        phoneNumberId: config?.phone_number_id
      });
      return;
    }

    // 5. Retrieve organization ID from contact record for multi-tenancy
    const { data: contact } = await db
      .from('contacts')
      .select('organization_id')
      .eq('id', params.contactId)
      .single();

    const organizationId = contact?.organization_id || params.userId;

    // 5.5. AI Escalation Detection Check
    try {
      const { ticketAIService } = await import('../../agents/services/ticket-ai-service');
      const analysis = await ticketAIService.analyzeTicket({
        text: params.incomingMessageText,
        organizationId,
        sessionId: params.conversationId,
      });

      if (analysis.escalated) {
        console.log(`[assistant] AI detected escalation for conversation ${params.conversationId}. Routing to human.`);
        
        // Log escalation event in timeline
        await db.from('inbox_timeline_events').insert({
          organization_id: organizationId,
          conversation_id: params.conversationId,
          event_type: 'ai_escalated',
          metadata: {
            message_text: params.incomingMessageText,
            reason: 'AI detected customer frustration/urgency'
          }
        });

        await this.triggerHumanHandoff({
          userId: params.userId,
          conversationId: params.conversationId,
          contactId: params.contactId,
          history: dbMessages || [],
          accessToken: params.accessToken,
          phoneNumberId: config?.phone_number_id,
          transferMessage: "I detected some urgency in your message. I am transferring this chat to a human support agent immediately. Please wait a moment."
        });
        return;
      }
    } catch (err: any) {
      console.warn('[assistant] AI escalation detection failed:', err.message);
    }

    // 6. Fetch matching knowledge base for context injection
    const { data: kbRow } = await db
      .from('knowledge_bases')
      .select('id')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle();

    // Map DB messages to AIMessages array format
    const history = (dbMessages || [])
      .filter(m => m.sender_type === 'customer' || m.sender_type === 'bot' || m.sender_type === 'agent')
      .map(m => ({
        role: m.sender_type === 'customer' ? 'user' as const : 'assistant' as const,
        content: m.content_text || ''
      }));

    // 7. Route message through Supervisor Agent
    let responseText: string;
    try {
      responseText = await supervisorAgent.routeMessage({
        contactId: params.contactId,
        organizationId,
        conversationId: params.conversationId,
        messageText: params.incomingMessageText,
        userId: params.userId,
        history,
      });
    } catch (err: any) {
      console.error('[assistant] SupervisorAgent routing failed:', err.message);
      responseText = "Thank you for your message. We are processing your request and will get back to you shortly.";
    }

    // 8. Simulate typing delay based on response length
    const delayMs = Math.min(3000, Math.max(1000, responseText.length * 20));
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // 9. Send Reply via WhatsApp API
    await engineSendText({
      userId: params.userId,
      conversationId: params.conversationId,
      contactId: params.contactId,
      text: responseText
    });

    // 10. Consolidate conversation memory asynchronously
    const memoryService = new MemoryService();
    memoryService.consolidateConversation({
      conversationId: params.conversationId,
      contactId: params.contactId,
      organizationId
    }).catch(err => {
      console.error('[assistant] Memory consolidation failed:', err instanceof Error ? err.message : err);
    });
  }

  async triggerHumanHandoff(params: {
    userId: string;
    conversationId: string;
    contactId: string;
    history: any[];
    accessToken: string;
    phoneNumberId?: string;
    transferMessage?: string;
  }): Promise<void> {
    const db = supabaseAdmin();
    console.log(`[assistant] triggering human handoff for conversation ${params.conversationId}`);

    // Assign conversation to user/agent (human handoff active) and disable bot
    await db
      .from('conversations')
      .update({
        assigned_agent_id: params.userId,
        is_bot_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', params.conversationId);

    // Generate conversation summary
    const summary = await this.summarizeConversation(params.history);

    // Save summary as a contact note
    if (summary) {
      await db.from('contact_notes').insert({
        contact_id: params.contactId,
        user_id: params.userId,
        note_text: `[AI Auto-Summary on Human Handoff]\n${summary}`
      });
    }

    // Trigger full memory consolidation during handoff
    const { data: contact } = await db
      .from('contacts')
      .select('organization_id')
      .eq('id', params.contactId)
      .single();
    const organizationId = contact?.organization_id || params.userId;

    const memoryService = new MemoryService();
    memoryService.consolidateConversation({
      conversationId: params.conversationId,
      contactId: params.contactId,
      organizationId
    }).catch(err => {
      console.error('[assistant] Handoff memory consolidation failed:', err instanceof Error ? err.message : err);
    });

    // Send transition/transfer message to customer
    const text = params.transferMessage || "I am transferring this chat to a human support agent who can help you further. Please wait a moment.";
    
    // Simulate short delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    await engineSendText({
      userId: params.userId,
      conversationId: params.conversationId,
      contactId: params.contactId,
      text
    });
  }

  async summarizeConversation(history: any[]): Promise<string> {
    if (!history || history.length === 0) return "No conversation history.";

    const transcript = history
      .map(m => `${m.sender_type}: ${m.content_text}`)
      .join('\n');

    const prompt = `Summarize this WhatsApp conversation transcript between a customer and the bot/agent. Focus on key customer details, solar inquiry, and reasons for human transfer. Keep it under 3 paragraphs.
    
Transcript:
${transcript}`;

    try {
      const { data: org } = await supabaseAdmin().from('organizations').select('id').limit(1).single();
      const orgId = org?.id || "00000000-0000-0000-0000-000000000000";

      const res = await this.aiService.generate({
        modelId: 'gemini-2.5-flash',
        systemPrompt: "You are a concise summarizer.",
        messages: [{ role: 'user', content: prompt }],
        organizationId: orgId,
        sessionId: "00000000-0000-0000-0000-000000000000",
        agentName: 'SummarizationAgent'
      });

      return res.text.trim();
    } catch (err: any) {
      console.error('[assistant] summarization failed:', err.message);
      return "Failed to generate conversation summary.";
    }
  }
}
