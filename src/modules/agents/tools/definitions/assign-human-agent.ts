// src/modules/agents/tools/definitions/assign-human-agent.ts

import { z } from 'zod';
import { AgentTool } from '../types';
import { salesPortalConnector } from '../../../crm/services/sales-portal-connector';

const inputSchema = z.object({
  conversationId: z.string().uuid({ message: 'A valid conversationId UUID is required' }),
  agentId: z.string().uuid().nullable().optional().default(null), // null means unassign (opens for the queue)
  status: z.enum(['open', 'snoozed', 'closed']).optional().default('open'),
});

export const assignHumanAgentTool: AgentTool<z.infer<typeof inputSchema>> = {
  name: 'AssignHumanAgent',
  description: 'Assigns or routes a WhatsApp conversation to a human agent, or opens it for the shared inbox by setting agentId to null.',
  schema: inputSchema,
  permissions: ['write:conversation'],
  handler: async (input, context) => {
    return await salesPortalConnector.assignHumanAgent({
      conversationId: input.conversationId,
      agentId: input.agentId,
      status: input.status,
    });
  },
};
