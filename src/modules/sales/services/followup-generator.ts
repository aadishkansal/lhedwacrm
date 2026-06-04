// src/modules/sales/services/followup-generator.ts

import { AIService } from '../../agents/services/ai-service';
import { SalesContext, FollowupMessage, FollowupTemplate, SalesAction } from '../types';

const TEMPLATE_PROMPTS: Record<FollowupTemplate, string> = {
  lead_nurture: `Generate a warm, conversational WhatsApp follow-up message for a solar EPC company. 
The message should nurture the lead, mention the benefits of solar energy, and invite them to schedule a free site assessment.
Keep it under 120 words. Do NOT use emojis excessively. Use customer's name if known.`,

  quotation_followup: `Generate a professional WhatsApp follow-up message for a solar EPC company.
The customer has been sent a quotation but hasn't responded yet. Ask if they have any questions about the quote, 
mention the key benefit (estimated ROI), and offer to schedule a call to walk through it.
Keep it under 150 words.`,

  site_visit_reminder: `Generate a friendly WhatsApp reminder for an upcoming solar site assessment visit.
Confirm the scheduled time, remind them what to prepare (property access, electricity bills), 
and provide a contact number in case of rescheduling.
Keep it under 100 words.`,

  appointment_confirmation: `Generate a WhatsApp appointment confirmation message for a solar EPC company.
Confirm the appointment date/time, state the purpose (solar site assessment / sales consultation),
and let the customer know what to expect.
Keep it under 120 words.`,

  product_recommendation: `Generate a WhatsApp message recommending a specific solar system configuration to a customer.
Include the recommended system size (kW), panel type, inverter type, estimated cost, and payback period.
Make it sound like a personalized recommendation, not a brochure.
Keep it under 160 words.`,

  win_back: `Generate a re-engagement WhatsApp message for a solar lead that has gone cold.
Mention a new offer, government subsidy, or updated pricing that might reignite their interest.
Be friendly, not pushy. Keep it under 100 words.`,
};

export class FollowupGenerator {
  private aiService = new AIService();

  /**
   * Generate a WhatsApp-ready follow-up message given a context and template.
   */
  async generate(params: {
    context: SalesContext;
    template: FollowupTemplate;
    extraInstructions?: string;
  }): Promise<FollowupMessage> {
    const { context, template, extraInstructions } = params;
    const { contact, deal, project, quote, memoryContext } = context;

    const customerSummary = [
      `Customer: ${contact.name ?? 'Valued Customer'}`,
      contact.company ? `Company: ${contact.company}` : null,
      deal ? `Deal: "${deal.title}" (${deal.stageName}) — ₹${deal.value.toLocaleString()}` : null,
      project ? `Project status: ${project.status}${project.systemSizeKw ? `, ${project.systemSizeKw}kW system` : ''}` : null,
      quote ? `Latest quote: ₹${quote.totalAmount.toLocaleString()} (${quote.status})` : null,
      `Lead score: ${context.leadScore.score}/100 (${context.leadScore.band})`,
    ].filter(Boolean).join('\n');

    const memorySection = memoryContext
      ? `\nCustomer Memory:\n${memoryContext}`
      : '';

    const basePrompt = TEMPLATE_PROMPTS[template];

    const prompt = `${basePrompt}

Customer Details:
${customerSummary}${memorySection}
${extraInstructions ? `\nAdditional Instructions:\n${extraInstructions}` : ''}

Output ONLY the WhatsApp message text. No preamble, no explanation.`;

    const response = await this.aiService.generate({
      modelId: 'gemini-2.5-flash',
      systemPrompt: 'You are a sales copywriter for a Solar EPC company. Write concise, warm, professional WhatsApp messages.',
      messages: [{ role: 'user', content: prompt }],
      organizationId: context.contact.organizationId,
      sessionId: `followup-${context.contact.id}`,
      agentName: 'FollowupGenerator',
      temperature: 0.7,
    });

    return {
      text: response.text.trim(),
      template,
    };
  }

  /**
   * Choose the best follow-up template based on the current context.
   * Called by SalesAgent to pick the right follow-up type before generating.
   */
  selectTemplate(action: SalesAction, context: SalesContext): FollowupTemplate {
    switch (action) {
      case 'EXPLAIN_QUOTATION':
        return 'quotation_followup';
      case 'RECOMMEND_PRODUCT':
        return 'product_recommendation';
      case 'BOOK_APPOINTMENT':
        return 'appointment_confirmation';
      default: {
        // For SEND_FOLLOWUP: choose template based on score band and context
        if (!context.deal && !context.project) return 'lead_nurture';
        if (context.quote?.status === 'sent') return 'quotation_followup';
        if (context.project?.status === 'site_visit') return 'site_visit_reminder';
        if (context.leadScore.band === 'cold' && context.signals.daysSinceLastContact > 14) return 'win_back';
        return 'lead_nurture';
      }
    }
  }
}
