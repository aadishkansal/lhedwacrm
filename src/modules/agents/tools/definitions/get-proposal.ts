// src/modules/agents/tools/definitions/get-proposal.ts

import { z } from 'zod';
import { AgentTool } from '../types';
import { salesPortalConnector } from '../../../crm/services/sales-portal-connector';

const inputSchema = z.object({
  proposalId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
}).refine(data => data.proposalId || data.projectId || data.contactId, {
  message: "At least one of proposalId, projectId, or contactId must be provided",
});

export const getProposalTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'GetProposal',
  description: 'Retrieves proposal/quotation details, amounts, status, and PDF links for a solar project by proposalId, projectId, or contactId.',
  schema: inputSchema,
  permissions: ['read:quote'],
  handler: async (input, context) => {
    if (input.proposalId) {
      return await salesPortalConnector.getProposal(input.proposalId);
    }

    if (input.projectId) {
      return await salesPortalConnector.getProposalsByProject(input.projectId);
    }

    if (input.contactId) {
      const projects = await salesPortalConnector.getProjectProgressByContact(input.contactId);
      if (!projects || projects.length === 0) return [];

      const quotesPromises = projects.map(p => salesPortalConnector.getProposalsByProject(p.id));
      const allQuotes = await Promise.all(quotesPromises);
      return allQuotes.flat();
    }

    return [];
  },
};
