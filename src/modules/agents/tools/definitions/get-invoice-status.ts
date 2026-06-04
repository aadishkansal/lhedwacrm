// src/modules/agents/tools/definitions/get-invoice-status.ts

import { z } from 'zod';
import { AgentTool } from '../types';
import { salesPortalConnector } from '../../../crm/services/sales-portal-connector';

const inputSchema = z.object({
  invoiceId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
}).refine(data => data.invoiceId || data.projectId || data.contactId, {
  message: "At least one of invoiceId, projectId, or contactId must be provided",
});

export const getInvoiceStatusTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'GetInvoiceStatus',
  description: 'Retrieves invoices, total amounts, due dates, and payment status (paid, pending, overdue) by invoiceId, projectId, or contactId.',
  schema: inputSchema,
  permissions: ['read:invoice'],
  handler: async (input, context) => {
    if (input.invoiceId) {
      return await salesPortalConnector.getInvoice(input.invoiceId);
    }

    if (input.projectId) {
      const project = await salesPortalConnector.getProjectProgress(input.projectId);
      if (!project?.contactId) return [];
      return await salesPortalConnector.getInvoices(project.contactId);
    }

    if (input.contactId) {
      return await salesPortalConnector.getInvoices(input.contactId);
    }

    return [];
  },
};
