// src/modules/agents/tools/definitions/get-customer-context.ts

import { z } from 'zod';
import { AgentTool } from '../types';
import { customerContextService } from '../../../crm/services/customer-context-service';

const inputSchema = z.object({
  contactId: z.string().uuid({ message: 'A valid contactId UUID is required' }),
});

export const getCustomerContextTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'GetCustomerContext',
  description: 'Retrieves the complete CRM profile, lead details, EPC project status, quotations, installation schedule, followups, and documents for a contact.',
  schema: inputSchema,
  permissions: ['read:customer'],
  handler: async (input, context) => {
    return await customerContextService.getCustomerContextByContactId(input.contactId);
  },
};
