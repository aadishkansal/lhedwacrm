// src/modules/agents/tools/definitions/get-customer-documents.ts

import { z } from 'zod';
import { AgentTool } from '../types';
import { salesPortalConnector } from '../../../crm/services/sales-portal-connector';

const inputSchema = z.object({
  contactId: z.string().uuid({ message: 'A valid contactId UUID is required' }),
});

export const getCustomerDocumentsTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'GetCustomerDocuments',
  description: 'Retrieves all uploaded files and documents (utility bills, roof layouts, contracts, ID proof) for a specific contact.',
  schema: inputSchema,
  permissions: ['read:customer'],
  handler: async (input, context) => {
    return await salesPortalConnector.getDocuments(input.contactId);
  },
};
