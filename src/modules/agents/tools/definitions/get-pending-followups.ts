// src/modules/agents/tools/definitions/get-pending-followups.ts

import { z } from 'zod';
import { AgentTool } from '../types';
import { salesPortalConnector } from '../../../crm/services/sales-portal-connector';

const inputSchema = z.object({
  contactId: z.string().uuid({ message: 'A valid contactId UUID is required' }),
});

export const getPendingFollowupsTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'GetPendingFollowups',
  description: 'Retrieves pending / scheduled appointments, site visits, calls, and reminders for a specific contact.',
  schema: inputSchema,
  permissions: ['read:followup'],
  handler: async (input, context) => {
    const followups = await salesPortalConnector.getFollowups(input.contactId);
    
    const now = Date.now();
    const upcoming = followups.filter(f => new Date(f.scheduledAt).getTime() >= now && f.status !== 'completed');
    const pastPending = followups.filter(f => new Date(f.scheduledAt).getTime() < now && f.status !== 'completed');
    const completed = followups.filter(f => f.status === 'completed');

    return {
      upcoming,
      pastPending,
      completed,
    };
  },
};
