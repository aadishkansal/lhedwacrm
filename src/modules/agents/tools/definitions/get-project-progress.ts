// src/modules/agents/tools/definitions/get-project-progress.ts

import { z } from 'zod';
import { AgentTool } from '../types';
import { salesPortalConnector } from '../../../crm/services/sales-portal-connector';

const inputSchema = z.object({
  projectId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
}).refine(data => data.projectId || data.contactId, {
  message: "Either projectId or contactId must be provided",
});

export const getProjectProgressTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'GetProjectProgress',
  description: 'Retrieves the current solar EPC project progress status, details, system capacity, and site details by projectId or contactId.',
  schema: inputSchema,
  permissions: ['read:project'],
  handler: async (input, context) => {
    if (input.projectId) {
      const project = await salesPortalConnector.getProjectProgress(input.projectId);
      return [project];
    } else if (input.contactId) {
      return await salesPortalConnector.getProjectProgressByContact(input.contactId);
    }
    return [];
  },
};
