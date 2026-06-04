// src/modules/agents/services/prompt-builder.ts

import { CustomerContext } from '../../crm/services/customer-context-service';

export class PromptBuilder {
  /**
   * Replaces template tags with real customer context values.
   */
  static buildPrompt(template: string, params: {
    customerContext: CustomerContext;
    messageText?: string;
  }): string {
    const ctx = params.customerContext;
    
    const variables: Record<string, string | number> = {
      customer_name: ctx.profile.name || 'there',
      customer_phone: ctx.profile.phone || '',
      project_status: ctx.project?.status || 'none',
      project_id: ctx.project?.projectId || 'none',
      lead_status: ctx.lead?.status || 'none',
      lead_budget: ctx.lead?.budget || 'Not provided',
      lead_requirements: ctx.lead?.requirements || 'Not provided',
      conversion_status: ctx.conversion.isConverted ? 'Converted' : 'Not Converted',
      proposal_size: ctx.proposal?.systemSizeKw || 'none',
      proposal_amount: ctx.proposal?.totalAmount || 0,
      proposal_status: ctx.proposal?.quoteStatus || 'none',
      installation_slot_id: ctx.installation?.slotId || 'none',
      installation_date: ctx.installation?.scheduledAt || 'none',
      pending_invoices_count: ctx.followups.filter(
        f => f.status === 'pending' && f.notes?.toLowerCase().includes('invoice')
      ).length,
      message_text: params.messageText || '',
    };

    let result = template;
    for (const [key, val] of Object.entries(variables)) {
      const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
      result = result.replace(placeholder, String(val));
    }

    return result;
  }
}
